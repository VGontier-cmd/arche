import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { OpenRouter } from "@openrouter/sdk";
import { maxCost, stepCountIs } from "@openrouter/sdk/lib/stop-conditions";

import { getConfig, type OrchestratorConfig } from "../config";
import type { RepositoryRow, RunRow } from "../db/schema";
import { ExternalServiceError } from "./errors";
import { buildExtraTools } from "./extra-tools";
import { createExecutorTools, extractHumanInputCall } from "./executor-tools";
import { GitManager } from "./git";
import {
  OpenRouterSdkProvider,
  extractLastThinking,
  type ProviderAttempt,
  type ProviderMessage,
  type ProviderUsage,
} from "./provider";
import { computeCostFromUsage } from "./cost";
import { fetchOpenRouterModels, type OpenRouterModel } from "./openrouter-proxy";
import {
  plannerRoleOutputSchema,
  plannerSchemaHint,
  researcherSchemaHint,
  reviewerRoleOutputSchema,
  reviewerSchemaHint,
} from "./role-schemas";
import type { ResolvedExecutionProfile } from "./profiles";
import { resolveExecutionProfile } from "./profiles";
import { SandboxManager } from "./sandbox";
import type {
  ExecutorRoleOutput,
  JiraIssue,
  PlannerRoleOutput,
  ReviewFinding,
  ReviewerRoleOutput,
  RunTaskRole,
  RunTaskStatus,
  RunTaskStrategy,
} from "./types";
import { ensureDirectory } from "./utils";
import type { WorkerActivity, WorkerStatus } from "./workers";

const VALIDATION_FINDINGS_LIMIT = 12;

export type RoleOutputByRole = {
  planner: PlannerRoleOutput;
  executor: ExecutorRoleOutput;
  reviewer: ReviewerRoleOutput;
};

export type RoleOutputResult<T extends RunTaskRole> = {
  taskId: number;
  artifactsPath: string;
  output: RoleOutputByRole[T];
};

type TaskRecord = {
  id: number;
};

export type WorkflowHooks = {
  setWorkerPhase: (
    workerId: string,
    run: Pick<RunRow, "id" | "ticketKey">,
    input: {
      status: WorkerStatus;
      activity: WorkerActivity;
      currentStep?: number | null;
      lastError?: string | null;
    },
  ) => Promise<void>;
  appendRunEvent: (runId: string, type: string, payload?: Record<string, unknown>) => Promise<void>;
  appendRunMessage: (
    runId: string,
    role: string,
    kind: string,
    content: string,
    thinkingContent?: string | null,
  ) => Promise<unknown>;
  appendSystemRunLog: (runId: string, message: string) => Promise<void>;
  createTask: (input: {
    runId: string;
    role: RunTaskRole;
    cycle: number;
    modelName: string;
    profileName: string;
    strategy: RunTaskStrategy;
    artifactsPath: string;
  }) => Promise<TaskRecord>;
  completeTask: (
    taskId: number,
    input: {
      status: Exclude<RunTaskStatus, "running">;
      summary?: string | null;
      outputJson?: Record<string, unknown> | null;
      usage?: ProviderUsage | null;
      estimatedCostUsd?: number | null;
    },
  ) => Promise<unknown>;
  recordRunCommand: (input: {
    runId: string;
    phase: string;
    result: {
      command: string;
      returncode: number;
      stdout: string;
      stderr: string;
      durationMs?: number;
    };
  }) => Promise<unknown>;
  ensureNotCancelled: (runId: string) => Promise<void>;
  runValidation: (sandboxId: string) => Promise<{
    findings: ReviewFinding[];
    diffExcerpt: string;
  }>;
};

export function resolveRoleProfile(
  run: RunRow,
  role: RunTaskRole,
  config: OrchestratorConfig,
) {
  const profile = resolveExecutionProfile(config, role);
  const profileName =
    role === "planner"
      ? (run.plannerProfile ?? profile.name)
      : role === "executor"
        ? (run.executorProfile ?? profile.name)
        : (run.reviewerProfile ?? profile.name);
  return {
    ...profile,
    name: profileName,
  };
}

export function buildTaskArtifactsPath(run: RunRow, role: RunTaskRole, cycle: number) {
  return join(run.artifactsPath ?? buildRunArtifactsPath("", run.id), "tasks", `${role}-cycle-${cycle}`);
}

function directRoleStrategy(role: RunTaskRole): RunTaskStrategy {
  return role === "executor" ? "patch_loop" : "direct";
}

