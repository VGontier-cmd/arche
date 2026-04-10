import { dirname } from "node:path";

import { eq } from "drizzle-orm";

import { getConfig, type OrchestratorConfig } from "../../config";
import { db, withSqliteWriteRetry } from "../../db/client";
import {
  runs,
  type RepositoryRow,
  type RunRow,
  type RunTaskRow,
} from "../../db/schema";
import { readSecretEnv } from "../../env";
import { GitManager } from "../git";
import { GitLabClient } from "../gitlab";
import { JiraClient, normalizeIssue } from "../jira";
import { ExternalServiceError, CancelledError } from "../errors";
import {
  buildExecutorPrompt,
  buildPlannerPrompt,
  buildReviewerPrompt,
  resolveRoleProfile,
  runExecutorPatchLoop,
  runStructuredRole,
  type WorkflowHooks,
} from "../run-workflow";
import { assertIssueEligible } from "../policy";
import { resolveRepositoryForIssue } from "../repository-resolver";
import { SandboxManager } from "../sandbox";
import type {
  JiraIssue,
  PlannerRoleOutput,
  ReviewFinding,
  RunTaskStrategy,
  RunTaskRole,
  RunTaskStatus,
  RunStatus,
} from "../types";
import { resolveExecutionProfile } from "../profiles";
import { ensureDirectory, parseCommand } from "../utils";
import type { WorkerActivity, WorkerStatus } from "../workers";
import { withRunOwnershipHeartbeat } from "./heartbeat";

type RunProcessingServices = {
  config: OrchestratorConfig;
  jira: JiraClient;
  gitlab: GitLabClient;
  git: GitManager;
  sandbox: SandboxManager;
  workflowHooks: WorkflowHooks;
};

type ResolvedRunContext = {
  run: RunRow;
  issue: JiraIssue;
  repository: RepositoryRow;
};

type ExecutorPhaseResult =
  | {
      done: true;
      run: RunRow;
    }
  | {
      done: false;
      run: RunRow;
      pendingFindings: ReviewFinding[];
      diffExcerpt: string;
    };

type ReviewerPhaseResult =
  | {
      done: true;
      run: RunRow;
    }
  | {
      done: false;
      run: RunRow;
      currentCycle: number;
      pendingFindings: ReviewFinding[];
    };

type WorkerPhaseInput = {
  status: WorkerStatus;
  activity: WorkerActivity;
  currentStep?: number | null;
  lastError?: string | null;
};

type TransitionRun = (
  runId: string,
  status: RunStatus,
  extra?: Partial<RunRow>,
  payload?: Record<string, unknown>,
) => Promise<RunRow>;

export type RunProcessDeps = {
  setWorkerPhase: (
    workerId: string,
    run: Pick<RunRow, "id" | "ticketKey">,
    input: WorkerPhaseInput,
  ) => Promise<void>;
  appendRunEvent: (runId: string, type: string, payload?: Record<string, unknown>) => Promise<void>;
  appendRunLog: (runId: string, stream: string, message: string) => Promise<void>;
  appendRunMessage: (
    runId: string,
    role: string,
    kind: string,
    content: string,
  ) => Promise<unknown>;
  appendSystemRunLog: (runId: string, message: string) => Promise<void>;
  getRunById: (runId: string) => Promise<RunRow>;
  getRepositoryById: (repositoryId: string) => Promise<RepositoryRow>;
  transitionRun: TransitionRun;
  acquireLock: (
    resourceType: string,
    resourceKey: string,
    ownerRunId: string,
    ttlSeconds: number,
  ) => Promise<void>;
  refreshLease: (runId: string, workerId: string, leaseTtlSeconds: number) => Promise<void>;
  refreshLock: (
    resourceType: string,
    resourceKey: string,
    ownerRunId: string,
    ttlSeconds: number,
  ) => Promise<unknown>;
  releaseLock: (
    resourceType: string,
    resourceKey: string,
    ownerRunId: string,
  ) => Promise<void>;
  getLatestTaskForRole: (runId: string, role: RunTaskRole) => Promise<RunTaskRow | null>;
  ensurePlannerOutput: (task: RunTaskRow | null) => PlannerRoleOutput;
  createRunTask: (input: {
    runId: string;
    role: RunTaskRole;
    cycle: number;
    modelName: string;
    profileName: string;
    strategy: RunTaskStrategy;
    artifactsPath: string;
  }) => Promise<{ id: number }>;
  completeRunTask: (
    taskId: number,
    input: {
      status: Exclude<RunTaskStatus, "running">;
      summary?: string | null;
      outputJson?: Record<string, unknown> | null;
    },
  ) => Promise<unknown>;
  recordRunCommand: WorkflowHooks["recordRunCommand"];
  buildRunArtifactsPath: (logsDir: string, runId: string) => string;
};

