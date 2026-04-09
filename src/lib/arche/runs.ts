import { readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";

import { getConfig } from "../config";
import { db, withSqliteWriteRetry } from "../db/client";
import { readSecretEnv } from "../env";
import {
  locks,
  repoRules,
  repositories,
  runCommands,
  runEvents,
  runLogs,
  runMessages,
  runTasks,
  runs,
  type RepoRuleRow,
  type RunCommandRow,
  type RunEventRow,
  type RunMessageRow,
  type RunTaskRow,
  type RepositoryRow,
  type RunLogRow,
  type RunRow,
} from "../db/schema";
import { GitManager } from "./git";
import { JiraClient, normalizeIssue } from "./jira";
import {
  assertIssueEligible,
  evaluateIssueEligibility,
  ACTIVE_RUN_STATES,
  TERMINAL_RUN_STATES,
} from "./policy";
import { resolveRepositoryForIssue } from "./repository-resolver";
import { processRunWithDeps } from "./runs/process-run";
import type {
  JiraIssue,
  RunCommand,
  RunTaskStrategy,
  RunTaskRole,
  RunTaskStatus,
  RunStatus,
} from "./types";
import { plannerRoleOutputSchema } from "./role-schemas";
import { redactObject, redactText, truncateText } from "./logging";
import {
  listMissingExecutionProfileSecrets,
  resolveExecutionProfile,
} from "./profiles";
import {
  ensureDirectory,
  makeId,
  serializeDate,
} from "./utils";
import { ExternalServiceError, NotFoundError } from "./errors";
import {
  type WorkerActivity,
  type WorkerStatus,
  updateWorkerState,
} from "./workers";

export type RunListItem = ReturnType<typeof presentRun>;
const DEFAULT_PAGE_LIMIT = 100;
const COMMAND_EXCERPT_LIMIT = 4000;
const RUN_LOG_MESSAGE_LIMIT = 1200;
const RUN_MESSAGE_LIMIT = 1200;
const COMMAND_STDOUT_LOG_LIMIT = 500;
const COMMAND_STDERR_LOG_LIMIT = 800;
const COMMAND_HISTORY_LIMIT = 50;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const RETENTION_DAY_MS = 24 * 60 * 60 * 1000;

let lastPruneAt = 0;

const QUEUEABLE_RUN_STATES: RunStatus[] = ["pending", "publish_approved"];

export function presentRun(run: RunRow) {
  return {
    ...run,
    createdAt: serializeDate(run.createdAt),
    updatedAt: serializeDate(run.updatedAt),
    startedAt: serializeDate(run.startedAt),
    finishedAt: serializeDate(run.finishedAt),
    leaseExpiresAt: serializeDate(run.leaseExpiresAt),
  };
}

export function presentRunEvent(event: RunEventRow) {
  return {
    ...event,
    timestamp: serializeDate(event.timestamp),
  };
}

export function presentRunLog(log: RunLogRow) {
  return {
    ...log,
    timestamp: serializeDate(log.timestamp),
  };
}

export function presentRunCommand(command: RunCommandRow) {
  return {
    ...command,
    timestamp: serializeDate(command.timestamp),
  };
}

export function presentRunMessage(message: RunMessageRow) {
  return {
    ...message,
    timestamp: serializeDate(message.timestamp),
  };
}

export function presentRunTask(task: RunTaskRow) {
  return {
    ...task,
    startedAt: serializeDate(task.startedAt),
    finishedAt: serializeDate(task.finishedAt),
  };
}

export function presentRepoRule(
  rule: RepoRuleRow,
  extras: {
    repositoryName?: string | null;
  } = {},
) {
  return {
    ...rule,
    ...extras,
    createdAt: serializeDate(rule.createdAt),
    updatedAt: serializeDate(rule.updatedAt),
  };
}

function sanitizePayload(payload: Record<string, unknown>) {
  return JSON.parse(
    JSON.stringify(redactObject(payload), (_key, value) => value ?? null),
  ) as Record<string, unknown>;
}

function buildExcerpt(value: string, maxLength: number) {
  const redacted = redactText(value);
  if (!redacted.trim()) {
    return null;
  }
  return truncateText(redacted, maxLength);
}

async function setWorkerPhase(
  workerId: string,
  run: Pick<RunRow, "id" | "ticketKey">,
  input: {
    status: WorkerStatus;
    activity: WorkerActivity;
    currentStep?: number | null;
    lastError?: string | null;
  },
) {
  await updateWorkerState(workerId, {
    status: input.status,
    activity: input.activity,
    currentRunId: input.status === "idle" ? null : run.id,
    currentTicketKey: input.status === "idle" ? null : run.ticketKey,
    currentStep: input.currentStep ?? null,
    lastError: input.lastError ?? null,
  });
}

async function writeRunCommandArtifacts(runId: string, stdout: string, stderr: string) {
  const config = await getConfig();
  const existing = await db
    .select({ id: runCommands.id })
    .from(runCommands)
    .where(eq(runCommands.runId, runId))
    .orderBy(desc(runCommands.id))
    .limit(1);
  const sequence = (existing[0]?.id ?? 0) + 1;
  const commandDir = join(config.runtime.logs_dir, "runs", runId, "commands");
  await ensureDirectory(commandDir);

  let stdoutArtifactPath: string | null = null;
  let stderrArtifactPath: string | null = null;

  if (stdout.trim()) {
    stdoutArtifactPath = join(commandDir, `${sequence}-stdout.log`);
    await writeFile(stdoutArtifactPath, redactText(stdout), "utf8");
  }
  if (stderr.trim()) {
    stderrArtifactPath = join(commandDir, `${sequence}-stderr.log`);
    await writeFile(stderrArtifactPath, redactText(stderr), "utf8");
  }

  return { stdoutArtifactPath, stderrArtifactPath };
}

export async function listRuns() {
  const rows = await db.select().from(runs).orderBy(desc(runs.createdAt));
  return rows.map(presentRun);
}

export async function listExecutionProfiles() {
  const config = await getConfig();
  const snapshot = {
    defaults: {
      ...config.executors.defaults,
    },
    profiles: Object.fromEntries(
      Object.entries(config.executors.profiles).map(([name, profile]) => [
        name,
        {
          driver: profile.driver,
          baseUrl: profile.base_url,
          model: profile.model,
          apiKeyEnv: profile.api_key_env,
          apiKeyConfigured: Boolean(readSecretEnv(profile.api_key_env)),
          timeoutSeconds: profile.timeout_seconds,
          maxActions: profile.max_actions,
          temperature: profile.temperature,
        },
      ]),
    ),
  };
  return snapshot;
}

export async function getRunDetail(runId: string) {
  const run = await getRunById(runId);
  const [logs, tasks] = await Promise.all([
    db
      .select()
      .from(runLogs)
      .where(eq(runLogs.runId, runId))
      .orderBy(asc(runLogs.timestamp), asc(runLogs.id)),
    listRunTasks(runId),
  ]);
  return {
    run: presentRun(run),
    logs: logs.map(presentRunLog),
    tasks,
  };
}

export async function getRunById(runId: string) {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) {
    throw new NotFoundError(`Run ${runId} not found`);
  }
  return run;
}

