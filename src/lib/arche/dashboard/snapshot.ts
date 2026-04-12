import { cpus, loadavg, totalmem } from "node:os";

import { asc, count, desc, eq } from "drizzle-orm";

import { getConfig, type OrchestratorConfig } from "../../config";
import { db } from "../../db/client";
import { readSecretEnv } from "../../env";
import {
  runCommands,
  runEvents,
  runLogs,
  runMessages,
  runTasks,
  runs,
  workers,
  type RunRow,
  type WorkerRow,
} from "../../db/schema";
import {
  presentRun,
  presentRunCommand,
  presentRunEvent,
  presentRunLog,
  presentRunMessage,
  presentRunTask,
} from "../runs";
import type { WorkerActivity, WorkerStatus } from "../workers";
import { serializeDate } from "../utils";
import { buildTimeline } from "./snapshot-timeline";
import type { DashboardTimelineItem } from "./timeline-types";

export type { DashboardTimelineItem } from "./timeline-types";

const WORKER_STATUS_PRIORITY: Record<WorkerStatus, number> = {
  waiting: 0,
  busy: 1,
  error: 2,
  idle: 3,
};

const INBOX_STATUSES = new Set([
  "awaiting_plan_approval",
  "needs_human_input",
  "awaiting_publish_approval",
]);
const TERMINAL_STATUSES = new Set(["success", "pushed", "failed", "cancelled", "publish_rejected"]);
const FAILED_STATUSES = new Set(["failed", "cancelled", "publish_rejected"]);

export type DashboardWorker = {
  id: string;
  name: string;
  hostname: string;
  pid: number;
  status: WorkerStatus;
  activity: WorkerActivity;
  currentRunId: string | null;
  currentTicketKey: string | null;
  currentStep: number | null;
  lastError: string | null;
  metadata: Record<string, unknown>;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  heartbeatAgeMs: number | null;
  offline: boolean;
};

export type DashboardSummary = {
  inboxCount: number;
  activeCount: number;
  failedCount: number;
  workerCount: number;
  onlineWorkerCount: number;
  offlineWorkerCount: number;
  totalCostUsd: number;
  avgDurationSeconds: number | null;
};

export type DashboardServiceStatus = {
  workerRunning: boolean;
  serverRunning: boolean;
  serverUrl: string;
};

export type DashboardSystemStats = {
  ramMb: number;
  ramTotalMb: number;
  loadAvg1: number;
  cpuCount: number;
};

/** Whether required process env vars are set (non-empty) for outbound integrations. */
export type DashboardCredentialEnvStatus = {
  /**
   * All `api_key_env` values for executor profiles used by planner, executor, and reviewer.
   * (Default setup targets OpenRouter via `USER_OPENROUTER_API_KEY`.)
   */
  openRouter: boolean;
  /** `USER_GITLAB_BASE_URL` and `USER_GITLAB_TOKEN`. */
  gitlab: boolean;
  /** `USER_JIRA_BASE_URL`, `USER_JIRA_EMAIL`, and `USER_JIRA_API_TOKEN`. */
  jira: boolean;
};

export type DashboardSnapshot = {
  refreshedAt: string;
  offlineThresholdMs: number;
  jiraBaseUrl: string | null;
  summary: DashboardSummary;
  services: DashboardServiceStatus;
  systemStats: DashboardSystemStats;
  credentialEnv: DashboardCredentialEnvStatus;
  workers: DashboardWorker[];
  selectedWorkerId: string | null;
  selectedWorker: DashboardWorker | null;
  selectedRunId: string | null;
  selectedRun: ReturnType<typeof presentRun> | null;
  currentRun: ReturnType<typeof presentRun> | null;
  inboxRuns: Array<ReturnType<typeof presentRun>>;
  activeRuns: Array<ReturnType<typeof presentRun>>;
  recentRuns: Array<ReturnType<typeof presentRun>>;
  logs: Array<ReturnType<typeof presentRunLog>>;
  events: Array<ReturnType<typeof presentRunEvent>>;
  commands: Array<ReturnType<typeof presentRunCommand>>;
  messages: Array<ReturnType<typeof presentRunMessage>>;
  tasks: Array<ReturnType<typeof presentRunTask>>;
  timeline: DashboardTimelineItem[];
  timelineTotal: number;
};