function createWorkflowHooks(deps: RunProcessDeps): WorkflowHooks {
  return {
    setWorkerPhase: deps.setWorkerPhase,
    appendRunEvent: deps.appendRunEvent,
    appendRunMessage: deps.appendRunMessage,
    appendSystemRunLog: deps.appendSystemRunLog,
    createTask: deps.createRunTask,
    completeTask: deps.completeRunTask,
    recordRunCommand: deps.recordRunCommand,
    ensureNotCancelled: (runId: string) => ensureNotCancelled(runId, deps),
  };
}

async function ensureNotCancelled(runId: string, deps: RunProcessDeps) {
  const run = await deps.getRunById(runId);
  if (run.cancelRequested || run.status === "cancelled") {
    throw new CancelledError("Run was cancelled");
  }
}

async function runValidationSuite(
  run: RunRow,
  sandboxId: string,
  workerId: string,
  deps: RunProcessDeps,
) {
  const config = await getConfig();
  const repository =
    run.repositoryId !== null ? await deps.getRepositoryById(run.repositoryId) : null;
  const commands = repository?.validationCommands?.length
    ? repository.validationCommands
    : config.defaults.validation_commands;
  const sandbox = new SandboxManager(config);
  const findings: ReviewFinding[] = [];

  for (const command of commands) {
    const parsedCommand = parseCommand(command);
    await ensureNotCancelled(run.id, deps);
    await deps.setWorkerPhase(workerId, run, {
      status: "busy",
      activity: "validating",
      currentStep: run.currentCycle,
    });
    await deps.appendRunEvent(run.id, "validation.command_started", {
      command: parsedCommand.normalized,
    });
    await deps.appendSystemRunLog(
      run.id,
      `starting validation command ${parsedCommand.normalized}`,
    );
    const result = await sandbox.run(
      sandboxId,
      parsedCommand.argv,
      config.worker.max_run_seconds * 1000,
    );
    await deps.recordRunCommand({
      runId: run.id,
      phase: "validation",
      result,
    });

    if (result.returncode !== 0) {
      findings.push({
        title: `Validation failed: ${parsedCommand.normalized}`,
        body: (result.stderr || result.stdout || "Validation command failed").slice(0, 2000),
      });
      await deps.appendRunEvent(run.id, "validation.command_failed", {
        command: parsedCommand.normalized,
        returncode: result.returncode,
      });
    } else {
      await deps.appendRunEvent(run.id, "validation.command_succeeded", {
        command: parsedCommand.normalized,
        returncode: result.returncode,
      });
    }
  }

  const git = new GitManager(config);
  const stats = run.worktreePath
    ? await git.diffStats(run.worktreePath)
    : { changedFiles: 0, changedLines: 0 };
  if (stats.changedFiles > config.policy.max_changed_files) {
    findings.push({
      title: "Changed files limit exceeded",
      body: `Changed files: ${stats.changedFiles}; limit: ${config.policy.max_changed_files}.`,
    });
  }
  if (stats.changedLines > config.policy.max_changed_lines) {
    findings.push({
      title: "Changed lines limit exceeded",
      body: `Changed lines: ${stats.changedLines}; limit: ${config.policy.max_changed_lines}.`,
    });
  }

  const diffExcerpt = run.worktreePath ? await git.diffExcerpt(run.worktreePath) : "";
  await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        diffExcerpt,
        latestFindings: findings,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, run.id)),
  );

  await deps.appendRunEvent(
    run.id,
    findings.length > 0 ? "validation.failed" : "validation.succeeded",
    {
      changedFiles: stats.changedFiles,
      changedLines: stats.changedLines,
      findingCount: findings.length,
    },
  );

  return {
    diffExcerpt,
    stats,
    findings,
  };
}