export async function listRunLogs(runId: string) {
  return (await listRunLogsPage(runId)).items;
}

export async function listRunLogsPage(
  runId: string,
  options: {
    afterId?: number;
    limit?: number;
  } = {},
) {
  await getRunById(runId);
  const logs = await db
    .select()
    .from(runLogs)
    .where(
      and(
        eq(runLogs.runId, runId),
        options.afterId ? gt(runLogs.id, options.afterId) : undefined,
      ),
    )
    .orderBy(asc(runLogs.timestamp), asc(runLogs.id))
    .limit(options.limit ?? DEFAULT_PAGE_LIMIT);
  return {
    items: logs.map(presentRunLog),
    nextAfterId: logs.length > 0 ? logs.at(-1)!.id : null,
  };
}

export async function listRunEvents(
  runId: string,
  options: {
    afterId?: number;
    limit?: number;
  } = {},
) {
  await getRunById(runId);
  const events = await db
    .select()
    .from(runEvents)
    .where(
      and(
        eq(runEvents.runId, runId),
        options.afterId ? gt(runEvents.id, options.afterId) : undefined,
      ),
    )
    .orderBy(asc(runEvents.timestamp), asc(runEvents.id))
    .limit(options.limit ?? DEFAULT_PAGE_LIMIT);
  return {
    items: events.map(presentRunEvent),
    nextAfterId: events.length > 0 ? events.at(-1)!.id : null,
  };
}

export async function listRunCommands(
  runId: string,
  options: {
    afterId?: number;
    limit?: number;
  } = {},
) {
  await getRunById(runId);
  const commands = await db
    .select()
    .from(runCommands)
    .where(
      and(
        eq(runCommands.runId, runId),
        options.afterId ? gt(runCommands.id, options.afterId) : undefined,
      ),
    )
    .orderBy(asc(runCommands.timestamp), asc(runCommands.id))
    .limit(options.limit ?? DEFAULT_PAGE_LIMIT);
  return {
    items: commands.map(presentRunCommand),
    nextAfterId: commands.length > 0 ? commands.at(-1)!.id : null,
  };
}

export async function listRunMessages(
  runId: string,
  options: {
    afterId?: number;
    limit?: number;
  } = {},
) {
  await getRunById(runId);
  const messages = await db
    .select()
    .from(runMessages)
    .where(
      and(
        eq(runMessages.runId, runId),
        options.afterId ? gt(runMessages.id, options.afterId) : undefined,
      ),
    )
    .orderBy(asc(runMessages.sequence), asc(runMessages.id))
    .limit(options.limit ?? DEFAULT_PAGE_LIMIT);
  return {
    items: messages.map(presentRunMessage),
    nextAfterId: messages.length > 0 ? messages.at(-1)!.id : null,
  };
}

