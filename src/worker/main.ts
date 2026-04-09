import { hostname } from "node:os";

import { ensureArcheReady } from "../lib/bootstrap";
import { getConfig } from "../lib/config";
import { checkpointWal, optimizeDatabase } from "../lib/db/client";
import { createLogger, errorDetails } from "../lib/arche/logging";
import { claimNextRun, processRun, pruneRunHistory, sweepExpiredRuns } from "../lib/arche/runs";
import { sleep } from "../lib/arche/utils";
import {
  buildWorkerId,
  makeWorkerMetadata,
  markWorkerError,
  markWorkerIdle,
  registerWorker,
  updateWorkerState,
} from "../lib/arche/workers";

const logger = createLogger({ service: "worker" });

export async function startWorker() {
  await ensureArcheReady();
  await optimizeDatabase();
  const config = await getConfig();
  const host = hostname();
  const workerId = buildWorkerId(host, process.pid);
  let cycles = 0;

  await registerWorker({
    workerId,
    hostname: host,
    pid: process.pid,
    metadata: makeWorkerMetadata({
      pollIntervalSeconds: config.worker.poll_interval_seconds,
      maxAgentSteps: config.worker.max_agent_steps,
    }),
  });

  logger.info("worker_loop", "worker started", {
    event: "worker.started",
    details: { workerId },
  });

  while (true) {
    try {
      cycles += 1;
      await markWorkerIdle(workerId);
      const expired = await sweepExpiredRuns();
      if (expired > 0) {
        logger.warn("worker_loop", "expired runs marked as failed", {
          event: "worker.expired_runs_failed",
          details: { count: expired },
        });
      }
      const pruned = await pruneRunHistory();
      if (
        !pruned.skipped &&
        (pruned.deletedEvents > 0 ||
          pruned.deletedLogs > 0 ||
          pruned.deletedCommands > 0 ||
          pruned.deletedArtifacts > 0 ||
          pruned.deletedWorktrees > 0)
      ) {
        await checkpointWal("PASSIVE");
        logger.info("worker_loop", "pruned retained run history", {
          event: "worker.history_pruned",
          details: pruned,
        });
      }
      if (cycles % 100 === 0) {
        await checkpointWal("PASSIVE");
      }
      const run = await claimNextRun(workerId, config.worker.lease_ttl_seconds);
      if (run) {
        await updateWorkerState(workerId, {
          status: "busy",
          activity: "claiming_run",
          currentRunId: run.id,
          currentTicketKey: run.ticketKey,
        });
        logger.info("worker_loop", "processing run", {
          runId: run.id,
          ticketKey: run.ticketKey,
          event: "worker.run_processing",
        });
        await processRun(run.id, workerId);
        await markWorkerIdle(workerId);
      }
    } catch (error) {
      await markWorkerError(
        workerId,
        error instanceof Error ? error.message : "Unknown worker cycle error",
      );
      logger.error("worker_loop", "worker cycle failed", {
        event: "worker.cycle_failed",
        details: errorDetails(error),
      });
    }
    await sleep(config.worker.poll_interval_seconds * 1000);
  }
}