async function markRunNeedsHumanInput(
  input: {
    runId: string;
    role: RunTaskRole;
    question: string;
    findings?: ReviewFinding[];
  },
  deps: RunProcessDeps,
) {
  const [run] = await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        status: "needs_human_input",
        currentRole: input.role,
        pendingQuestion: input.question,
        latestFindings: input.findings ?? [],
        updatedAt: new Date(),
      })
      .where(eq(runs.id, input.runId))
      .returning(),
  );
  await deps.appendRunEvent(input.runId, "run.needs_human_input", {
    currentRole: input.role,
    question: input.question,
    findingCount: input.findings?.length ?? 0,
  });
  await deps.appendRunMessage(input.runId, "system", "human_input", input.question);
  await deps.appendSystemRunLog(input.runId, `human input required for ${input.role}`);
  return run;
}

async function ensureRunContext(
  runId: string,
  run: RunRow,
  repository: RepositoryRow,
  deps: RunProcessDeps,
) {
  const config = await getConfig();
  const plannerProfile = resolveExecutionProfile(config, "planner");
  const executorProfile = resolveExecutionProfile(config, "executor");
  const reviewerProfile = resolveExecutionProfile(config, "reviewer");
  const [updated] = await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        repositoryId: repository.id,
        repoName: repository.name,
        workflowMode: config.workflow.mode,
        plannerProfile: run.plannerProfile ?? plannerProfile.name,
        executorProfile: run.executorProfile ?? executorProfile.name,
        reviewerProfile: run.reviewerProfile ?? reviewerProfile.name,
        plannerDriver: run.plannerDriver ?? plannerProfile.driver,
        executorDriver: run.executorDriver ?? executorProfile.driver,
        reviewerDriver: run.reviewerDriver ?? reviewerProfile.driver,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId))
      .returning(),
  );
  await deps.appendRunEvent(runId, "run.context_resolved", {
    repositoryName: repository.name,
    plannerProfile: updated.plannerProfile,
    executorProfile: updated.executorProfile,
    reviewerProfile: updated.reviewerProfile,
  });
  return updated;
}

async function ensureRunWorktree(
  run: RunRow,
  repository: RepositoryRow,
  issue: JiraIssue,
  git: GitManager,
  deps: RunProcessDeps,
) {
  if (run.worktreePath && run.branchName) {
    return {
      run,
      worktreePath: run.worktreePath,
      branchName: run.branchName,
    };
  }

  const branchName = run.branchName ?? git.buildBranchName(issue);
  const worktreePath = await git.createWorktree(repository, branchName, run.ticketKey);
  await ensureDirectory(dirname(worktreePath));
  const [updated] = await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        branchName,
        worktreePath,
        worktreeRetained: false,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, run.id))
      .returning(),
  );
  await deps.appendRunEvent(run.id, "worktree.created", {
    branchName,
    worktreePath,
  });
  await deps.appendSystemRunLog(run.id, `worktree ready at ${worktreePath}`);
  return {
    run: updated,
    worktreePath,
    branchName,
  };
}

async function ensureRunSandbox(
  run: RunRow,
  sandbox: SandboxManager,
  worktreePath: string,
  deps: RunProcessDeps,
) {
  if (run.sandboxId) {
    return {
      run,
      sandboxId: run.sandboxId,
    };
  }
  const artifactsPath = run.artifactsPath ?? deps.buildRunArtifactsPath("", run.id);
  await ensureDirectory(artifactsPath);
  const sandboxId = await sandbox.create(run.id, worktreePath, {
    artifactsPath,
  });
  const [updated] = await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        sandboxId,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, run.id))
      .returning(),
  );
  await deps.appendRunEvent(run.id, "sandbox.created", {
    sandboxId,
  });
  await deps.appendSystemRunLog(run.id, `sandbox ready ${sandboxId}`);
  return {
    run: updated,
    sandboxId,
  };
}