export async function listRunTasks(runId: string) {
  await getRunById(runId);
  const tasks = await db
    .select()
    .from(runTasks)
    .where(eq(runTasks.runId, runId))
    .orderBy(asc(runTasks.startedAt), asc(runTasks.id));
  return tasks.map(presentRunTask);
}

export async function listRepositories() {
  return db.select().from(repositories).orderBy(asc(repositories.createdAt));
}

export async function createRepository(data: Omit<RepositoryRow, "id" | "createdAt" | "updatedAt">) {
  const record = {
    id: makeId(),
    ...data,
  };
  const [repository] = await withSqliteWriteRetry(() =>
    db.insert(repositories).values(record).returning(),
  );
  return repository;
}

export async function listRepoRules() {
  const rows = await db
    .select({
      rule: repoRules,
      repositoryName: repositories.name,
    })
    .from(repoRules)
    .innerJoin(repositories, eq(repoRules.repositoryId, repositories.id))
    .orderBy(asc(repoRules.priority), asc(repoRules.createdAt));

  return rows.map(({ rule, repositoryName }) => presentRepoRule(rule, { repositoryName }));
}

export async function createRepoRule(data: {
  name: string;
  repositoryId?: string;
  repositoryName?: string;
  jiraProjectKey?: string | null;
  label?: string | null;
  issueType?: string | null;
  priority: number;
  enabled: boolean;
}) {
  const repositoryIdentifier = data.repositoryId ?? data.repositoryName;
  if (!repositoryIdentifier) {
    throw new ExternalServiceError("repositoryId or repositoryName is required");
  }

  const repository = await getRepositoryByNameOrId(repositoryIdentifier);
  const [rule] = await withSqliteWriteRetry(() => db
    .insert(repoRules)
    .values({
      id: makeId(),
      name: data.name,
      repositoryId: repository.id,
      jiraProjectKey: data.jiraProjectKey ?? null,
      label: data.label ?? null,
      issueType: data.issueType ?? null,
      priority: data.priority,
      enabled: data.enabled,
    })
    .returning());

  return presentRepoRule(rule, { repositoryName: repository.name });
}

export async function createManualRunForTicket(input: {
  ticketKey: string;
  force?: boolean;
}) {
  const jira = new JiraClient();
  if (!jira.configured) {
    throw new ExternalServiceError("Jira client is not configured");
  }

  const issue = await jira.fetchIssue(input.ticketKey);
  const config = await getConfig();
  const force = Boolean(input.force);
  const hasActiveRun = await activeRunExists(issue.key);
  let repository: RepositoryRow | null = null;
  let repoResolved = true;

  try {
    repository = await resolveRepositoryForIssue(issue);
  } catch {
    repoResolved = false;
  }

  if (!force) {
    assertIssueEligible(issue, config.policy, {
      hasActiveRun,
      repoResolved,
    });
  } else if (!repoResolved || !repository) {
    throw new ExternalServiceError(
      "Cannot force a manual run without a matching repository rule",
      "manual_run_repo_required",
    );
  }

  const missingSecrets = listMissingExecutionProfileSecrets(config);
  if (missingSecrets.length > 0) {
    throw new ExternalServiceError(
      `Missing execution profile secrets: ${missingSecrets.map((item) => `${item.role}:${item.apiKeyEnv}`).join(", ")}`,
    );
  }

  return createRun({
    issue,
    source: "manual",
    repository,
    manualOverride: force
      ? {
          force: true,
          bypassedEligibilityChecks: true,
          hadActiveRun: hasActiveRun,
        }
      : {},
  });
}

export async function handleJiraWebhook(input: {
  payload: Record<string, unknown>;
  secret: string | null;
}) {
  const jira = new JiraClient();
  if (!jira.validateWebhookSecret(input.secret)) {
    return { accepted: false, reason: "Invalid webhook secret" };
  }

  const issueKey =
    typeof input.payload.issue_key === "string"
      ? input.payload.issue_key
      : typeof (input.payload.issue as { key?: unknown } | undefined)?.key === "string"
        ? ((input.payload.issue as { key: string }).key)
        : null;

  if (!issueKey && !input.payload.issue) {
    return { accepted: false, reason: "Missing issue key in payload" };
  }

  const issue =
    issueKey && jira.configured
      ? await jira.fetchIssue(issueKey)
      : normalizeIssue(input.payload.issue);

  let repository: RepositoryRow | null = null;
  let repoResolved = true;
  try {
    repository = await resolveRepositoryForIssue(issue);
  } catch {
    repoResolved = false;
  }

  const config = await getConfig();
  const decision = evaluateIssueEligibility(issue, config.policy, {
    hasActiveRun: await activeRunExists(issue.key),
    repoResolved,
  });
  if (!decision.eligible) {
    return { accepted: false, reason: decision.reasons.join("; ") };
  }

  const missingSecrets = listMissingExecutionProfileSecrets(config);
  if (missingSecrets.length > 0) {
    return {
      accepted: false,
      reason: `Missing execution profile secrets: ${missingSecrets.map((item) => `${item.role}:${item.apiKeyEnv}`).join(", ")}`,
    };
  }

  const run = await createRun({
    issue,
    source: "jira",
    repository,
  });

  return { accepted: true, runId: run.id };
}

