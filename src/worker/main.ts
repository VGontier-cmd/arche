import { hostname } from "node:os";

import { ensureArcheReady } from "../lib/bootstrap";
import { getConfig } from "../lib/config";
import { checkpointWal, database, optimizeDatabase } from "../lib/db/client";
import { createLogger, errorDetails } from "../lib/arche/logging";
import { claimNextRun, processRun, pruneRunHistory, sweepExpiredRuns, sweepTimedOutHumanInput, fireSchedules } from "../lib/arche/runs";
import { sleep } from "../lib/arche/utils";
import {
  buildWorkerId,
  makeWorkerMetadata,
  markWorkerError,
  markWorkerIdle,
  purgeOfflineWorkers,
  registerWorker,
  updateWorkerState,
  deregisterWorker,
} from "../lib/arche/workers";

const logger = createLogger({ service: "worker" });

let shutdownRequested = false;

async function cleanupOrphanContainers() {
  try {
    const { runCommand } = await import("../lib/arche/utils");
    const result = await runCommand("docker", [
      "ps", "-a", "--filter", "name=arche-run-", "--format", "{{.Names}}",
    ]);
    if (result.returncode !== 0 || !result.stdout.trim()) return;

    const { db } = await import("../lib/db/client");
    const { runs } = await import("../lib/db/schema");
    const { inArray } = await import("drizzle-orm");

    const containerNames = result.stdout.trim().split("\n").filter(Boolean);
    const runIds = containerNames
      .map((name) => name.replace("arche-run-", ""))
      .filter(Boolean);

    if (runIds.length === 0) return;

    const activeRuns = await db
      .select({ id: runs.id })
      .from(runs)
      .where(inArray(runs.id, runIds));
    const activeIds = new Set(activeRuns.map((r) => r.id));

    for (const runId of runIds) {
      if (!activeIds.has(runId)) {
        logger.info("worker_loop", "cleaning orphan container", {
          event: "worker.orphan_container_cleanup",
          details: { runId, container: `arche-run-${runId}` },
        });
        await runCommand("docker", ["rm", "-f", `arche-run-${runId}`]);
      }
    }
  } catch (error) {
    logger.warn("worker_loop", "orphan container cleanup failed", {
      event: "worker.orphan_cleanup_failed",
      details: errorDetails(error),
    });
  }
}

async function cleanupOrphanWorktrees() {
  try {
    const { readdir, stat, rm } = await import("node:fs/promises");
    const config = await getConfig();
    const runsDir = config.runtime.runs_dir;

    let entries: string[];
    try {
      entries = await readdir(runsDir);
    } catch {
      return; // runs dir may not exist yet
    }

    const { db } = await import("../lib/db/client");
    const { runs } = await import("../lib/db/schema");
    const { inArray } = await import("drizzle-orm");

    if (entries.length === 0) return;

    const activeRuns = await db
      .select({ id: runs.id })
      .from(runs)
      .where(inArray(runs.id, entries));
    const activeIds = new Set(activeRuns.map((r) => r.id));

    for (const entry of entries) {
      if (!activeIds.has(entry)) {
        const entryPath = `${runsDir}/${entry}`;
        const stats = await stat(entryPath).catch(() => null);
        if (stats?.isDirectory()) {
          logger.info("worker_loop", "cleaning orphan worktree", {
            event: "worker.orphan_worktree_cleanup",
            details: { runId: entry, path: entryPath },
          });
          await rm(entryPath, { recursive: true, force: true });
        }
      }
    }
  } catch (error) {
    logger.warn("worker_loop", "orphan worktree cleanup failed", {
      event: "worker.orphan_worktree_cleanup_failed",
      details: errorDetails(error),
    });
  }
}

async function backupDatabase() {
  try {
    const { mkdir } = await import("node:fs/promises");
    const { readdir, rm } = await import("node:fs/promises");
    const config = await getConfig();
    const backupDir = `${config.runtime.root_dir}/backups`;
    await mkdir(backupDir, { recursive: true });

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 16);
    const backupPath = `${backupDir}/arche-${timestamp}.db`;

    await database.backup(backupPath);

    // Keep only 3 most recent backups
    const files = (await readdir(backupDir))
      .filter((f) => f.startsWith("arche-") && f.endsWith(".db"))
      .sort()
      .reverse();
    for (const file of files.slice(3)) {
      await rm(`${backupDir}/${file}`, { force: true });
    }

    logger.info("worker_loop", "database backup completed", {
      event: "worker.backup_completed",
      details: { path: backupPath },
    });
  } catch (error) {
    logger.warn("worker_loop", "database backup failed", {
      event: "worker.backup_failed",
      details: errorDetails(error),
    });
  }
}

export async function startWorker() {
  await ensureArcheReady();
  await optimizeDatabase();
  const config = await getConfig();
  const host = hostname();
  const workerId = buildWorkerId(host, process.pid);
  let cycles = 0;
  let lastBackupHour = -1;

  // Graceful shutdown handlers
  const handleShutdown = () => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    logger.info("worker_loop", "shutdown requested, finishing current work", {
      event: "worker.shutdown_requested",
      details: { workerId },
    });
  };
  process.on("SIGTERM", handleShutdown);
  process.on("SIGINT", handleShutdown);

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

  // Startup cleanup
  await cleanupOrphanContainers();
  await cleanupOrphanWorktrees();
  // Clear out worker rows orphaned by `kill -9` of previous Arche processes.
  // Without this, the dashboard's worker list slowly fills up with zombies
  // that the operator has to purge by hand each time.
  await purgeOfflineWorkers().catch(() => undefined);

  while (!shutdownRequested) {
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
      const timedOut = await sweepTimedOutHumanInput(config.worker.human_input_timeout_hours);
      if (timedOut > 0) {
        logger.warn("worker_loop", "human input timed out runs cancelled", {
          event: "worker.human_input_timeout",
          details: { count: timedOut },
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
      // Self-heal worker registry every minute (12 cycles × 5 s default poll)
      // — drops rows whose PID is gone or whose heartbeat is > 5 min stale.
      if (cycles % 12 === 0) {
        await purgeOfflineWorkers().catch(() => undefined);
      }

      // Hourly database backup
      const currentHour = new Date().getHours();
      if (currentHour !== lastBackupHour) {
        lastBackupHour = currentHour;
        await backupDatabase();
      }

      await fireSchedules().catch((err) =>
        logger.error("worker_loop", "schedule firing failed", {
          event: "worker.schedule_firing_failed",
          details: errorDetails(err),
        }),
      );

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

  // Graceful shutdown: deregister worker
  logger.info("worker_loop", "worker shutting down", {
    event: "worker.shutdown",
    details: { workerId },
  });
  await deregisterWorker(workerId);
}
