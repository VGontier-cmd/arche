import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { and, count, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";

import { getConfig } from "../../config";
import { db, withSqliteWriteRetry } from "../../db/client";
import {
  runCommands,
  runEvents,
  runLogs,
  runMessages,
  runTasks,
  runs,
} from "../../db/schema";
import { GitManager } from "../git";
import { TERMINAL_RUN_STATES } from "../policy";
import { PRUNE_INTERVAL_MS, RETENTION_DAY_MS } from "./constants";
import { getRepositoryById } from "./repositories";
import { appendRunEvent, appendRunLog } from "./run-writer";

let lastPruneAt = 0;

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