export async function activeRunExists(ticketKey: string) {
  const [run] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.ticketKey, ticketKey), inArray(runs.status, ACTIVE_RUN_STATES)))
    .limit(1);
  return Boolean(run);
}

export async function appendRunEvent(runId: string, type: string, payload: Record<string, unknown> = {}) {
  await withSqliteWriteRetry(() => db.insert(runEvents).values({
    runId,
    type,
    payload: sanitizePayload(payload),
  }));
}

export async function appendRunLog(runId: string, stream: string, message: string) {
  await withSqliteWriteRetry(() => db.insert(runLogs).values({
    runId,
    stream,
    message: truncateText(redactText(message), RUN_LOG_MESSAGE_LIMIT),
  }));
}

export async function appendRunMessage(
  runId: string,
  role: string,
  kind: string,
  content: string,
) {
  const redacted = truncateText(redactText(content), RUN_MESSAGE_LIMIT).trim();
  if (!redacted) {
    return null;
  }

  const [lastMessage] = await db
    .select({ sequence: runMessages.sequence })
    .from(runMessages)
    .where(eq(runMessages.runId, runId))
    .orderBy(desc(runMessages.sequence), desc(runMessages.id))
    .limit(1);

  const [message] = await withSqliteWriteRetry(() =>
    db
      .insert(runMessages)
      .values({
        runId,
        sequence: Number(lastMessage?.sequence ?? 0) + 1,
        role,
        kind,
        contentExcerpt: redacted,
      })
      .returning(),
  );

  return presentRunMessage(message);
}

export async function appendSystemRunLog(runId: string, message: string) {
  await appendRunLog(runId, "system", message);
}

export async function transitionRun(
  runId: string,
  status: RunStatus,
  extra: Partial<RunRow> = {},
  payload: Record<string, unknown> = {},
) {
  const now = new Date();
  const base: Partial<RunRow> = {
    status,
    updatedAt: now,
    ...extra,
  };
  if (status === "validating") {
    base.startedAt = extra.startedAt ?? now;
  }
  if (TERMINAL_RUN_STATES.includes(status)) {
    base.finishedAt = extra.finishedAt ?? now;
    base.leaseOwner = null;
    base.leaseExpiresAt = null;
  }
  const [run] = await withSqliteWriteRetry(() =>
    db.update(runs).set(base).where(eq(runs.id, runId)).returning(),
  );
  await appendRunEvent(runId, `run.${status}`, payload);
  return run;
}

export async function appendRunCommand(runId: string, entry: RunCommand) {
  const run = await getRunById(runId);
  const history = Array.isArray(run.commandHistory) ? run.commandHistory : [];
  const nextHistory = [
    ...history,
    {
      timestamp: entry.timestamp,
      command: redactText(entry.command),
      returncode: entry.returncode,
    },
  ].slice(-COMMAND_HISTORY_LIMIT);
  await withSqliteWriteRetry(() => db
    .update(runs)
    .set({
      commandHistory: nextHistory,
      updatedAt: new Date(),
    })
    .where(eq(runs.id, runId)));
}

async function recordRunCommand(input: {
  runId: string;
  phase: string;
  result: {
    command: string;
    returncode: number;
    stdout: string;
    stderr: string;
    durationMs?: number;
  };
}) {
  const stdoutExcerpt = buildExcerpt(input.result.stdout, COMMAND_EXCERPT_LIMIT);
  const stderrExcerpt = buildExcerpt(input.result.stderr, COMMAND_EXCERPT_LIMIT);
  const artifactPaths = await writeRunCommandArtifacts(
    input.runId,
    input.result.stdout,
    input.result.stderr,
  );

  const [record] = await withSqliteWriteRetry(() => db
    .insert(runCommands)
    .values({
      runId: input.runId,
      phase: input.phase,
      command: redactText(input.result.command),
      returncode: input.result.returncode,
      durationMs: input.result.durationMs ?? null,
      stdoutExcerpt,
      stderrExcerpt,
      stdoutArtifactPath: artifactPaths.stdoutArtifactPath,
      stderrArtifactPath: artifactPaths.stderrArtifactPath,
    })
    .returning());

  await appendRunCommand(input.runId, {
    timestamp: new Date().toISOString(),
    command: input.result.command,
    returncode: input.result.returncode,
  });

  if (input.result.returncode !== 0) {
    await appendSystemRunLog(
      input.runId,
      `command failed during ${input.phase}: ${redactText(input.result.command)}`,
    );
  }
  if (stderrExcerpt) {
    await appendRunLog(
      input.runId,
      "stderr",
      truncateText(stderrExcerpt, COMMAND_STDERR_LOG_LIMIT),
    );
  } else if (input.result.returncode !== 0 && stdoutExcerpt) {
    await appendRunLog(
      input.runId,
      "stdout",
      truncateText(stdoutExcerpt, COMMAND_STDOUT_LOG_LIMIT),
    );
  }

  return presentRunCommand(record);
}

