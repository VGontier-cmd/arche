import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getConfig, type OrchestratorConfig } from "../config";
import type { RepositoryRow, RunRow } from "../db/schema";
import { CancelledError, ExternalServiceError } from "./errors";
import { GitManager } from "./git";
import { redactText, truncateText } from "./logging";
import {
  OpenRouterSdkProvider,
  type ProviderAttempt,
  type ProviderMessage,
} from "./provider";
import {
  plannerRoleOutputSchema,
  reviewerRoleOutputSchema,
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
import { ensureDirectory, isArgvAllowed, parseCommand } from "./utils";
import type { WorkerActivity, WorkerStatus } from "./workers";

const RUN_MESSAGE_LIMIT = 1200;
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

export function buildPlannerPrompt(input: {
  issue: JiraIssue;
  repository: RepositoryRow;
  allowedCommands: string[];
  validationCommands: string[];
  trackedFiles: string[];
  requirePublishApproval: boolean;
  latestHumanResponse: string | null;
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
    `Allowed commands for later execution: ${input.allowedCommands.join(", ") || "(none)"}`,
    `Validation commands: ${input.validationCommands.join(", ") || "(none)"}`,
    `Publish approval required: ${input.requirePublishApproval ? "yes" : "no"}`,
    "",
    "Repository tree sample:",
    input.trackedFiles.slice(0, 400).join("\n") || "(empty repo)",
    "",
    input.latestHumanResponse
      ? `Latest human response to a previous question:\n${input.latestHumanResponse}\n`
      : "",
    "Return a concrete implementation plan, explicit risks, and open questions. Set needsHumanInput=true only if you cannot safely continue planning.",
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
  latestHumanResponse: string | null;
}) {
  return [
    "You are the executor role for Arche.",
    "Return only a single JSON object matching the requested schema.",
    "This role is API-only. Use read_files, run_command, and apply_patch as needed inside the current git worktree. Do not publish changes.",
    `Execution cycle: ${input.cycle}`,
    `Ticket: ${input.issue.key} - ${input.issue.title}`,
    `Repository: ${input.repository.name}`,
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
    `Allowed commands: ${input.allowedCommands.join(", ") || "(none)"}`,
    `Validation commands run after you finish: ${input.validationCommands.join(", ") || "(none)"}`,
    "",
    input.latestHumanResponse
      ? `Latest human response to a previous blocker:\n${input.latestHumanResponse}\n`
      : "",
    "Do not redefine scope. If the approved plan is insufficient or ambiguous, return action=needs_human_input with one concrete question.",
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
}) {
  return [
    "You are the reviewer role for Arche.",
    "Return only a single JSON object matching the requested schema.",
    "Review the current diff against the approved plan. Focus on regressions, correctness, missing tests, and unresolved validation failures.",
    `Review cycle: ${input.cycle}`,
    `Ticket: ${input.issue.key} - ${input.issue.title}`,
    `Repository: ${input.repository.name}`,
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
    "Return decision=approve only if the diff is safe and validation findings are resolved. If you need clarification from a human, use decision=needs_human_input and include a question.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildRoleMessages(prompt: string): ProviderMessage[] {
  return [
    { role: "system", content: "You are Arche. Follow the user instructions exactly and return only JSON." },
    { role: "user", content: prompt },
  ];
}

function createProvider(profile: ResolvedExecutionProfile, worktreePath?: string) {
  return new OpenRouterSdkProvider({
    worktreePath,
    modelName: profile.model,
    baseUrl: profile.base_url,
    apiKeyEnv: profile.api_key_env,
    temperature: profile.temperature,
    timeoutMs: profile.timeout_seconds * 1000,
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

function summarizeProviderAction(action: RoleAction) {
  if (action.action === "read_files") {
    const targets =
      action.files?.map((file) => file.path) ??
      action.paths ??
      [];
    return `Requested file reads for ${targets.slice(0, 5).join(", ")}${targets.length > 5 ? ", ..." : ""}`;
  }
  if (action.action === "run_command") {
    return `Requested command: ${action.command}`;
  }
  if (action.action === "apply_patch") {
    return "Requested a patch application.";
  }
  if (action.action === "finish") {
    return `Finished the run: ${action.summary}`;
  }
  return `Requested human input: ${action.question}`;
}

function summarizeObservation(observation: unknown) {
  if (Array.isArray(observation)) {
    return `Observation returned ${observation.length} item(s).`;
  }
  if (observation && typeof observation === "object") {
    if ("error" in observation && typeof observation.error === "string") {
      return observation.error;
    }
    if ("returncode" in observation && typeof observation.returncode === "number") {
      const stdoutLength =
        "stdout" in observation && typeof observation.stdout === "string" ? observation.stdout.length : 0;
      const stderrLength =
        "stderr" in observation && typeof observation.stderr === "string" ? observation.stderr.length : 0;
      return `Command completed with exit code ${observation.returncode} (stdout ${stdoutLength} chars, stderr ${stderrLength} chars).`;
    }
    if ("result" in observation && typeof observation.result === "string") {
      return `Tool result: ${observation.result}`;
    }
  }
  const serialized = JSON.stringify(observation);
  return serialized ? truncateText(serialized, RUN_MESSAGE_LIMIT) : "Observation updated.";
}

type RoleAction = ExecutorAction;
type ExecutorAction = Awaited<ReturnType<OpenRouterSdkProvider["completeAction"]>>["action"];

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
    const provider = createProvider(input.profile);
    const messages = buildRoleMessages(input.prompt);
    const result =
      input.role === "planner"
        ? await provider.completeStructured(messages, plannerRoleOutputSchema)
        : await provider.completeStructured(messages, reviewerRoleOutputSchema);
    const artifactFiles = await writeProviderArtifacts(
      artifactsPath,
      `${input.role}-cycle-${input.cycle}`,
      result.attempts,
      result.responseText,
    );
    const output = result.output as RoleOutputByRole[T];
    const needsHumanInput =
      input.role === "planner" ? Boolean((output as PlannerRoleOutput).needsHumanInput) : false;

    await input.hooks.completeTask(task.id, {
      status: needsHumanInput ? "needs_human_input" : "completed",
      summary:
        input.role === "planner"
          ? (output as PlannerRoleOutput).planMarkdown
          : (output as ReviewerRoleOutput).summary,
      outputJson: output as Record<string, unknown>,
    });
    await input.hooks.appendRunEvent(input.run.id, `provider.${input.role}.artifacts`, {
      cycle: input.cycle,
      profileName: input.profile.name,
      attemptsArtifactPath: artifactFiles.attemptsArtifactPath,
      responseArtifactPath: artifactFiles.responseArtifactPath,
      attemptCount: result.attempts.length,
    });
    await input.hooks.appendRunMessage(input.run.id, "assistant", input.role, result.responseText);
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
  const provider = createProvider(input.profile, input.worktreePath);
  const sandbox = new SandboxManager(config);
  const git = new GitManager(config);
  const repositoryTree = (await git.trackedFiles(input.worktreePath)).slice(0, 400);
  const messages: ProviderMessage[] = [
    {
      role: "system",
      content: [
        "You are the executor role for Arche.",
        "Return only JSON objects.",
        "Available actions: read_files, run_command, apply_patch, finish, needs_human_input.",
        "Do not publish changes.",
        "Do not ask to list files; the repository tree is already provided.",
      ].join("\n"),
    },
    {
      role: "user",
      content: `${input.prompt}\n\nRepository tree:\n${repositoryTree.join("\n") || "(empty repo)"}`,
    },
  ];

  await input.hooks.setWorkerPhase(input.workerId, input.run, {
    status: "busy",
    activity: "executing",
    currentStep: input.cycle,
  });
  await input.hooks.appendRunEvent(input.run.id, "run_task.executor.started", {
    cycle: input.cycle,
    profileName: input.profile.name,
    modelName: input.profile.model,
    strategy: "patch_loop",
  });
  await input.hooks.appendSystemRunLog(
    input.run.id,
    `starting executor cycle ${input.cycle} with profile ${input.profile.name}`,
  );

  await ensureDirectory(artifactsPath);

  try {
    for (let step = 0; step < input.profile.max_actions; step += 1) {
      await input.hooks.ensureNotCancelled(input.run.id);
      await input.hooks.setWorkerPhase(input.workerId, input.run, {
        status: "waiting",
        activity: "waiting_provider",
        currentStep: step + 1,
      });

      const result = await provider.completeAction(messages);
      const artifactFiles = await writeProviderArtifacts(
        artifactsPath,
        `executor-cycle-${input.cycle}-step-${step + 1}`,
        result.attempts,
        result.responseText,
      );
      await input.hooks.appendRunEvent(input.run.id, "provider.executor.artifacts", {
        cycle: input.cycle,
        step: step + 1,
        profileName: input.profile.name,
        attemptsArtifactPath: artifactFiles.attemptsArtifactPath,
        responseArtifactPath: artifactFiles.responseArtifactPath,
        attemptCount: result.attempts.length,
      });
      await input.hooks.appendRunMessage(input.run.id, "assistant", "executor", result.responseText);
      const action = result.action;
      await input.hooks.appendRunEvent(input.run.id, "provider.action_received", {
        cycle: input.cycle,
        step: step + 1,
        action: action.action,
      });
      await input.hooks.appendRunMessage(
        input.run.id,
        "assistant",
        "action",
        summarizeProviderAction(action),
      );

      let observation: unknown;
      if (action.action === "read_files") {
        observation = await provider.readFiles(action);
      } else if (action.action === "run_command") {
        const allowedCommands =
          input.repository.allowedCommands.length > 0
            ? input.repository.allowedCommands
            : config.defaults.allowed_commands;
        let parsedCommand: ReturnType<typeof parseCommand> | null = null;
        try {
          parsedCommand = parseCommand(action.command);
        } catch (error) {
          observation = { error: error instanceof Error ? error.message : "Command parsing failed" };
        }

        if (!parsedCommand) {
          // Observation already set.
        } else if (!isArgvAllowed(parsedCommand.argv, allowedCommands)) {
          observation = { error: `Command is not allowed: ${parsedCommand.normalized}` };
          await input.hooks.appendRunEvent(input.run.id, "provider.command_rejected", {
            cycle: input.cycle,
            step: step + 1,
            command: parsedCommand.normalized,
          });
        } else {
          await input.hooks.setWorkerPhase(input.workerId, input.run, {
            status: "busy",
            activity: "running_command",
            currentStep: step + 1,
          });
          const commandResult = await sandbox.run(
            input.sandboxId,
            parsedCommand.argv,
            config.worker.max_run_seconds * 1000,
          );
          await input.hooks.recordRunCommand({
            runId: input.run.id,
            phase: "executor",
            result: commandResult,
          });
          observation = {
            returncode: commandResult.returncode,
            stdout: truncateText(redactText(commandResult.stdout), 8000),
            stderr: truncateText(redactText(commandResult.stderr), 8000),
          };
        }
      } else if (action.action === "apply_patch") {
        await git.applyPatch(input.worktreePath, action.patch);
        observation = { result: "patch_applied" };
      } else if (action.action === "needs_human_input") {
        const output: ExecutorRoleOutput = {
          summary: "Executor requires human input.",
          implementedPlanDelta: "No additional changes applied.",
          needsHumanInput: true,
          question: action.question,
        };
        await input.hooks.completeTask(task.id, {
          status: "needs_human_input",
          summary: output.summary,
          outputJson: output as Record<string, unknown>,
        });
        await input.hooks.appendRunEvent(input.run.id, "run_task.executor.completed", {
          cycle: input.cycle,
          needsHumanInput: true,
        });
        return {
          taskId: task.id,
          artifactsPath,
          output,
        };
      } else {
        const output: ExecutorRoleOutput = {
          summary: action.summary,
          implementedPlanDelta: action.implementedPlanDelta,
          needsHumanInput: false,
        };
        await input.hooks.completeTask(task.id, {
          status: "completed",
          summary: output.summary,
          outputJson: output as Record<string, unknown>,
        });
        await input.hooks.appendRunEvent(input.run.id, "run_task.executor.completed", {
          cycle: input.cycle,
          needsHumanInput: false,
        });
        return {
          taskId: task.id,
          artifactsPath,
          output,
        };
      }

      await input.hooks.appendRunMessage(
        input.run.id,
        "tool",
        "observation",
        summarizeObservation(observation),
      );
      messages.push({ role: "assistant", content: JSON.stringify(action) });
      messages.push({ role: "user", content: JSON.stringify(observation) });
    }

    throw new ExternalServiceError("Executor action budget exhausted");
  } catch (error) {
    await input.hooks.completeTask(task.id, {
      status: "failed",
      summary: error instanceof Error ? error.message : "Unknown task error",
    });
    await input.hooks.appendRunEvent(input.run.id, "run_task.executor.failed", {
      cycle: input.cycle,
      reason: error instanceof Error ? error.message : "Unknown task error",
    });
    throw error instanceof CancelledError ? error : error;
  }
}

function buildRunArtifactsPath(logsDir: string, runId: string) {
  return join(logsDir, "runs", runId);
}