async function publishApprovedRun(
  input: {
    run: RunRow;
    repository: RepositoryRow;
    issue: JiraIssue;
    git: GitManager;
    gitlab: GitLabClient;
    jira: JiraClient;
    workerId: string;
  },
  deps: RunProcessDeps,
) {
  if (!input.run.worktreePath || !input.run.branchName) {
    throw new ExternalServiceError("Publishable run is missing worktree or branch information");
  }

  await deps.transitionRun(input.run.id, "publishing", {
    currentRole: "reviewer",
  });
  await deps.setWorkerPhase(input.workerId, input.run, {
    status: "busy",
    activity: "publishing",
    currentStep: input.run.currentCycle,
  });
  await deps.appendRunEvent(input.run.id, "git.publish_started", {
    branchName: input.run.branchName,
    repositoryName: input.repository.name,
  });
  await deps.appendSystemRunLog(
    input.run.id,
    `publishing branch ${input.run.branchName}`,
  );
  await input.git.commitAndPush(
    input.repository,
    input.run.worktreePath,
    input.run.branchName,
    input.issue,
  );
  await deps.appendRunEvent(input.run.id, "git.publish_succeeded", {
    branchName: input.run.branchName,
  });
  const mrUrl = await input.gitlab.createMergeRequest(
    input.repository,
    input.run.branchName,
    input.issue,
    input.run.summary ?? input.run.latestReviewSummary ?? "Automated change ready for review.",
  );
  await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        mrUrl,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, input.run.id)),
  );
  await deps.appendRunEvent(input.run.id, "gitlab.merge_request_created", {
    mrUrl,
    branchName: input.run.branchName,
  });
  await input.jira.commentIssue(input.issue.key, `MR created: ${mrUrl}`).catch(() => undefined);
  await deps.appendSystemRunLog(input.run.id, `merge request created ${mrUrl}`);
  await deps.transitionRun(input.run.id, "success", {}, { mrUrl });
}

function resolveRepositoryCommandPolicies(
  repository: RepositoryRow,
  config: OrchestratorConfig,
) {
  return {
    allowedCommands:
      repository.allowedCommands.length > 0
        ? repository.allowedCommands
        : config.defaults.allowed_commands,
    validationCommands:
      repository.validationCommands.length > 0
        ? repository.validationCommands
        : config.defaults.validation_commands,
  };
}

function assertExecutionProfileSecret(
  role: RunTaskRole,
  profile: {
    name: string;
    api_key_env: string;
  },
) {
  if (!readSecretEnv(profile.api_key_env)) {
    throw new ExternalServiceError(`Missing API key for ${role} profile ${profile.name}`);
  }
}

async function resolveRunContextForProcessing(input: {
  runId: string;
  workerId: string;
  run: RunRow;
  services: RunProcessingServices;
  deps: RunProcessDeps;
}): Promise<ResolvedRunContext> {
  await input.deps.setWorkerPhase(input.workerId, input.run, {
    status: "busy",
    activity: "claiming_run",
  });
  await input.deps.appendSystemRunLog(input.runId, "validating run context");

  const issue = normalizeIssue(input.run.ticketPayload);
  const repository = input.run.repositoryId
    ? await input.deps.getRepositoryById(input.run.repositoryId)
    : await resolveRepositoryForIssue(issue);

  if (!repository) {
    throw new ExternalServiceError("No repository resolved for run");
  }

  const run = await ensureRunContext(input.runId, input.run, repository, input.deps);

  const bypassedEligibilityChecks =
    typeof run.manualOverride === "object" &&
    run.manualOverride !== null &&
    (run.manualOverride as { bypassedEligibilityChecks?: unknown })
      .bypassedEligibilityChecks === true;

  if (run.status !== "publish_approved" && !bypassedEligibilityChecks) {
    assertIssueEligible(issue, input.services.config.policy, {
      hasActiveRun: false,
      repoResolved: true,
    });
  }

  return {
    run,
    issue,
    repository,
  };
}

async function runPlannerPhase(input: {
  runId: string;
  workerId: string;
  run: RunRow;
  issue: JiraIssue;
  repository: RepositoryRow;
  worktreePath: string;
  services: RunProcessingServices;
  deps: RunProcessDeps;
}) {
  const commandPolicies = resolveRepositoryCommandPolicies(
    input.repository,
    input.services.config,
  );

  await input.deps.transitionRun(input.runId, "planning", {
    currentRole: "planner",
  });

  const trackedFiles = await input.services.git.trackedFiles(input.worktreePath);
  const plannerProfile = resolveRoleProfile(
    input.run,
    "planner",
    input.services.config,
  );
  assertExecutionProfileSecret("planner", plannerProfile);

  const plannerResult = await runStructuredRole({
    run: input.run,
    role: "planner",
    cycle: 0,
    prompt: buildPlannerPrompt({
      issue: input.issue,
      repository: input.repository,
      allowedCommands: commandPolicies.allowedCommands,
      validationCommands: commandPolicies.validationCommands,
      trackedFiles,
      requirePublishApproval: input.services.config.workflow.require_publish_approval,
      latestHumanResponse: input.run.latestHumanResponse ?? null,
    }),
    profile: plannerProfile,
    workerId: input.workerId,
    hooks: input.services.workflowHooks,
  });

  if (plannerResult.output.needsHumanInput) {
    await markRunNeedsHumanInput(
      {
        runId: input.runId,
        role: "planner",
        question:
          plannerResult.output.question ??
          plannerResult.output.openQuestions[0] ??
          "Planner requires clarification.",
      },
      input.deps,
    );
    return input.deps.getRunById(input.runId);
  }

  await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        status: "awaiting_plan_approval",
        currentRole: "planner",
        planMarkdown: plannerResult.output.planMarkdown,
        planRisks: plannerResult.output.risks,
        planOpenQuestions: plannerResult.output.openQuestions,
        pendingQuestion: null,
        latestHumanResponse: null,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, input.runId)),
  );
  await input.deps.appendRunEvent(input.runId, "run.awaiting_plan_approval", {
    riskCount: plannerResult.output.risks.length,
    openQuestionCount: plannerResult.output.openQuestions.length,
  });
  await input.deps.appendRunMessage(
    input.runId,
    "assistant",
    "plan",
    plannerResult.output.planMarkdown,
  );
  await input.deps.appendSystemRunLog(
    input.runId,
    "planner completed; waiting for human approval",
  );
  return input.deps.getRunById(input.runId);
}