export function deriveWorkerPresentation(
  worker: WorkerRow,
  offlineThresholdMs: number,
  nowMs = Date.now(),
): DashboardWorker {
  const lastHeartbeatMs = worker.lastHeartbeatAt instanceof Date ? worker.lastHeartbeatAt.getTime() : null;
  const heartbeatAgeMs = lastHeartbeatMs === null ? null : Math.max(0, nowMs - lastHeartbeatMs);
  const offline = heartbeatAgeMs !== null && heartbeatAgeMs > offlineThresholdMs;

  return {
    id: worker.id,
    name: `${worker.hostname}:${worker.pid}`,
    hostname: worker.hostname,
    pid: worker.pid,
    status: worker.status as WorkerStatus,
    activity: worker.activity as WorkerActivity,
    currentRunId: worker.currentRunId,
    currentTicketKey: worker.currentTicketKey,
    currentStep: worker.currentStep,
    lastError: worker.lastError,
    metadata: worker.metadata,
    startedAt: serializeDate(worker.startedAt),
    lastHeartbeatAt: serializeDate(worker.lastHeartbeatAt),
    heartbeatAgeMs,
    offline,
  };
}

export async function getDashboardSnapshot(options: {
  selectedRunId?: string | null;
  selectedWorkerId?: string | null;
  nowMs?: number;
} = {}): Promise<DashboardSnapshot> {
  const config = await getConfig();
  const nowMs = options.nowMs ?? Date.now();
  const offlineThresholdMs = Math.max(5_000, config.worker.poll_interval_seconds * 3_000);
  const serverHost = process.env.ARCHE_SERVER_HOST?.trim() || "127.0.0.1";
  const serverPort = Number(process.env.ARCHE_SERVER_PORT || "8787");
  const serverUrl = `http://${serverHost}:${Number.isFinite(serverPort) ? serverPort : 8787}/health`;
  const serverRunning = await probeServerHealth(serverUrl);

  const [workerRows, runRows] = await Promise.all([
    db.select().from(workers).orderBy(desc(workers.lastHeartbeatAt), asc(workers.id)),
    db.select().from(runs).orderBy(desc(runs.updatedAt), desc(runs.createdAt)),
  ]);

  const dashboardWorkers = workerRows
    .map((worker) => deriveWorkerPresentation(worker, offlineThresholdMs, nowMs))
    .sort((left, right) => {
      if (left.offline !== right.offline) {
        return left.offline ? 1 : -1;
      }
      const statusDelta = WORKER_STATUS_PRIORITY[left.status] - WORKER_STATUS_PRIORITY[right.status];
      if (statusDelta !== 0) {
        return statusDelta;
      }
      return (left.heartbeatAgeMs ?? Number.MAX_SAFE_INTEGER) - (right.heartbeatAgeMs ?? Number.MAX_SAFE_INTEGER);
    });
  const onlineWorkerCount = dashboardWorkers.filter((worker) => !worker.offline).length;
  const workerById = new Map(dashboardWorkers.map((worker) => [worker.id, worker]));

  const visibleRunRows = runRows.filter((run) => !run.archivedAt);

  // Aggregate cost and duration across visible runs
  let totalCostUsd = 0;
  let totalDurationSeconds = 0;
  let durationCount = 0;
  for (const run of visibleRunRows) {
    if (run.estimatedCostUsd !== null) {
      totalCostUsd += Number(run.estimatedCostUsd);
    }
    if (run.startedAt && run.finishedAt) {
      const start = run.startedAt instanceof Date ? run.startedAt.getTime() : new Date(run.startedAt as string).getTime();
      const end = run.finishedAt instanceof Date ? run.finishedAt.getTime() : new Date(run.finishedAt as string).getTime();
      totalDurationSeconds += (end - start) / 1000;
      durationCount++;
    }
  }
  const avgDurationSeconds = durationCount > 0 ? Math.round(totalDurationSeconds / durationCount) : null;

  const inboxRows = visibleRunRows.filter((run) => INBOX_STATUSES.has(run.status));
  const activeRows = visibleRunRows.filter(
    (run) => !INBOX_STATUSES.has(run.status) && !TERMINAL_STATUSES.has(run.status),
  );
  const recentRows = visibleRunRows.filter((run) => TERMINAL_STATUSES.has(run.status));

  const selectedRunRow =
    resolveSelectedRunRow(runRows, options.selectedRunId) ??
    resolveSelectedRunRow(runRows, pickDefaultRunId(inboxRows, activeRows, recentRows));
  const selectedRun = selectedRunRow ? presentRun(selectedRunRow) : null;

  const selectedWorker =
    (selectedRunRow?.workerId ? workerById.get(selectedRunRow.workerId) ?? null : null) ??
    (options.selectedWorkerId ? workerById.get(options.selectedWorkerId) ?? null : null);

  const [logs, events, commands, messages, tasks] = selectedRunRow
    ? await Promise.all([
        db
          .select()
          .from(runLogs)
          .where(eq(runLogs.runId, selectedRunRow.id))
          .orderBy(asc(runLogs.timestamp), asc(runLogs.id))
          .limit(80),
        db
          .select()
          .from(runEvents)
          .where(eq(runEvents.runId, selectedRunRow.id))
          .orderBy(asc(runEvents.timestamp), asc(runEvents.id))
          .limit(120),
        db
          .select()
          .from(runCommands)
          .where(eq(runCommands.runId, selectedRunRow.id))
          .orderBy(asc(runCommands.timestamp), asc(runCommands.id))
          .limit(80),
        db
          .select()
          .from(runMessages)
          .where(eq(runMessages.runId, selectedRunRow.id))
          .orderBy(asc(runMessages.sequence), asc(runMessages.id))
          .limit(120),
        db
          .select()
          .from(runTasks)
          .where(eq(runTasks.runId, selectedRunRow.id))
          .orderBy(asc(runTasks.startedAt), asc(runTasks.id))
          .limit(40),
      ])
    : [[], [], [], [], []];

  const presentLogs = logs.map(presentRunLog);
  const presentEvents = events.map(presentRunEvent);
  const presentCommands = commands.map(presentRunCommand);
  const presentMessages = messages.map(presentRunMessage);
  const presentTasks = tasks.map(presentRunTask);

  // Compute the total count of timeline items (beyond the limited fetch above)
  let timelineTotal = 0;
  if (selectedRunRow) {
    const counts = await Promise.all([
      db.select({ c: count() }).from(runLogs).where(eq(runLogs.runId, selectedRunRow.id)),
      db.select({ c: count() }).from(runEvents).where(eq(runEvents.runId, selectedRunRow.id)),
      db.select({ c: count() }).from(runCommands).where(eq(runCommands.runId, selectedRunRow.id)),
      db.select({ c: count() }).from(runMessages).where(eq(runMessages.runId, selectedRunRow.id)),
      db.select({ c: count() }).from(runTasks).where(eq(runTasks.runId, selectedRunRow.id)),
    ]);
    timelineTotal = counts.reduce((sum, rows) => sum + (rows[0]?.c ?? 0), 0);
  }

  const rawJiraUrl = readSecretEnv("USER_JIRA_BASE_URL");
  const jiraBaseUrl = rawJiraUrl ? rawJiraUrl.replace(/\/+$/, "") : null;

  return {
    refreshedAt: new Date(nowMs).toISOString(),
    offlineThresholdMs,
    jiraBaseUrl,
    credentialEnv: deriveDashboardCredentialEnvStatus(config),
    summary: {
      inboxCount: inboxRows.length,
      activeCount: activeRows.length,
      failedCount: visibleRunRows.filter((run) => FAILED_STATUSES.has(run.status)).length,
      workerCount: dashboardWorkers.length,
      onlineWorkerCount,
      offlineWorkerCount: dashboardWorkers.filter((worker) => worker.offline).length,
      totalCostUsd,
      avgDurationSeconds,
    },
    services: {
      workerRunning: onlineWorkerCount > 0,
      serverRunning,
      serverUrl,
    },
    systemStats: {
      ramMb: Math.round(process.memoryUsage.rss() / 1_048_576),
      ramTotalMb: Math.round(totalmem() / 1_048_576),
      loadAvg1: loadavg()[0],
      cpuCount: cpus().length,
    },
    workers: dashboardWorkers,
    selectedWorkerId: selectedWorker?.id ?? null,
    selectedWorker,
    selectedRunId: selectedRun?.id ?? null,
    selectedRun,
    currentRun: selectedRun,
    inboxRuns: inboxRows.map(presentRun),
    activeRuns: activeRows.map(presentRun),
    recentRuns: recentRows.map(presentRun),
    logs: presentLogs,
    events: presentEvents,
    commands: presentCommands,
    messages: presentMessages,
    tasks: presentTasks,
    timeline: buildTimeline({
      logs: presentLogs,
      events: presentEvents,
      commands: presentCommands,
      messages: presentMessages,
      tasks: presentTasks,
    }),
    timelineTotal,
  };
}