async function createRunTask(input: {
  runId: string;
  role: RunTaskRole;
  cycle: number;
  modelName: string;
  profileName: string;
  strategy: RunTaskStrategy;
  artifactsPath: string;
}) {
  const [task] = await withSqliteWriteRetry(() =>
    db
      .insert(runTasks)
      .values({
        runId: input.runId,
        role: input.role,
        cycle: input.cycle,
        status: "running",
        modelName: input.modelName,
        profileName: input.profileName,
        strategy: input.strategy,
        artifactsPath: input.artifactsPath,
      })
      .returning(),
  );
  return task;
}

async function completeRunTask(
  taskId: number,
  input: {
    status: Exclude<RunTaskStatus, "running">;
    summary?: string | null;
    outputJson?: Record<string, unknown> | null;
  },
) {
  const [task] = await withSqliteWriteRetry(() =>
    db
      .update(runTasks)
      .set({
        status: input.status,
        summary: input.summary ?? null,
        outputJson: input.outputJson ?? null,
        finishedAt: new Date(),
      })
      .where(eq(runTasks.id, taskId))
      .returning(),
  );
  return task;
}

async function getLatestTaskForRole(runId: string, role: RunTaskRole) {
  const [task] = await db
    .select()
    .from(runTasks)
    .where(and(eq(runTasks.runId, runId), eq(runTasks.role, role)))
    .orderBy(desc(runTasks.startedAt), desc(runTasks.id))
    .limit(1);
  return task ?? null;
}

function ensurePlannerOutput(task: RunTaskRow | null) {
  if (!task?.outputJson) {
    throw new ExternalServiceError("Approved plan is missing");
  }
  return plannerRoleOutputSchema.parse(task.outputJson);
}

export async function createRun(input: {
  issue: JiraIssue;
  source: string;
  repository: RepositoryRow | null;
  manualOverride?: Record<string, unknown>;
}) {
  const config = await getConfig();
  const runId = makeId();
  const plannerProfile = resolveExecutionProfile(config, "planner");
  const executorProfile = resolveExecutionProfile(config, "executor");
  const reviewerProfile = resolveExecutionProfile(config, "reviewer");
  const [run] = await withSqliteWriteRetry(() => db
    .insert(runs)
    .values({
      id: runId,
      source: input.source,
      status: "pending",
      ticketKey: input.issue.key,
      ticketTitle: input.issue.title,
      ticketProjectKey: input.issue.projectKey,
      ticketPayload: input.issue.raw,
      repoName: input.repository?.name ?? null,
      repositoryId: input.repository?.id ?? null,
      workflowMode: config.workflow.mode,
      plannerProfile: plannerProfile.name,
      executorProfile: executorProfile.name,
      reviewerProfile: reviewerProfile.name,
      plannerDriver: plannerProfile.driver,
      executorDriver: executorProfile.driver,
      reviewerDriver: reviewerProfile.driver,
      modelName: executorProfile.model,
      currentRole: "planner",
      currentCycle: 0,
      planRisks: [],
      planOpenQuestions: [],
      latestFindings: [],
      artifactsPath: buildRunArtifactsPath(config.runtime.logs_dir, runId),
      commandHistory: [],
      worktreeRetained: false,
      manualOverride: input.manualOverride ?? {},
    })
    .returning());
  await appendRunEvent(run.id, "run.created", {
    source: input.source,
    ticketKey: input.issue.key,
    repositoryName: input.repository?.name ?? null,
    plannerProfile: plannerProfile.name,
    executorProfile: executorProfile.name,
    reviewerProfile: reviewerProfile.name,
  });
  await appendSystemRunLog(run.id, `run created from ${input.source} for ${input.issue.key}`);
  return run;
}

export async function retryRun(runId: string) {
  const original = await getRunById(runId);
  const retriedRun = await createRun({
    issue: normalizeIssue(original.ticketPayload),
    source: `${original.source}:retry`,
    repository: original.repositoryId ? await getRepositoryById(original.repositoryId) : null,
    manualOverride: original.manualOverride,
  });
  await appendRunEvent(retriedRun.id, "run.retry_requested", {
    originalRunId: runId,
  });
  return retriedRun;
}