async function runExecutorPhase(input: {
  runId: string;
  workerId: string;
  run: RunRow;
  issue: JiraIssue;
  repository: RepositoryRow;
  plan: PlannerRoleOutput;
  currentCycle: number;
  pendingFindings: ReviewFinding[];
  worktreePath: string;
  sandboxId: string;
  services: RunProcessingServices;
  deps: RunProcessDeps;
}): Promise<ExecutorPhaseResult> {
  const commandPolicies = resolveRepositoryCommandPolicies(
    input.repository,
    input.services.config,
  );

  await input.deps.transitionRun(input.runId, "executing", {
    currentRole: "executor",
    currentCycle: input.currentCycle,
  });

  const executorProfile = resolveRoleProfile(
    input.run,
    "executor",
    input.services.config,
  );
  assertExecutionProfileSecret("executor", executorProfile);

  const executorResult = await runExecutorPatchLoop({
    run: input.run,
    cycle: input.currentCycle,
    prompt: buildExecutorPrompt({
      issue: input.issue,
      repository: input.repository,
      plan: input.plan,
      allowedCommands: commandPolicies.allowedCommands,
      validationCommands: commandPolicies.validationCommands,
      cycle: input.currentCycle,
      findings: input.pendingFindings,
      latestHumanResponse: input.run.latestHumanResponse ?? null,
    }),
    profile: executorProfile,
    workerId: input.workerId,
    repository: input.repository,
    worktreePath: input.worktreePath,
    sandboxId: input.sandboxId,
    hooks: input.services.workflowHooks,
  });

  if (executorResult.output.needsHumanInput) {
    await markRunNeedsHumanInput(
      {
        runId: input.runId,
        role: "executor",
        question: executorResult.output.question ?? "Executor requires clarification.",
        findings: input.pendingFindings,
      },
      input.deps,
    );
    return {
      done: true,
      run: await input.deps.getRunById(input.runId),
    };
  }

  await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        summary: executorResult.output.summary,
        currentRole: "reviewer",
        currentCycle: input.currentCycle,
        latestHumanResponse: null,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, input.runId)),
  );
  await input.deps.appendRunMessage(
    input.runId,
    "assistant",
    "summary",
    executorResult.output.summary,
  );

  const validation = await runValidationSuite(
    await input.deps.getRunById(input.runId),
    input.sandboxId,
    input.workerId,
    input.deps,
  );

  return {
    done: false,
    run: await input.deps.getRunById(input.runId),
    pendingFindings: validation.findings,
    diffExcerpt: validation.diffExcerpt,
  };
}