async function probeServerHealth(serverUrl: string) {
  try {
    const response = await fetch(serverUrl, { signal: AbortSignal.timeout(500) });
    return response.ok;
  } catch {
    return false;
  }
}

function resolveSelectedRunRow(runRows: RunRow[], selectedRunId: string | null | undefined) {
  if (!selectedRunId) {
    return null;
  }
  return runRows.find((run) => run.id === selectedRunId) ?? null;
}

function pickDefaultRunId(
  inboxRows: RunRow[],
  activeRows: RunRow[],
  recentRows: RunRow[],
) {
  return inboxRows[0]?.id ?? activeRows[0]?.id ?? recentRows[0]?.id ?? null;
}

function deriveDashboardCredentialEnvStatus(
  config: OrchestratorConfig,
): DashboardCredentialEnvStatus {
  const keys = new Set<string>();
  for (const role of ["planner", "executor", "reviewer"] as const) {
    const profileName = config.executors.defaults[role];
    const profile = config.executors.profiles[profileName];
    if (profile) {
      keys.add(profile.api_key_env);
    }
  }
  const openRouter = [...keys].every((name) => readSecretEnv(name) !== null);

  const gitlab =
    readSecretEnv("USER_GITLAB_BASE_URL") !== null &&
    readSecretEnv("USER_GITLAB_TOKEN") !== null;

  const jira =
    readSecretEnv("USER_JIRA_BASE_URL") !== null &&
    readSecretEnv("USER_JIRA_EMAIL") !== null &&
    readSecretEnv("USER_JIRA_API_TOKEN") !== null;

  return { openRouter, gitlab, jira };
}