export async function cancelRun(runId: string) {
  const run = await getRunById(runId);
  if (
    run.status === "pending" ||
    run.status === "awaiting_plan_approval" ||
    run.status === "awaiting_publish_approval" ||
    run.status === "needs_human_input" ||
    run.status === "publish_approved"
  ) {
    await appendSystemRunLog(run.id, "run cancelled before execution");
    return transitionRun(run.id, "cancelled");
  }
  const [updated] = await withSqliteWriteRetry(() => db
    .update(runs)
    .set({
      cancelRequested: true,
      updatedAt: new Date(),
    })
    .where(eq(runs.id, runId))
    .returning());
  await appendRunEvent(runId, "run.cancel_requested");
  await appendSystemRunLog(runId, "cancellation requested");
  return updated;
}

export async function approvePlan(runId: string) {
  const run = await getRunById(runId);
  if (run.status !== "awaiting_plan_approval") {
    throw new ExternalServiceError(`Run ${runId} is not awaiting plan approval`);
  }
  const latestPlannerTask = await getLatestTaskForRole(runId, "planner");
  const plannerOutput = ensurePlannerOutput(latestPlannerTask);
  const [updated] = await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        status: "pending",
        currentRole: "executor",
        currentCycle: 1,
        planMarkdown: plannerOutput.planMarkdown,
        planRisks: plannerOutput.risks,
        planOpenQuestions: plannerOutput.openQuestions,
        pendingQuestion: null,
        latestHumanResponse: null,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId))
      .returning(),
  );
  await appendRunEvent(runId, "run.plan_approved");
  await appendSystemRunLog(runId, "plan approved; queued for execution");
  return updated;
}

export async function respondToRun(runId: string, message: string) {
  const run = await getRunById(runId);
  if (run.status !== "needs_human_input") {
    throw new ExternalServiceError(`Run ${runId} is not waiting for human input`);
  }
  const [updated] = await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        status: "pending",
        pendingQuestion: null,
        latestHumanResponse: message,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId))
      .returning(),
  );
  await appendRunEvent(runId, "run.human_response_received", {
    currentRole: run.currentRole,
  });
  await appendRunMessage(runId, "user", "human_response", message);
  await appendSystemRunLog(runId, `human response received for ${run.currentRole ?? "workflow"}`);
  return updated;
}

export async function approvePublish(runId: string) {
  const run = await getRunById(runId);
  if (run.status !== "awaiting_publish_approval") {
    throw new ExternalServiceError(`Run ${runId} is not awaiting publish approval`);
  }
  const [updated] = await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        status: "publish_approved",
        currentRole: "reviewer",
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId))
      .returning(),
  );
  await appendRunEvent(runId, "run.publish_approved");
  await appendSystemRunLog(runId, "publish approved; queued for publication");
  return updated;
}

export async function rejectPublish(runId: string) {
  const run = await getRunById(runId);
  if (run.status !== "awaiting_publish_approval") {
    throw new ExternalServiceError(`Run ${runId} is not awaiting publish approval`);
  }
  const [updated] = await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        status: "publish_rejected",
        worktreeRetained: true,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId))
      .returning(),
  );
  await appendRunEvent(runId, "run.publish_rejected");
  await appendSystemRunLog(runId, "publish rejected; retaining worktree for inspection");
  return updated;
}

export async function getRepositoryById(repositoryId: string) {
  const [repository] = await db.select().from(repositories).where(eq(repositories.id, repositoryId)).limit(1);
  if (!repository) throw new NotFoundError(`Repository ${repositoryId} not found`);
  return repository;
}

export async function getRepositoryByNameOrId(identifier: string) {
  const [repository] = await db
    .select()
    .from(repositories)
    .where(or(eq(repositories.id, identifier), eq(repositories.name, identifier)))
    .limit(1);
  if (!repository) {
    throw new NotFoundError(`Repository ${identifier} not found`);
  }
  return repository;
}

export async function claimNextRun(workerId: string, leaseTtlSeconds: number) {
  const staleCutoff = new Date();
  staleCutoff.setSeconds(staleCutoff.getSeconds() - 1);

  const [target] = await db
    .select()
    .from(runs)
    .where(
      and(
        inArray(runs.status, QUEUEABLE_RUN_STATES),
        or(isNull(runs.leaseExpiresAt), lt(runs.leaseExpiresAt, staleCutoff)),
      ),
    )
    .orderBy(asc(runs.createdAt))
    .limit(1);

  if (!target) return null;
  const leaseExpiresAt = new Date(Date.now() + leaseTtlSeconds * 1000);
  const [claimed] = await withSqliteWriteRetry(() => db
    .update(runs)
    .set({
      workerId,
      leaseOwner: workerId,
      leaseExpiresAt,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(runs.id, target.id),
        inArray(runs.status, QUEUEABLE_RUN_STATES),
        or(isNull(runs.leaseExpiresAt), lt(runs.leaseExpiresAt, staleCutoff)),
      ),
    )
    .returning());
  if (claimed) {
    await appendRunEvent(claimed.id, "run.claimed", {
      workerId,
      leaseExpiresAt: serializeDate(leaseExpiresAt),
    });
    await appendSystemRunLog(claimed.id, `run claimed by ${workerId}`);
  }
  return claimed ?? null;
}