async function runReviewerPhase(input: {
  runId: string;
  workerId: string;
  run: RunRow;
  issue: JiraIssue;
  repository: RepositoryRow;
  plan: PlannerRoleOutput;
  diffExcerpt: string;
  pendingFindings: ReviewFinding[];
  currentCycle: number;
  services: RunProcessingServices;
  deps: RunProcessDeps;
}): Promise<ReviewerPhaseResult> {
  await input.deps.transitionRun(input.runId, "reviewing", {
    currentRole: "reviewer",
    currentCycle: input.currentCycle,
  });

  const reviewerProfile = resolveRoleProfile(
    input.run,
    "reviewer",
    input.services.config,
  );
  assertExecutionProfileSecret("reviewer", reviewerProfile);

  const reviewerResult = await runStructuredRole({
    run: input.run,
    role: "reviewer",
    cycle: input.currentCycle,
    prompt: buildReviewerPrompt({
      issue: input.issue,
      repository: input.repository,
      plan: input.plan,
      diffExcerpt: input.diffExcerpt,
      validationFindings: input.pendingFindings,
      latestHumanResponse: input.run.latestHumanResponse ?? null,
      cycle: input.currentCycle,
    }),
    profile: reviewerProfile,
    workerId: input.workerId,
    hooks: input.services.workflowHooks,
  });

  let reviewerOutput = reviewerResult.output;
  const combinedFindings =
    reviewerOutput.decision === "approve" && input.pendingFindings.length > 0
      ? input.pendingFindings
      : [...input.pendingFindings, ...reviewerOutput.findings];

  if (reviewerOutput.decision === "approve" && input.pendingFindings.length > 0) {
    reviewerOutput = {
      ...reviewerOutput,
      decision: "request_changes",
      summary: `${reviewerOutput.summary}\nValidation findings remain unresolved.`,
      findings: input.pendingFindings,
    };
  }

  await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        latestReviewSummary: reviewerOutput.summary,
        latestFindings: combinedFindings,
        latestHumanResponse: null,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, input.runId)),
  );
  await input.deps.appendRunMessage(
    input.runId,
    "assistant",
    "review",
    reviewerOutput.summary,
  );

  if (reviewerOutput.decision === "needs_human_input") {
    await markRunNeedsHumanInput(
      {
        runId: input.runId,
        role: "reviewer",
        question: reviewerOutput.question ?? "Reviewer requires clarification.",
        findings: combinedFindings,
      },
      input.deps,
    );
    return {
      done: true,
      run: await input.deps.getRunById(input.runId),
    };
  }

  if (reviewerOutput.decision === "approve") {
    await withSqliteWriteRetry(() =>
      db
        .update(runs)
        .set({
          status: "awaiting_publish_approval",
          currentRole: "reviewer",
          pendingQuestion: null,
          updatedAt: new Date(),
        })
        .where(eq(runs.id, input.runId)),
    );
    await input.deps.appendRunEvent(input.runId, "run.awaiting_publish_approval", {
      cycle: input.currentCycle,
    });
    await input.deps.appendSystemRunLog(
      input.runId,
      "review approved; waiting for publish approval",
    );
    return {
      done: true,
      run: await input.deps.getRunById(input.runId),
    };
  }

  if (input.currentCycle >= input.services.config.workflow.max_review_cycles) {
    await markRunNeedsHumanInput(
      {
        runId: input.runId,
        role: "reviewer",
        question:
          "Automatic review budget exhausted. Please inspect the retained worktree and findings.",
        findings: combinedFindings,
      },
      input.deps,
    );
    return {
      done: true,
      run: await input.deps.getRunById(input.runId),
    };
  }

  const nextCycle = input.currentCycle + 1;
  await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        currentRole: "executor",
        currentCycle: nextCycle,
        latestFindings: combinedFindings,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, input.runId)),
  );

  return {
    done: false,
    run: await input.deps.getRunById(input.runId),
    currentCycle: nextCycle,
    pendingFindings: combinedFindings,
  };
}

async function handleRunProcessingFailure(input: {
  error: unknown;
  runId: string;
  workerId: string;
  run: RunRow;
  jira: JiraClient;
  deps: RunProcessDeps;
}) {
  const message =
    input.error instanceof Error ? input.error.message : "Unknown run failure";

  await input.deps.setWorkerPhase(input.workerId, input.run, {
    status: "error",
    activity: "cleaning_up",
    lastError: message,
  });

  if (input.error instanceof CancelledError) {
    await input.jira
      .commentIssue(input.run.ticketKey, `Run cancelled: ${message}`)
      .catch(() => undefined);
    await input.deps.transitionRun(
      input.runId,
      "cancelled",
      { failureReason: message },
      { reason: message },
    );
    await input.deps.appendSystemRunLog(input.runId, `run cancelled: ${message}`);
    await input.deps.appendRunMessage(input.runId, "system", "cancelled", message);
  } else {
    await input.jira
      .commentIssue(input.run.ticketKey, `Run failed: ${message}`)
      .catch(() => undefined);
    await input.deps.transitionRun(
      input.runId,
      "failed",
      { failureReason: message },
      { reason: message },
    );
    await input.deps.appendSystemRunLog(input.runId, `run failed: ${message}`);
    await input.deps.appendRunMessage(input.runId, "system", "error", message);
  }

  await input.deps.appendRunLog(input.runId, "stderr", message);
}