function formatFindings(findings: ReviewFinding[]) {
  if (findings.length === 0) {
    return "None.";
  }
  return findings
    .map((finding, index) => {
      const file = finding.file ? ` (${finding.file})` : "";
      return `${index + 1}. ${finding.title}${file}\n${finding.body}`;
    })
    .join("\n\n");
}

export function buildResearcherPrompt(input: {
  issue: { key: string; title: string; description: string | null };
  repository: RepositoryRow;
  trackedFiles: string[];
  repoInstructions: string | null;
}) {
  return [
    "You are the researcher role for Arche.",
    "Your job is to analyse the codebase and the ticket to produce a research report for the planner.",
    "Do NOT modify any files. Read the repository structure and return a JSON report.",
    `Ticket: ${input.issue.key} - ${input.issue.title}`,
    "",
    "Issue description:",
    input.issue.description || "(empty)",
    "",
    `Repository: ${input.repository.name}`,
    input.repoInstructions
      ? `\nRepository conventions:\n${input.repoInstructions}\n`
      : "",
    "Repository tree:",
    input.trackedFiles.slice(0, 400).join("\n") || "(empty repo)",
    "",
    "Identify: which files are likely impacted, key architectural patterns, external dependencies, and risks before implementation.",
    "You MUST return a JSON object with exactly this structure:",
    researcherSchemaHint,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildPlannerPrompt(input: {
  issue: JiraIssue;
  repository: RepositoryRow;
  allowedCommands: string[];
  validationCommands: string[];
  trackedFiles: string[];
  requirePublishApproval: boolean;
  latestHumanResponse: string | null;
  recentCommits: string[];
  repoInstructions: string | null;
  researchFindings: string | null;
}) {
  return [
    "You are the planner role for Arche.",
    "Return only a single JSON object matching the requested schema.",
    "Do not modify files. This run always requires human approval of the plan before execution.",
    `Ticket: ${input.issue.key} - ${input.issue.title}`,
    "",
    "Issue description:",
    input.issue.description || "(empty)",
    "",
    `Repository: ${input.repository.name}`,
    input.repoInstructions
      ? `\nRepository instructions (team conventions — follow these exactly when planning):\n${input.repoInstructions}\n`
      : "",
    input.researchFindings
      ? `\nResearch findings (auto-generated context — use to inform your proposals):\n${input.researchFindings}\n`
      : "",
    `Allowed commands for later execution: ${input.allowedCommands.join(", ") || "(none)"}`,
    `Validation commands: ${input.validationCommands.join(", ") || "(none)"}`,
    `Publish approval required: ${input.requirePublishApproval ? "yes" : "no"}`,
    "",
    "Repository tree sample:",
    input.trackedFiles.slice(0, 400).join("\n") || "(empty repo)",
    "",
    input.recentCommits.length > 0
      ? `Recent commits on this branch:\n${input.recentCommits.join("\n")}\n`
      : "",
    input.latestHumanResponse
      ? `Latest human response to a previous question:\n${input.latestHumanResponse}\n`
      : "",
    "Return EXACTLY 3 plan proposals covering different trade-offs:",
    "- conservative: minimal changes, lowest risk, focused scope",
    "- balanced: complete implementation, moderate risk",
    "- thorough: comprehensive solution with tests and edge cases",
    "Set needsHumanInput=true (with a question) ONLY if you cannot safely plan without clarification.",
    "",
    "You MUST return a JSON object with exactly this structure:",
    plannerSchemaHint,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildExecutorPrompt(input: {
  issue: JiraIssue;
  repository: RepositoryRow;
  plan: PlannerRoleOutput;
  allowedCommands: string[];
  validationCommands: string[];
  cycle: number;
  findings: ReviewFinding[];
  diffExcerpt: string;
  latestHumanResponse: string | null;
  repoInstructions: string | null;
}) {
  return [
    "You are the executor role for Arche.",
    "Return only a single JSON object matching the requested schema.",
    "This role is API-only. Use read_files, run_command, and write_file as needed inside the current git worktree. Do not publish changes.",
    `Execution cycle: ${input.cycle}`,
    `Ticket: ${input.issue.key} - ${input.issue.title}`,
    `Repository: ${input.repository.name}`,
    input.repoInstructions
      ? `\nRepository instructions (team conventions — follow these exactly when implementing):\n${input.repoInstructions}\n`
      : "",
    "",
    "Approved plan:",
    input.plan.planMarkdown,
    "",
    "Plan risks:",
    input.plan.risks.join("\n") || "None.",
    "",
    "Reviewer findings to address:",
    formatFindings(input.findings),
    "",
    // When reviewer findings are present, show the current worktree diff so the
    // executor can see exactly what was already written and make targeted fixes.
    input.findings.length > 0 && input.diffExcerpt
      ? `Current worktree diff (what was already implemented — read the files referenced here and fix the issues above):\n${input.diffExcerpt}\n`
      : "",
    `Allowed commands: ${input.allowedCommands.join(", ") || "(none)"}`,
    `Validation commands run after you finish: ${input.validationCommands.join(", ") || "(none)"}`,
    "",
    input.latestHumanResponse
      ? `Latest human response to a previous blocker:\n${input.latestHumanResponse}\n`
      : "",
    "Do not redefine scope. Do NOT ask for human input unless you are completely blocked and cannot proceed — e.g. missing credentials, missing access, or a fundamental ambiguity in the plan that prevents any progress. Never ask for confirmation of work you can verify yourself (diffs, file contents, test results). If in doubt, proceed autonomously.",
    "",
    "IMPORTANT: You MUST implement the plan by calling write_file to create or modify files. Reading files alone is NOT implementation. Do not call finish until you have written all the files required by the plan.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildReviewerPrompt(input: {
  issue: JiraIssue;
  repository: RepositoryRow;
  plan: PlannerRoleOutput;
  diffExcerpt: string;
  validationFindings: ReviewFinding[];
  latestHumanResponse: string | null;
  cycle: number;
  repoInstructions: string | null;
}) {
  return [
    "You are the reviewer role for Arche.",
    "Return only a single JSON object matching the requested schema.",
    "Review the current diff against the approved plan. Focus on regressions, correctness, missing tests, and unresolved validation failures.",
    `Review cycle: ${input.cycle}`,
    `Ticket: ${input.issue.key} - ${input.issue.title}`,
    `Repository: ${input.repository.name}`,
    input.repoInstructions
      ? `\nRepository instructions (conventions the implementation must follow — flag any violation as a finding):\n${input.repoInstructions}\n`
      : "",
    "",
    "Approved plan:",
    input.plan.planMarkdown,
    "",
    "Validation findings from Arche that must be treated as blocking unless clearly invalid:",
    formatFindings(input.validationFindings.slice(0, VALIDATION_FINDINGS_LIMIT)),
    "",
    "Current diff excerpt:",
    input.diffExcerpt || "(no diff)",
    "",
    input.latestHumanResponse
      ? `Latest human response to a previous blocker:\n${input.latestHumanResponse}\n`
      : "",
    "Return decision=approve if the diff is safe and validation findings are resolved. Use decision=request_changes if there are concrete issues to fix. Only use decision=needs_human_input as a last resort when you are genuinely blocked by missing information that cannot be inferred from the diff, plan, or validation output — never ask the human to confirm something you can see in the diff yourself.",
    "IMPORTANT: If the diff is empty or says '(no diff)', you MUST return decision=request_changes with a finding stating that no code changes were implemented. Never approve an empty diff.",
    "",
    "You MUST return a JSON object with exactly this structure:",
    reviewerSchemaHint,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildRoleMessages(
  prompt: string,
  images?: Array<{ url: string }>,
): ProviderMessage[] {
  return [
    { role: "system", content: "You are Arche. Follow the user instructions exactly and return only JSON." },
    {
      role: "user",
      content: prompt,
      ...(images && images.length > 0
        ? { images: images.map((i) => ({ type: "image_url" as const, url: i.url })) }
        : {}),
    },
  ];
}

/**
 * Best-effort cost computation: looks up pricing via OpenRouter, multiplies
 * by usage. Returns null if pricing cannot be resolved (network down, model
 * not in catalog, missing API key) — the caller falls back to leaving the
 * cost unset rather than blocking the run.
 */
async function safeComputeCost(
  usage: ProviderUsage | null | undefined,
  modelId: string,
  apiKeyEnv: string,
): Promise<number | null> {
  if (!usage) return null;
  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) return null;
  try {
    const models: OpenRouterModel[] = await fetchOpenRouterModels(apiKey);
    const breakdown = computeCostFromUsage(usage, modelId, models);
    return breakdown.totalCostUsd;
  } catch {
    return null;
  }
}

function extractUsageFromResponse(response: unknown): ProviderUsage | null {
  if (!response || typeof response !== "object") return null;
  const usage = (response as { usage?: { inputTokens?: number; outputTokens?: number; cachedTokens?: number; cacheReadInputTokens?: number } }).usage;
  if (!usage) return null;
  return {
    promptTokens: usage.inputTokens ?? 0,
    completionTokens: usage.outputTokens ?? 0,
    cachedTokens: usage.cachedTokens ?? usage.cacheReadInputTokens,
  };
}

function createProvider(
  profile: ResolvedExecutionProfile,
  worktreePath?: string,
  role?: string,
  runId?: string,
) {
  return new OpenRouterSdkProvider({
    worktreePath,
    modelName: profile.model,
    fallbackModel: profile.fallback_model ?? null,
    baseUrl: profile.base_url,
    apiKeyEnv: profile.api_key_env,
    temperature: profile.temperature,
    timeoutMs: profile.timeout_seconds * 1000,
    thinkingEnabled: profile.thinking_enabled,
    thinkingBudgetTokens: profile.thinking_budget_tokens,
    role,
    // Forward live SDK deltas to the dashboard's per-run agent stream so the
    // "Agent typing…" panel lights up during planner / reviewer / researcher
    // turns, not just the executor.
    onStreamEvent: runId
      ? async (ev) => {
          const { notifyAgentEvent } = await import("./dashboard/events");
          notifyAgentEvent(runId, ev);
        }
      : undefined,
  });
}

async function writeProviderArtifacts(
  artifactsPath: string,
  basename: string,
  attempts: ProviderAttempt[],
  responseText: string,
) {
  await ensureDirectory(artifactsPath);
  const attemptsArtifactPath = join(artifactsPath, `${basename}-attempts.json`);
  const responseArtifactPath = join(artifactsPath, `${basename}-response.txt`);
  await writeFile(attemptsArtifactPath, JSON.stringify(attempts, null, 2), "utf8");
  await writeFile(responseArtifactPath, responseText, "utf8");
  return { attemptsArtifactPath, responseArtifactPath };
}

async function createRoleTask(
  hooks: WorkflowHooks,
  input: {
    runId: string;
    role: RunTaskRole;
    cycle: number;
    profile: ResolvedExecutionProfile;
    artifactsPath: string;
  },
) {
  return hooks.createTask({
    runId: input.runId,
    role: input.role,
    cycle: input.cycle,
    modelName: input.profile.model,
    profileName: input.profile.name,
    strategy: directRoleStrategy(input.role),
    artifactsPath: input.artifactsPath,
  });
}

export async function runStructuredRole<T extends "planner" | "reviewer">(input: {
  run: RunRow;
  role: T;
  cycle: number;
  prompt: string;
  /** Multimodal image attachments (e.g. Jira ticket screenshots) for the planner. */
  images?: Array<{ url: string }>;
  profile: ResolvedExecutionProfile;
  workerId: string;
  hooks: WorkflowHooks;
}): Promise<RoleOutputResult<T>> {
  const artifactsPath = buildTaskArtifactsPath(input.run, input.role, input.cycle);
  const task = await createRoleTask(input.hooks, {
    runId: input.run.id,
    role: input.role,
    cycle: input.cycle,
    profile: input.profile,
    artifactsPath,
  });
  const workerActivity = input.role === "planner" ? "planning" : "reviewing";
  await input.hooks.setWorkerPhase(input.workerId, input.run, {
    status: "busy",
    activity: workerActivity,
    currentStep: input.cycle,
  });
  await input.hooks.appendRunEvent(input.run.id, `run_task.${input.role}.started`, {
    cycle: input.cycle,
    profileName: input.profile.name,
    modelName: input.profile.model,
    strategy: "direct",
  });
  await input.hooks.appendSystemRunLog(
    input.run.id,
    `starting ${input.role} cycle ${input.cycle} with profile ${input.profile.name}`,
  );

  try {
    const provider = createProvider(input.profile, undefined, input.role, input.run.id);
    const messages = buildRoleMessages(input.prompt, input.images);
    const result =
      input.role === "planner"
        ? await provider.completeStructured(messages, plannerRoleOutputSchema, plannerSchemaHint)
        : await provider.completeStructured(messages, reviewerRoleOutputSchema, reviewerSchemaHint);
    const artifactFiles = await writeProviderArtifacts(
      artifactsPath,
      `${input.role}-cycle-${input.cycle}`,
      result.attempts,
      result.responseText,
    );
    const output = result.output as RoleOutputByRole[T];
    const needsHumanInput =
      input.role === "planner" ? Boolean((output as PlannerRoleOutput).needsHumanInput) : false;

    const taskCost = await safeComputeCost(result.usage, input.profile.model, input.profile.api_key_env);
    await input.hooks.completeTask(task.id, {
      status: needsHumanInput ? "needs_human_input" : "completed",
      summary:
        input.role === "planner"
          ? (output as PlannerRoleOutput).planMarkdown
          : (output as ReviewerRoleOutput).summary,
      outputJson: output as Record<string, unknown>,
      usage: result.usage,
      estimatedCostUsd: taskCost,
    });
    await input.hooks.appendRunEvent(input.run.id, `provider.${input.role}.artifacts`, {
      cycle: input.cycle,
      profileName: input.profile.name,
      attemptsArtifactPath: artifactFiles.attemptsArtifactPath,
      responseArtifactPath: artifactFiles.responseArtifactPath,
      attemptCount: result.attempts.length,
    });
    await input.hooks.appendRunMessage(input.run.id, "assistant", input.role, result.responseText, extractLastThinking(result.attempts));
    await input.hooks.appendRunEvent(input.run.id, `run_task.${input.role}.completed`, {
      cycle: input.cycle,
      needsHumanInput,
    });
    return {
      taskId: task.id,
      artifactsPath,
      output,
    };
  } catch (error) {
    await input.hooks.completeTask(task.id, {
      status: "failed",
      summary: error instanceof Error ? error.message : "Unknown task error",
    });
    await input.hooks.appendRunEvent(input.run.id, `run_task.${input.role}.failed`, {
      cycle: input.cycle,
      reason: error instanceof Error ? error.message : "Unknown task error",
    });
    throw error;
  }
}

export async function runExecutorPatchLoop(input: {
  run: RunRow;
  cycle: number;
  prompt: string;
  profile: ResolvedExecutionProfile;
  workerId: string;
  repository: RepositoryRow;
  worktreePath: string;
  sandboxId: string;
  hooks: WorkflowHooks;
  /** When true, the executor MUST write at least one file — reviewer findings are pending. */
  hasPendingFindings: boolean;
  /** Optional extra tools (web_search, fetch_url) resolved from .arche/tools.json */
  extraToolNames?: string[];
}): Promise<RoleOutputResult<"executor">> {
  const config = await getConfig();
  const artifactsPath = buildTaskArtifactsPath(input.run, "executor", input.cycle);
  const task = await createRoleTask(input.hooks, {
    runId: input.run.id,
    role: "executor",
    cycle: input.cycle,
    profile: input.profile,
    artifactsPath,
  });

  const provider = createProvider(input.profile, input.worktreePath, "executor", input.run.id);
  const sandbox = new SandboxManager(config);
  const git = new GitManager(config);
  const repositoryTree = (await git.trackedFiles(input.worktreePath)).slice(0, 400);

  const extraTools = buildExtraTools(input.extraToolNames ?? [], {
    fetchUrlTimeoutMs: config.worker.fetch_url_timeout_ms,
    webSearchTimeoutMs: config.worker.web_search_timeout_ms,
  });
  const { tools: builtinTools, state } = createExecutorTools({
    provider,
    sandbox,
    git,
    config,
    run: input.run,
    cycle: input.cycle,
    workerId: input.workerId,
    repository: input.repository,
    worktreePath: input.worktreePath,
    sandboxId: input.sandboxId,
    hooks: input.hooks,
    hasPendingFindings: input.hasPendingFindings,
  });
  const tools = [...builtinTools, ...extraTools];

  const systemPrompt = [
    "You are the executor role for Arche — a coding agent that IMPLEMENTS approved plans by writing code.",
    "Your job is to produce working code changes that fulfill the approved plan. You MUST write or modify files.",
    "",
    "## Workflow",
    "1. Read the relevant source files to understand current code (use read_files).",
    "2. Implement the changes described in the approved plan by writing files (use write_file).",
    "3. Optionally run commands to verify your changes (use run_command).",
    "4. When ALL planned changes are implemented and written to disk, call finish.",
    "",
    "## Critical rules",
    "- You MUST call write_file (or delete_file/apply_patch) at least once before calling finish.",
    "- Do NOT call finish if you have only read files — reading is preparation, not implementation.",
    "- Each write_file must contain the COMPLETE file content (not a partial snippet).",
    "- Do not publish or push changes — Arche handles that after you finish.",
    "- Do not ask to list files; the repository tree is already provided below.",
  ].join("\n");

  await input.hooks.setWorkerPhase(input.workerId, input.run, {
    status: "waiting",
    activity: "waiting_provider",
    currentStep: input.cycle,
  });
  await input.hooks.appendRunEvent(input.run.id, "run_task.executor.started", {
    cycle: input.cycle,
    profileName: input.profile.name,
    modelName: input.profile.model,
    strategy: "tool_loop",
  });
  await input.hooks.appendSystemRunLog(
    input.run.id,
    `starting executor cycle ${input.cycle} with profile ${input.profile.name}`,
  );

  const apiKey = process.env[input.profile.api_key_env];
  if (!apiKey) {
    throw new ExternalServiceError(
      `Missing API key environment variable referenced by ${input.profile.api_key_env}`,
    );
  }
  const isAnthropic = input.profile.model.startsWith("anthropic/");
  const temperature =
    input.profile.thinking_enabled && isAnthropic
      ? 1.0
      : typeof input.profile.temperature === "number"
        ? input.profile.temperature
        : 0.1;

  const client = new OpenRouter({ apiKey, serverURL: input.profile.base_url });

  // Pre-fetch pricing once so onTurnEnd can compute incremental cost without
  // hitting the OpenRouter models endpoint on every turn. Best-effort: if it
  // fails we just don't enforce the cost cap (stop condition stays false).
  let pricingModels: OpenRouterModel[] | null = null;
  try {
    pricingModels = await fetchOpenRouterModels(apiKey);
  } catch {
    pricingModels = null;
  }

  const stopConditions = [
    stepCountIs(input.profile.max_actions),
    () => state.finishResult !== null,
    // Cumulative cost cap. Use the SDK's built-in maxCost when configured —
    // it reads usage.cost from each step's API response, so it's the
    // authoritative figure as far as OpenRouter is concerned. Our own
    // `state.estimatedCostUsd` (computed in onTurnEnd from pricing × tokens)
    // remains useful for the dashboard but no longer drives the stop.
    ...(input.profile.max_run_cost_usd && input.profile.max_run_cost_usd > 0
      ? [maxCost(input.profile.max_run_cost_usd)]
      : []),
  ];

  const sdkResult = client.callModel(
    {
      model: input.profile.model,
      instructions: systemPrompt,
      input: `${input.prompt}\n\nRepository tree:\n${repositoryTree.join("\n") || "(empty repo)"}`,
      temperature,
      tools,
      stopWhen: stopConditions,
      // Pre-execution gate for destructive shell commands. The allowlist on
      // `run_command` already blocks anything outside the configured set, but
      // this is a second-line defense: even when an operator widens the
      // allowlist (e.g. to permit `rm` for cleanup scripts), require explicit
      // human approval before the SDK executes those calls. The SDK pauses on
      // the tool call and surfaces it back via the response object so the run
      // can transition to needs_human_input via our existing extractor.
      requireApproval: async (toolCall) => {
        if (toolCall.name !== "run_command") return false;
        const args = toolCall.arguments as { command?: string } | undefined;
        const cmd = typeof args?.command === "string" ? args.command : "";
        return /\b(rm|sudo|curl|wget|chmod\s+777|dd\s+if|:\(\)\s*\{\s*:\|:&\s*\};:)/i.test(cmd);
      },
      // Check cancellation at the start of each tool-execution round.
      onTurnStart: async () => {
        await input.hooks.ensureNotCancelled(input.run.id);
        await input.hooks.setWorkerPhase(input.workerId, input.run, {
          status: "waiting",
          activity: "waiting_provider",
        });
      },
      // Accumulate per-turn cost so the maxCost stop condition can fire mid-loop.
      // The SDK gives us the completed response after each turn — we extract
      // its usage and add the dollar cost to the running total.
      onTurnEnd: async (_ctx, turnResponse) => {
        if (!pricingModels) return;
        const turnUsage = extractUsageFromResponse(turnResponse);
        if (!turnUsage) return;
        const breakdown = computeCostFromUsage(turnUsage, input.profile.model, pricingModels);
        state.estimatedCostUsd += breakdown.totalCostUsd;
      },
    },
    {
      headers: {
        "HTTP-Referer": "https://github.com/anthropics/arche",
        "X-Title": "Arche-executor",
      },
      timeoutMs: input.profile.timeout_seconds * 1000,
      retries: { strategy: "none" },
    },
  );

  // Concurrent consumer: forward streaming SDK events to the dashboard's
  // per-run agent-stream channel so the UI can render the model "typing" in
  // real time (text deltas, tool calls, preliminary tool results) instead of
  // staring at a spinner until getResponse() resolves at the end.
  const agentStreamPump = (async () => {
    try {
      const { notifyAgentEvent } = await import("./dashboard/events");
      for await (const ev of sdkResult.getFullResponsesStream()) {
        // The SDK emits a wide union — we only cherry-pick the events that
        // map cleanly onto our dashboard's "agent typing" view.
        const t = (ev as { type: string }).type;
        if (t === "response.output_text.delta") {
          notifyAgentEvent(input.run.id, { type: "text_delta", delta: (ev as { delta: string }).delta });
        } else if (t === "response.reasoning_summary_text.delta") {
          notifyAgentEvent(input.run.id, { type: "reasoning_delta", delta: (ev as { delta: string }).delta });
        } else if (t === "response.function_call_arguments.delta") {
          notifyAgentEvent(input.run.id, { type: "tool_call_args_delta", delta: (ev as { delta: string }).delta });
        } else if (t === "tool.preliminary_result") {
          const e = ev as { toolCallId: string; result: unknown };
          notifyAgentEvent(input.run.id, { type: "tool_preliminary", toolCallId: e.toolCallId, result: e.result });
        }
      }
      notifyAgentEvent(input.run.id, { type: "done" });
    } catch {
      // Non-fatal — the main getResponse() still drives the workflow.
    }
  })();

  try {
    const response = await sdkResult.getResponse();
    await agentStreamPump.catch(() => undefined);

    // Save full response as artifact (best-effort — observability only, must not fail the run).
    try {
      await ensureDirectory(artifactsPath);
      const artifactPath = join(artifactsPath, `executor-cycle-${input.cycle}-response.json`);
      await writeFile(artifactPath, JSON.stringify(response, null, 2), "utf8");
      await input.hooks.appendRunEvent(input.run.id, "provider.executor.artifacts", {
        cycle: input.cycle,
        profileName: input.profile.name,
        responseArtifactPath: artifactPath,
      });
    } catch (artifactError) {
      await input.hooks.appendSystemRunLog(
        input.run.id,
        `warning: failed to save executor artifact: ${artifactError instanceof Error ? artifactError.message : "unknown"}`,
      );
    }

    const executorUsage = extractUsageFromResponse(response);
    const executorCost = await safeComputeCost(executorUsage, input.profile.model, input.profile.api_key_env);

    // --- Successful finish ---
    if (state.finishResult) {
      const output: ExecutorRoleOutput = {
        ...state.finishResult,
        needsHumanInput: false,
      };
      await input.hooks.completeTask(task.id, {
        status: "completed",
        summary: output.summary,
        outputJson: output as Record<string, unknown>,
        usage: executorUsage,
        estimatedCostUsd: executorCost,
      });
      await input.hooks.appendRunEvent(input.run.id, "run_task.executor.completed", {
        cycle: input.cycle,
        needsHumanInput: false,
        filesMutated: state.filesMutated,
      });
      if (state.filesMutated === 0) {
        await input.hooks.appendSystemRunLog(
          input.run.id,
          `warning: executor completed without writing any files after retries`,
        );
      }
      return { taskId: task.id, artifactsPath, output };
    }

    // --- needs_human_input ---
    const humanInputCall = extractHumanInputCall(
      response.output as Array<{ type?: string; name?: string; arguments?: string }>,
    );
    if (humanInputCall) {
      const output: ExecutorRoleOutput = {
        summary: "Executor requires human input.",
        implementedPlanDelta: "No additional changes applied.",
        needsHumanInput: true,
        question: humanInputCall.question,
      };
      await input.hooks.completeTask(task.id, {
        status: "needs_human_input",
        summary: output.summary,
        outputJson: output as Record<string, unknown>,
        usage: executorUsage,
        estimatedCostUsd: executorCost,
      });
      await input.hooks.appendRunEvent(input.run.id, "run_task.executor.completed", {
        cycle: input.cycle,
        needsHumanInput: true,
      });
      return { taskId: task.id, artifactsPath, output };
    }

    // --- Budget exhausted: transition to needs_human_input instead of failing hard ---
    const budgetMsg = state.filesMutated > 0
      ? `The executor used all ${input.profile.max_actions} allowed steps. ${state.filesMutated} file(s) were modified — review the current diff and respond to continue (retry-executor will pick up from here), or adjust the plan.`
      : `The executor used all ${input.profile.max_actions} allowed steps without modifying any files. The plan may be too large for the current budget. Consider splitting the ticket or increasing max_actions in orchestrator.yml, then retry.`;
    const budgetOutput: ExecutorRoleOutput = {
      summary: `Action budget exhausted (${input.profile.max_actions} steps used).`,
      implementedPlanDelta: "Implementation incomplete — budget exhausted before finish.",
      needsHumanInput: true,
      question: budgetMsg,
    };
    await input.hooks.completeTask(task.id, {
      status: "needs_human_input",
      summary: budgetOutput.summary,
      outputJson: budgetOutput as Record<string, unknown>,
      usage: executorUsage,
      estimatedCostUsd: executorCost,
    });
    await input.hooks.appendRunEvent(input.run.id, "run_task.executor.completed", {
      cycle: input.cycle,
      needsHumanInput: true,
      budgetExhausted: true,
    });
    return { taskId: task.id, artifactsPath, output: budgetOutput };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown task error";

    // SDK quirk we have to work around:
    //
    //   The OpenRouter SDK always sends a "followup turn" to the model after
    //   tool execution to give it a chance to produce a final assistant
    //   message. Our `finish` tool intentionally tells the model "Execution
    //   complete. Do not call any more tools." — which the well-behaved models
    //   correctly obey by emitting nothing. The SDK then sees an empty
    //   `output` array and throws `Invalid final response: empty or invalid
    //   output` from `validateFinalResponse()`.
    //
    //   At this point `state.finishResult` is already set (the finish tool ran
    //   and validation passed before we got here), so the executor *did*
    //   succeed — only the SDK's terminal validation is unhappy. Convert this
    //   into the same "successful finish" path we'd take if the SDK had been
    //   permissive.
    const isEmptyTerminalOutput =
      message.includes("Invalid final response") ||
      message.includes("empty or invalid output");
    if (isEmptyTerminalOutput && state.finishResult) {
      const output: ExecutorRoleOutput = {
        ...state.finishResult,
        needsHumanInput: false,
      };
      // state.estimatedCostUsd is updated in onTurnEnd, which fires after the
      // empty followup turn — so this captures cost we DID pay even though
      // the SDK threw on validation. Store it so the dashboard surfaces the
      // real billable amount.
      await input.hooks.completeTask(task.id, {
        status: "completed",
        summary: output.summary,
        outputJson: output as Record<string, unknown>,
        estimatedCostUsd: state.estimatedCostUsd > 0 ? state.estimatedCostUsd : null,
      });
      await input.hooks.appendRunEvent(input.run.id, "run_task.executor.completed", {
        cycle: input.cycle,
        needsHumanInput: false,
        filesMutated: state.filesMutated,
        sdkEmptyFollowup: true,
      });
      await input.hooks.appendSystemRunLog(
        input.run.id,
        "executor finished cleanly (SDK reported empty followup turn — expected after finish tool)",
      );
      return { taskId: task.id, artifactsPath, output };
    }

    // Empty terminal output WITHOUT a finish call — the model genuinely
    // bailed mid-loop. Surface as needs_human_input with the partial diff so
    // the user can decide whether to continue, retry, or cancel rather than
    // burning the whole run on what may be a transient model glitch.
    if (isEmptyTerminalOutput) {
      const output: ExecutorRoleOutput = {
        summary: "Executor stopped without producing a final response.",
        implementedPlanDelta: state.filesMutated > 0
          ? `Wrote ${state.filesMutated} file(s) but the model did not call finish. The current diff is partial.`
          : "Model produced no output and no files were written.",
        needsHumanInput: true,
        question:
          state.filesMutated > 0
            ? `Executor wrote ${state.filesMutated} file(s) but did not call finish. Reply with guidance to continue, or cancel.`
            : "Executor produced no output and wrote nothing. Reply with guidance or cancel the run.",
      };
      await input.hooks.completeTask(task.id, {
        status: "needs_human_input",
        summary: output.summary,
        outputJson: output as Record<string, unknown>,
        estimatedCostUsd: state.estimatedCostUsd > 0 ? state.estimatedCostUsd : null,
      });
      await input.hooks.appendRunEvent(input.run.id, "run_task.executor.completed", {
        cycle: input.cycle,
        needsHumanInput: true,
        emptyResponse: true,
      });
      return { taskId: task.id, artifactsPath, output };
    }

    await input.hooks.completeTask(task.id, {
      status: "failed",
      summary: message,
    });
    await input.hooks.appendRunEvent(input.run.id, "run_task.executor.failed", {
      cycle: input.cycle,
      reason: message,
    });
    throw error;
  }
}

function buildRunArtifactsPath(logsDir: string, runId: string) {
  return join(logsDir, "runs", runId);
}