export async function refreshLease(runId: string, workerId: string, leaseTtlSeconds: number) {
  await withSqliteWriteRetry(() => db
    .update(runs)
    .set({
      leaseOwner: workerId,
      leaseExpiresAt: new Date(Date.now() + leaseTtlSeconds * 1000),
      updatedAt: new Date(),
    })
    .where(eq(runs.id, runId)));
}

export async function refreshLock(
  resourceType: string,
  resourceKey: string,
  ownerRunId: string,
  ttlSeconds: number,
) {
  const [updated] = await withSqliteWriteRetry(() =>
    db
      .update(locks)
      .set({
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      })
      .where(
        and(
          eq(locks.resourceType, resourceType),
          eq(locks.resourceKey, resourceKey),
          eq(locks.ownerRunId, ownerRunId),
        ),
      )
      .returning(),
  );

  if (!updated) {
    throw new ExternalServiceError(
      `Lock no longer held for ${resourceType}:${resourceKey}`,
      "lock_lost",
    );
  }

  return updated;
}

export async function sweepExpiredRuns() {
  const now = new Date();
  const expired = await db
    .select()
    .from(runs)
    .where(
      and(
        inArray(runs.status, ACTIVE_RUN_STATES),
        isNotNull(runs.leaseExpiresAt),
        lt(runs.leaseExpiresAt, now),
      ),
    );

  for (const run of expired) {
    await withSqliteWriteRetry(() => db
      .update(runs)
      .set({
        status: "failed",
        failureReason: "Worker lease expired",
        finishedAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where(eq(runs.id, run.id)));
    await appendRunEvent(run.id, "run.failed", { reason: "Worker lease expired" });
    await appendRunLog(run.id, "stderr", "worker lease expired");
  }

  return expired.length;
}

export async function acquireLock(resourceType: string, resourceKey: string, ownerRunId: string, ttlSeconds: number) {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(locks)
    .where(and(eq(locks.resourceType, resourceType), eq(locks.resourceKey, resourceKey)))
    .limit(1);

  if (existing && existing.expiresAt > now) {
    throw new ExternalServiceError(`Lock already held for ${resourceType}:${resourceKey}`);
  }
  if (existing) {
    await withSqliteWriteRetry(() => db.delete(locks).where(eq(locks.id, existing.id)));
  }
  try {
    await withSqliteWriteRetry(() => db.insert(locks).values({
      resourceType,
      resourceKey,
      ownerRunId,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    }));
    await appendRunEvent(ownerRunId, "lock.acquired", {
      resourceType,
      resourceKey,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      throw new ExternalServiceError(`Lock already held for ${resourceType}:${resourceKey}`);
    }
    throw error;
  }
}

export async function releaseLock(resourceType: string, resourceKey: string, ownerRunId: string) {
  await withSqliteWriteRetry(() => db
    .delete(locks)
    .where(
      and(
        eq(locks.resourceType, resourceType),
        eq(locks.resourceKey, resourceKey),
        eq(locks.ownerRunId, ownerRunId),
      ),
    ));
  await appendRunEvent(ownerRunId, "lock.released", {
    resourceType,
    resourceKey,
  });
}

export async function processRun(runId: string, workerId: string) {
  return processRunWithDeps(runId, workerId, {
    setWorkerPhase,
    appendRunEvent,
    appendRunLog,
    appendRunMessage,
    appendSystemRunLog,
    getRunById,
    getRepositoryById,
    transitionRun,
    acquireLock,
    refreshLease,
    refreshLock,
    releaseLock,
    getLatestTaskForRole,
    ensurePlannerOutput,
    createRunTask,
    completeRunTask,
    recordRunCommand,
    buildRunArtifactsPath,
  });
}

async function pruneArtifactsDirectory(directoryPath: string, cutoffMs: number): Promise<number> {
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }
    throw error;
  }

  let deletedFiles = 0;

  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      deletedFiles += await pruneArtifactsDirectory(entryPath, cutoffMs);
      const remainingEntries = await readdir(entryPath).catch(() => []);
      if (remainingEntries.length === 0) {
        await rm(entryPath, { recursive: true, force: true });
      }
      continue;
    }

    const entryStats = await stat(entryPath);
    if (entryStats.mtimeMs < cutoffMs) {
      await rm(entryPath, { force: true });
      deletedFiles += 1;
    }
  }

  return deletedFiles;
}