async function cleanupProcessedRun(input: {
  runId: string;
  workerId: string;
  now: Date;
  run: RunRow;
  repository: RepositoryRow | null;
  git: GitManager;
  sandbox: SandboxManager;
  lockHeld: boolean;
  deps: RunProcessDeps;
}) {
  const finalRun = await input.deps.getRunById(input.runId);

  await input.deps.setWorkerPhase(input.workerId, finalRun, {
    status: finalRun.status === "failed" ? "error" : "busy",
    activity: "cleaning_up",
    lastError: finalRun.failureReason,
  });

  if (finalRun.sandboxId) {
    try {
      await input.deps.appendSystemRunLog(
        input.runId,
        `destroying sandbox ${finalRun.sandboxId}`,
      );
      await input.sandbox.destroy(finalRun.sandboxId);
      await withSqliteWriteRetry(() =>
        db
          .update(runs)
          .set({
            sandboxId: null,
            updatedAt: new Date(),
          })
          .where(eq(runs.id, input.runId)),
      );
      await input.deps.appendRunEvent(input.runId, "sandbox.destroyed", {
        sandboxId: finalRun.sandboxId,
      });
    } catch (error) {
      await input.deps.appendRunEvent(input.runId, "sandbox.destroy_failed", {
        sandboxId: finalRun.sandboxId,
        reason: error instanceof Error ? error.message : "Unknown cleanup error",
      });
    }
  }

  if (input.repository && finalRun.worktreePath) {
    if (finalRun.status === "success") {
      try {
        await input.deps.appendSystemRunLog(
          input.runId,
          `cleaning worktree ${finalRun.worktreePath}`,
        );
        await input.git.cleanupWorktree(input.repository, finalRun.worktreePath);
        await withSqliteWriteRetry(() =>
          db
            .update(runs)
            .set({
              worktreePath: null,
              worktreeRetained: false,
              updatedAt: new Date(),
            })
            .where(eq(runs.id, input.runId)),
        );
        await input.deps.appendRunEvent(input.runId, "worktree.cleaned", {
          worktreePath: finalRun.worktreePath,
        });
      } catch (error) {
        await withSqliteWriteRetry(() =>
          db
            .update(runs)
            .set({
              worktreeRetained: true,
              updatedAt: new Date(),
            })
            .where(eq(runs.id, input.runId)),
        );
        await input.deps.appendRunEvent(input.runId, "worktree.cleanup_failed", {
          worktreePath: finalRun.worktreePath,
          reason: error instanceof Error ? error.message : "Unknown cleanup error",
        });
      }
    } else {
      await withSqliteWriteRetry(() =>
        db
          .update(runs)
          .set({
            worktreeRetained: true,
            updatedAt: new Date(),
          })
          .where(eq(runs.id, input.runId)),
      );
      await input.deps.appendRunEvent(input.runId, "worktree.retained", {
        worktreePath: finalRun.worktreePath,
        status: finalRun.status,
      });
      await input.deps.appendSystemRunLog(
        input.runId,
        `retaining worktree ${finalRun.worktreePath} for inspection`,
      );
    }
  }

  if (input.lockHeld) {
    try {
      await input.deps.releaseLock("ticket", input.run.ticketKey, input.run.id);
    } catch (error) {
      await input.deps.appendRunEvent(input.runId, "lock.release_failed", {
        resourceType: "ticket",
        resourceKey: input.run.ticketKey,
        reason: error instanceof Error ? error.message : "Unknown cleanup error",
      });
    }
  }

  await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: input.now,
      })
      .where(eq(runs.id, input.runId)),
  );
  await input.deps.appendRunEvent(input.runId, "run.lease_released", {
    workerId: input.workerId,
  });
  await input.deps.setWorkerPhase(input.workerId, finalRun, {
    status: "idle",
    activity: "polling",
    currentStep: null,
    lastError: null,
  });
}

