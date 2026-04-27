import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
} from "drizzle-orm";

import { db, withSqliteWriteRetry } from "../../db/client";
import { runs, type RunRow } from "../../db/schema";
import { ExternalServiceError } from "../errors";
import { ACTIVE_RUN_STATES } from "../policy";
import { serializeDate } from "../utils";
import {
  type WorkerActivity,
  type WorkerStatus,
  updateWorkerState,
} from "../workers";
import { buildRunArtifactsPath } from "./internal-utils";
import { acquireLock, refreshLock, releaseLock } from "./locks";
import { processRunWithDeps } from "./process-run";
import { recordRunCommand } from "./run-commands";
import { getRepositoryById } from "./repositories";
import { getRunById } from "./run-queries";
import {
  completeRunTask,
  createRunTask,
  ensurePlannerOutput,
  getLatestTaskForRole,
} from "./run-tasks";
import { appendRunEvent, appendRunLog, appendRunMessage, appendSystemRunLog, transitionRun } from "./run-writer";
import { QUEUEABLE_RUN_STATES } from "./constants";

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

export async function refreshLease(
  runId: string,
  workerId: string,
  leaseTtlSeconds: number,
): Promise<void> {
  const [updated] = await withSqliteWriteRetry(() => db
    .update(runs)
    .set({
      leaseOwner: workerId,
      leaseExpiresAt: new Date(Date.now() + leaseTtlSeconds * 1000),
      updatedAt: new Date(),
    })
    // Refuse the refresh only when another worker has stolen the lease — i.e.
    // leaseOwner now points to a different workerId. We deliberately do NOT
    // require leaseExpiresAt > now: the whole point of a refresh is to bump
    // an in-flight (possibly briefly stale) lease, and a slow LLM call should
    // not lose ownership while no one else has competed for it.
    .where(
      and(
        eq(runs.id, runId),
        eq(runs.leaseOwner, workerId),
      ),
    )
    .returning());

  if (!updated) {
    throw new ExternalServiceError(
      `Lease no longer held for run ${runId}`,
      "lease_lost",
    );
  }
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
        worktreeRetained: true,
        updatedAt: now,
      })
      .where(eq(runs.id, run.id)));
    await appendRunEvent(run.id, "run.failed", { reason: "Worker lease expired" });
    await appendRunLog(run.id, "stderr", "worker lease expired");
  }

  return expired.length;
}

export async function sweepTimedOutHumanInput(timeoutHours: number) {
  if (!Number.isFinite(timeoutHours) || timeoutHours <= 0) {
    return 0;
  }
  const now = new Date();
  const cutoff = new Date(now.getTime() - timeoutHours * 3_600_000);
  const timedOut = await db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.status, "needs_human_input"),
        lt(runs.updatedAt, cutoff),
      ),
    );

  for (const run of timedOut) {
    await withSqliteWriteRetry(() => db
      .update(runs)
      .set({
        status: "cancelled",
        failureReason: `Human input timeout exceeded (${timeoutHours}h)`,
        finishedAt: now,
        updatedAt: now,
      })
      .where(eq(runs.id, run.id)));
    await appendRunEvent(run.id, "run.cancelled", { reason: "Human input timeout exceeded" });
    await appendRunLog(run.id, "stderr", `cancelled: human input timeout exceeded (${timeoutHours}h)`);
  }

  return timedOut.length;
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