/**
 * Fetches the full timeline for a run (no per-table limits) with offset/limit pagination.
 * Returns `{ items, total }`.
 */
export async function getRunTimeline(
  runId: string,
  options: { offset?: number; limit?: number } = {},
): Promise<{ items: DashboardTimelineItem[]; total: number }> {
  const [logRows, eventRows, commandRows, messageRows, taskRows] = await Promise.all([
    db.select().from(runLogs).where(eq(runLogs.runId, runId)).orderBy(asc(runLogs.timestamp), asc(runLogs.id)),
    db.select().from(runEvents).where(eq(runEvents.runId, runId)).orderBy(asc(runEvents.timestamp), asc(runEvents.id)),
    db.select().from(runCommands).where(eq(runCommands.runId, runId)).orderBy(asc(runCommands.timestamp), asc(runCommands.id)),
    db.select().from(runMessages).where(eq(runMessages.runId, runId)).orderBy(asc(runMessages.sequence), asc(runMessages.id)),
    db.select().from(runTasks).where(eq(runTasks.runId, runId)).orderBy(asc(runTasks.startedAt), asc(runTasks.id)),
  ]);

  const all = buildTimeline({
    logs: logRows.map(presentRunLog),
    events: eventRows.map(presentRunEvent),
    commands: commandRows.map(presentRunCommand),
    messages: messageRows.map(presentRunMessage),
    tasks: taskRows.map(presentRunTask),
  });

  const total = all.length;
  const offset = options.offset ?? 0;
  const limit = options.limit ?? total;
  const items = all.slice(offset, offset + limit);

  return { items, total };
}
