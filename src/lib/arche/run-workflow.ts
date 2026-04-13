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
  executorActionSchemaHint,
  plannerRoleOutputSchema,
  plannerSchemaHint,
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

export function buildPlannerPrompt(input: {
  issue: JiraIssue;
  repository: RepositoryRow;
  allowedCommands: string[];
  validationCommands: string[];
  trackedFiles: string[];
  requirePublishApproval: boolean;
  latestHumanResponse: string | null;
  recentCommits: string[];
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
    input.recentCommits.length > 0
      ? `Recent commits on this branch:\n${input.recentCommits.join("\n")}\n`
      : "",
    input.latestHumanResponse
      ? `Latest human response to a previous question:\n${input.latestHumanResponse}\n`
      : "",
    "Return a concrete implementation plan, explicit risks, and open questions. Set needsHumanInput=true only if you cannot safely continue planning.",
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
}) {
  return [
    "You are the executor role for Arche.",
    "Return only a single JSON object matching the requested schema.",
    "This role is API-only. Use read_files, run_command, and write_file as needed inside the current git worktree. Do not publish changes.",
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
    "",
    "You MUST return a JSON action object. Valid formats:",
    executorActionSchemaHint,
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
    "Return decision=approve if the diff is safe and validation findings are resolved. Use decision=request_changes if there are concrete issues to fix. Only use decision=needs_human_input as a last resort when you are genuinely blocked by missing information that cannot be inferred from the diff, plan, or validation output — never ask the human to confirm something you can see in the diff yourself.",
    "IMPORTANT: If the diff is empty or says '(no diff)', you MUST return decision=request_changes with a finding stating that no code changes were implemented. Never approve an empty diff.",
    "",
    "You MUST return a JSON object with exactly this structure:",
    reviewerSchemaHint,
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
  if (action.action === "write_file") {
    return `Writing file: ${action.path}`;
  }
  if (action.action === "delete_file") {
    return `Deleting file: ${action.path}`;
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
  /** When true, the executor MUST write at least one file — reviewer findings are pending. */
  hasPendingFindings: boolean;
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
        "- Return exactly one JSON object per step. No markdown, no commentary, just JSON.",
        "",
        "Valid JSON action formats:",
        executorActionSchemaHint,
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

  let filesMutated = 0;
  let emptyFinishRetries = 0;
  let validationRetries = 0;
  const MAX_EMPTY_FINISH_RETRIES = 2;
  const MAX_VALIDATION_RETRIES = 3;

  try {
    for (let step = 0; step < input.profile.max_actions; step += 1) {
      await input.hooks.ensureNotCancelled(input.run.id);
      await input.hooks.setWorkerPhase(input.workerId, input.run, {
        status: "waiting",
        activity: "waiting_provider",
        currentStep: step + 1,
      });

      const result = await provider.completeAction(messages, executorActionSchemaHint);
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
      } else if (action.action === "write_file") {
        try {
          observation = await provider.writeFile(action.path, action.content);
          filesMutated++;
        } catch (error) {
          observation = { error: error instanceof Error ? error.message : "File write failed" };
        }
      } else if (action.action === "delete_file") {
        try {
          observation = await provider.deleteFile(action.path);
          filesMutated++;
        } catch (error) {
          observation = { error: error instanceof Error ? error.message : "File delete failed" };
        }
      } else if (action.action === "apply_patch") {
        try {
          await git.applyPatch(input.worktreePath, action.patch);
          observation = { result: "patch_applied" };
          filesMutated++;
        } catch (error) {
          observation = { error: error instanceof Error ? error.message : "Patch application failed" };
        }
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
        // finish action — validate that code was actually written
        if (filesMutated === 0 && emptyFinishRetries < MAX_EMPTY_FINISH_RETRIES) {
          emptyFinishRetries++;
          await input.hooks.appendSystemRunLog(
            input.run.id,
            `executor called finish without writing any files (attempt ${emptyFinishRetries}/${MAX_EMPTY_FINISH_RETRIES}), requesting implementation`,
          );
          await input.hooks.appendRunEvent(input.run.id, "provider.empty_finish_rejected", {
            cycle: input.cycle,
            step: step + 1,
            attempt: emptyFinishRetries,
          });
          // Bounce back — tell the model to actually write code
          const rejection = {
            error: "You called finish but have not written any files yet. " +
              "Your job is to IMPLEMENT the approved plan by calling write_file to create or modify source files. " +
              "Read the plan again, identify the files that need to change, and use write_file to make those changes. " +
              "Do not call finish until you have written at least one file.",
          };
          messages.push({ role: "assistant", content: JSON.stringify(action) });
          messages.push({ role: "user", content: JSON.stringify(rejection) });
          observation = undefined; // skip the normal observation push below
          continue;
        }

        // Validation-gated finish — run validation suite before accepting finish
        if (filesMutated > 0 && validationRetries < MAX_VALIDATION_RETRIES) {
          const validationResult = await input.hooks.runValidation(input.sandboxId);
          if (validationResult.findings.length > 0) {
            validationRetries++;
            await input.hooks.appendSystemRunLog(
              input.run.id,
              `validation failed after finish (attempt ${validationRetries}/${MAX_VALIDATION_RETRIES}), asking executor to fix`,
            );
            await input.hooks.appendRunEvent(input.run.id, "validation.findings_injected", {
              cycle: input.cycle,
              step: step + 1,
              findingCount: validationResult.findings.length,
              attempt: validationRetries,
            });
            messages.push({ role: "assistant", content: JSON.stringify(action) });
            messages.push({
              role: "user",
              content: JSON.stringify({
                status: "validation_failed",
                findings: validationResult.findings,
                instruction:
                  "Validation failed. Fix the issues listed above, then call finish again.",
              }),
            });
            observation = undefined;
            continue;
          }
        }

        // Hard-fail if reviewer findings were present but executor wrote nothing.
        // Silently accepting a no-op finish with outstanding findings would cause
        // the reviewer to see the same code again and request_changes indefinitely.
        if (filesMutated === 0 && input.hasPendingFindings) {
          throw new ExternalServiceError(
            `Executor completed cycle ${input.cycle} without writing any files despite reviewer findings. ` +
            `The reviewer's findings must be addressed by modifying files before calling finish.`,
          );
        }

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
          filesMutated,
        });
        if (filesMutated === 0) {
          await input.hooks.appendSystemRunLog(
            input.run.id,
            `warning: executor completed without writing any files after ${MAX_EMPTY_FINISH_RETRIES} retries`,
          );
        }
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
