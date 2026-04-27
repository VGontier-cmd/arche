import { asc, desc, eq } from "drizzle-orm";

import { withSqliteWriteRetry, db } from "../db/client";
import { runs, workers, type WorkerRow } from "../db/schema";
import { makeId, serializeDate } from "./utils";
import { NotFoundError } from "./errors";
import { notifyDashboardChanged } from "./dashboard/events";
import { redactText, truncateText } from "./logging";

export const WORKER_STATUSES = ["idle", "busy", "waiting", "error"] as const;
export const WORKER_ACTIVITIES = [
  "polling",
  "claiming_run",
  "researching",
  "planning",
  "preparing_repo",
  "creating_sandbox",
  "executing",
  "reviewing",
  "waiting_human_input",
  "waiting_provider",
  "running_command",
  "validating",
  "publishing",
  "cleaning_up",
] as const;

export type WorkerStatus = (typeof WORKER_STATUSES)[number];
export type WorkerActivity = (typeof WORKER_ACTIVITIES)[number];

const WORKER_ERROR_LIMIT = 800;

export type WorkerMetadata = Record<string, unknown>;

export function buildWorkerId(hostname: string, pid: number) {
  return `${hostname}-${pid}`;
}

export function presentWorker(worker: WorkerRow) {
  return {
    ...worker,
    startedAt: serializeDate(worker.startedAt),
    lastHeartbeatAt: serializeDate(worker.lastHeartbeatAt),
  };
}

export async function getWorkerById(workerId: string) {
  const [worker] = await db.select().from(workers).where(eq(workers.id, workerId)).limit(1);
  if (!worker) {
    throw new NotFoundError(`Worker ${workerId} not found`);
  }
  return worker;
}

export async function listWorkers() {
  const rows = await db.select().from(workers).orderBy(desc(workers.lastHeartbeatAt), asc(workers.id));
  return rows.map(presentWorker);
}

export async function registerWorker(input: {
  workerId?: string;
  hostname: string;
  pid: number;
  metadata?: WorkerMetadata;
}) {
  const workerId = input.workerId ?? buildWorkerId(input.hostname, input.pid);
  const now = new Date();
  const existing = await db.select().from(workers).where(eq(workers.id, workerId)).limit(1);

  if (existing[0]) {
    const [worker] = await withSqliteWriteRetry(() =>
      db
        .update(workers)
        .set({
          hostname: input.hostname,
          pid: input.pid,
          lastHeartbeatAt: now,
          status: "idle",
          activity: "polling",
          currentRunId: null,
          currentTicketKey: null,
          currentStep: null,
          lastError: null,
          metadata: input.metadata ?? existing[0]!.metadata,
        })
        .where(eq(workers.id, workerId))
        .returning(),
    );
    notifyDashboardChanged();
    return worker;
  }

  const [worker] = await withSqliteWriteRetry(() =>
    db
      .insert(workers)
      .values({
        id: workerId,
        hostname: input.hostname,
        pid: input.pid,
        status: "idle",
        activity: "polling",
        currentRunId: null,
        currentTicketKey: null,
        currentStep: null,
        lastError: null,
        metadata: input.metadata ?? {},
        startedAt: now,
        lastHeartbeatAt: now,
      })
      .returning(),
  );

  notifyDashboardChanged();
  return worker;
}

export async function updateWorkerState(
  workerId: string,
  patch: {
    status?: WorkerStatus;
    activity?: WorkerActivity;
    currentRunId?: string | null;
    currentTicketKey?: string | null;
    currentStep?: number | null;
    lastError?: string | null;
    metadata?: WorkerMetadata;
  },
) {
  const now = new Date();
  const [worker] = await withSqliteWriteRetry(() =>
    db
      .update(workers)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.activity !== undefined ? { activity: patch.activity } : {}),
        ...(patch.currentRunId !== undefined ? { currentRunId: patch.currentRunId } : {}),
        ...(patch.currentTicketKey !== undefined ? { currentTicketKey: patch.currentTicketKey } : {}),
        ...(patch.currentStep !== undefined ? { currentStep: patch.currentStep } : {}),
        ...(patch.lastError !== undefined
          ? { lastError: patch.lastError ? truncateText(redactText(patch.lastError), WORKER_ERROR_LIMIT) : null }
          : {}),
        ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
        lastHeartbeatAt: now,
      })
      .where(eq(workers.id, workerId))
      .returning(),
  );

  if (patch.status !== undefined || patch.activity !== undefined || patch.currentRunId !== undefined) {
    notifyDashboardChanged();
  }
  return worker;
}