async function deleteRunHistoryForRun(runId: string) {
  const [eventCountRow] = await db
    .select({ value: count() })
    .from(runEvents)
    .where(eq(runEvents.runId, runId));
  const [logCountRow] = await db
    .select({ value: count() })
    .from(runLogs)
    .where(eq(runLogs.runId, runId));
  const [commandCountRow] = await db
    .select({ value: count() })
    .from(runCommands)
    .where(eq(runCommands.runId, runId));
  const [messageCountRow] = await db
    .select({ value: count() })
    .from(runMessages)
    .where(eq(runMessages.runId, runId));
  const [taskCountRow] = await db
    .select({ value: count() })
    .from(runTasks)
    .where(eq(runTasks.runId, runId));

  await withSqliteWriteRetry(() => db.delete(runEvents).where(eq(runEvents.runId, runId)));
  await withSqliteWriteRetry(() => db.delete(runLogs).where(eq(runLogs.runId, runId)));
  await withSqliteWriteRetry(() => db.delete(runCommands).where(eq(runCommands.runId, runId)));
  await withSqliteWriteRetry(() => db.delete(runMessages).where(eq(runMessages.runId, runId)));
  await withSqliteWriteRetry(() => db.delete(runTasks).where(eq(runTasks.runId, runId)));

  return {
    events: Number(eventCountRow?.value ?? 0),
    logs: Number(logCountRow?.value ?? 0),
    commands: Number(commandCountRow?.value ?? 0),
    messages: Number(messageCountRow?.value ?? 0),
    tasks: Number(taskCountRow?.value ?? 0),
  };
}

export async function pruneRunHistory(options: { force?: boolean } = {}) {
  const nowMs = Date.now();
  if (!options.force && nowMs - lastPruneAt < PRUNE_INTERVAL_MS) {
    return {
      skipped: true,
      deletedEvents: 0,
      deletedLogs: 0,
      deletedCommands: 0,
      deletedMessages: 0,
      deletedTasks: 0,
      deletedArtifacts: 0,
      deletedWorktrees: 0,
    };
  }
  lastPruneAt = nowMs;

  const config = await getConfig();
  const dbCutoff = new Date(nowMs - config.runtime.db_retention_days * RETENTION_DAY_MS);
  const artifactCutoffMs = nowMs - config.runtime.artifact_retention_days * RETENTION_DAY_MS;
  const retainedWorktreeCutoff = new Date(
    nowMs - config.runtime.failed_worktree_retention_days * RETENTION_DAY_MS,
  );
  const prunableRuns = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        inArray(runs.status, TERMINAL_RUN_STATES),
        isNotNull(runs.finishedAt),
        lt(runs.finishedAt, dbCutoff),
      ),
    );

  let deletedEvents = 0;
  let deletedLogs = 0;
  let deletedCommands = 0;
  let deletedMessages = 0;
  let deletedTasks = 0;
  let deletedWorktrees = 0;

  for (const run of prunableRuns) {
    const deleted = await deleteRunHistoryForRun(run.id);
    deletedEvents += deleted.events;
    deletedLogs += deleted.logs;
    deletedCommands += deleted.commands;
    deletedMessages += deleted.messages;
    deletedTasks += deleted.tasks;
  }

  const deletedArtifacts = await pruneArtifactsDirectory(
    join(config.runtime.logs_dir, "runs"),
    artifactCutoffMs,
  );

  const worktreeRuns = await db
    .select({
      id: runs.id,
      repositoryId: runs.repositoryId,
      worktreePath: runs.worktreePath,
    })
    .from(runs)
    .where(
      and(
        eq(runs.worktreeRetained, true),
        inArray(runs.status, ["failed", "cancelled"]),
        isNotNull(runs.worktreePath),
        isNotNull(runs.finishedAt),
        lt(runs.finishedAt, retainedWorktreeCutoff),
      ),
    );

  const git = new GitManager(config);
  for (const run of worktreeRuns) {
    if (!run.worktreePath) {
      continue;
    }
    try {
      if (run.repositoryId) {
        const repository = await getRepositoryById(run.repositoryId);
        await git.cleanupWorktree(repository, run.worktreePath);
      } else {
        await rm(run.worktreePath, { recursive: true, force: true });
      }
      await withSqliteWriteRetry(() => db
        .update(runs)
        .set({
          worktreePath: null,
          worktreeRetained: false,
          updatedAt: new Date(),
        })
        .where(eq(runs.id, run.id)));
      deletedWorktrees += 1;
    } catch {
      continue;
    }
  }

  if (deletedEvents + deletedLogs + deletedCommands + deletedMessages > 500) {
    await withSqliteWriteRetry(() => db.run(sql`vacuum`));
  }

  return {
    skipped: false,
    deletedEvents,
    deletedLogs,
    deletedCommands,
    deletedMessages,
    deletedTasks,
    deletedArtifacts,
    deletedWorktrees,
  };
}

function buildRunArtifactsPath(logsDir: string, runId: string) {
  return join(logsDir, "runs", runId);
}