export async function processRunWithDeps(
  runId: string,
  workerId: string,
  deps: RunProcessDeps,
) {
  const config = await getConfig();
  const jira = new JiraClient();
  const gitlab = new GitLabClient();
  const git = new GitManager(config);
  const sandbox = new SandboxManager(config);
  const workflowHooks = createWorkflowHooks(deps);
  const now = new Date();

  let run = await deps.getRunById(runId);
  let repository: RepositoryRow | null = null;
  let lockHeld = false;

  try {
    const context = await resolveRunContextForProcessing({
      runId,
      workerId,
      run,
      services: {
        config,
        jira,
        gitlab,
        git,
        sandbox,
        workflowHooks,
      },
      deps,
    });
    run = context.run;
    const resolvedRepository = context.repository;
    repository = resolvedRepository;
    const { issue } = context;

    await deps.acquireLock("ticket", run.ticketKey, run.id, config.worker.lease_ttl_seconds);
    lockHeld = true;
    await deps.refreshLease(runId, workerId, config.worker.lease_ttl_seconds);
    return await withRunOwnershipHeartbeat(
      {
        runId,
        ticketKey: run.ticketKey,
        workerId,
        leaseTtlSeconds: config.worker.lease_ttl_seconds,
      },
      {
        refreshLease: deps.refreshLease,
        refreshLock: deps.refreshLock,
      },
      async () => {
        const worktree = await ensureRunWorktree(
          run,
          resolvedRepository,
          issue,
          git,
          deps,
        );
        run = worktree.run;

        if (run.status === "publish_approved") {
          await publishApprovedRun(
            {
              run,
              repository: resolvedRepository,
              issue,
              git,
              gitlab,
              jira,
              workerId,
            },
            deps,
          );
          return deps.getRunById(runId);
        }

        const sandboxReady = await ensureRunSandbox(
          run,
          sandbox,
          worktree.worktreePath,
          deps,
        );
        run = sandboxReady.run;

        let currentRole = (run.currentRole ?? "planner") as RunTaskRole;
        let currentCycle = Math.max(run.currentCycle ?? 0, currentRole === "planner" ? 0 : 1);

        if (currentRole === "planner") {
          return runPlannerPhase({
            runId,
            workerId,
            run,
            issue,
            repository: resolvedRepository,
            worktreePath: worktree.worktreePath,
            services: {
              config,
              jira,
              gitlab,
              git,
              sandbox,
              workflowHooks,
            },
            deps,
          });
        }

        const plan = {
          planMarkdown:
            run.planMarkdown ??
            deps.ensurePlannerOutput(await deps.getLatestTaskForRole(runId, "planner"))
              .planMarkdown,
          risks: run.planRisks,
          openQuestions: run.planOpenQuestions,
          needsHumanInput: false,
        };
        let pendingFindings = Array.isArray(run.latestFindings) ? run.latestFindings : [];
        let diffExcerpt = run.diffExcerpt ?? "";

        while (true) {
          await deps.refreshLease(runId, workerId, config.worker.lease_ttl_seconds);

          if (currentRole === "executor") {
            const executorPhase = await runExecutorPhase({
              runId,
              workerId,
              run,
              issue,
              repository: resolvedRepository,
              plan,
              currentCycle,
              pendingFindings,
              worktreePath: worktree.worktreePath,
              sandboxId: sandboxReady.sandboxId,
              services: {
                config,
                jira,
                gitlab,
                git,
                sandbox,
                workflowHooks,
              },
              deps,
            });

            if (executorPhase.done) {
              return executorPhase.run;
            }

            pendingFindings = executorPhase.pendingFindings;
            diffExcerpt = executorPhase.diffExcerpt;
            run = executorPhase.run;
            currentRole = "reviewer";
            continue;
          }

          const reviewerPhase = await runReviewerPhase({
            runId,
            workerId,
            run,
            issue,
            repository: resolvedRepository,
            plan,
            diffExcerpt,
            pendingFindings,
            currentCycle,
            services: {
              config,
              jira,
              gitlab,
              git,
              sandbox,
              workflowHooks,
            },
            deps,
          });

          if (reviewerPhase.done) {
            return reviewerPhase.run;
          }

          currentCycle = reviewerPhase.currentCycle;
          pendingFindings = reviewerPhase.pendingFindings;
          run = reviewerPhase.run;
          currentRole = "executor";
        }
      },
    );
  } catch (error) {
    await handleRunProcessingFailure({
      error,
      runId,
      workerId,
      run,
      jira,
      deps,
    });
  } finally {
    await cleanupProcessedRun({
      runId,
      workerId,
      now,
      run,
      repository,
      git,
      sandbox,
      lockHeld,
      deps,
    });
  }

  return deps.getRunById(runId);
}