export async function heartbeatWorker(workerId: string) {
  return updateWorkerState(workerId, {});
}

export async function markWorkerIdle(workerId: string) {
  return updateWorkerState(workerId, {
    status: "idle",
    activity: "polling",
    currentRunId: null,
    currentTicketKey: null,
    currentStep: null,
    lastError: null,
  });
}

export async function markWorkerError(workerId: string, error: string) {
  return updateWorkerState(workerId, {
    status: "error",
    activity: "polling",
    lastError: error,
  });
}

export async function deregisterWorker(workerId: string) {
  await withSqliteWriteRetry(() =>
    db.delete(workers).where(eq(workers.id, workerId)),
  );
  notifyDashboardChanged();
}

export async function listWorkerRecentRuns(workerId: string, limit = 10) {
  return db
    .select()
    .from(runs)
    .where(eq(runs.workerId, workerId))
    .orderBy(desc(runs.updatedAt), desc(runs.createdAt))
    .limit(limit);
}

export async function assignRunToWorker(runId: string, workerId: string) {
  await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        workerId,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId)),
  );
}

export async function stopWorker(workerId: string): Promise<{ success: boolean; message: string }> {
  const worker = await getWorkerById(workerId);
  try {
    process.kill(worker.pid, "SIGTERM");
    return { success: true, message: `SIGTERM sent to worker ${workerId} (PID ${worker.pid})` };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") {
      await deregisterWorker(workerId);
      return { success: true, message: `Worker ${workerId} was already dead; deregistered` };
    }
    throw err;
  }
}

export async function purgeOfflineWorkers(): Promise<{ purged: string[] }> {
  const allWorkers = await db.select().from(workers);
  const purged: string[] = [];
  const heartbeatStaleMs = 5 * 60_000; // 5 minutes
  const now = Date.now();
  for (const w of allWorkers) {
    let alive = true;
    try {
      process.kill(w.pid, 0); // signal 0 = check if process exists
    } catch {
      alive = false;
    }
    // Heartbeat-based fallback: if a worker hasn't heartbeated in 5 min,
    // assume it's dead even if its PID happens to be reused by something
    // else on the OS. The worker loop heartbeats every 5 s so 5 min is a
    // generous safety margin.
    const hb = w.lastHeartbeatAt instanceof Date ? w.lastHeartbeatAt.getTime() : 0;
    const staleHeartbeat = now - hb > heartbeatStaleMs;
    if (!alive || staleHeartbeat) {
      await deregisterWorker(w.id);
      purged.push(w.id);
    }
  }
  return { purged };
}

export async function restartWorker(workerId: string): Promise<{
  success: boolean;
  message: string;
  oldPid: number;
  newPid: number | null;
}> {
  const worker = await getWorkerById(workerId);
  const oldPid = worker.pid;

  try {
    process.kill(oldPid, "SIGTERM");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
  }

  // Wait for the old worker to deregister (up to 5s)
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const existing = await db.select().from(workers).where(eq(workers.id, workerId)).limit(1);
    if (!existing[0]) break;
  }

  const { fork } = await import("node:child_process");
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { archePackageRootDir } = await import("../cli-helpers");

  const root = archePackageRootDir();
  const distWorker = join(root, "dist", "worker", "main.js");
  const isBundled = existsSync(distWorker);
  const workerPath = isBundled ? distWorker : join(root, "src", "bin", "worker.ts");

  const child = fork(workerPath, [], {
    stdio: "inherit",
    env: process.env,
    execArgv: isBundled ? [] : ["--import", "tsx"],
    detached: false,
  });

  const newPid = child.pid ?? null;
  child.unref();

  return {
    success: true,
    message: `Worker restarted (old PID: ${oldPid}, new PID: ${newPid})`,
    oldPid,
    newPid,
  };
}

export function makeWorkerMetadata(input: {
  pollIntervalSeconds: number;
  maxAgentSteps: number;
  version?: string;
}) {
  return {
    instanceId: makeId(),
    pollIntervalSeconds: input.pollIntervalSeconds,
    maxAgentSteps: input.maxAgentSteps,
    version: input.version ?? "0.1.0",
  };
}
