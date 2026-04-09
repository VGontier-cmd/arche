import { desc, eq } from "drizzle-orm";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";

import { getConfig } from "../../config";
import { db, withSqliteWriteRetry } from "../../db/client";
import { runCommands, runs } from "../../db/schema";
import { redactText, truncateText } from "../logging";
import type { RunCommand } from "../types";
import { ensureDirectory } from "../utils";
import {
  COMMAND_EXCERPT_LIMIT,
  COMMAND_HISTORY_LIMIT,
  COMMAND_STDERR_LOG_LIMIT,
  COMMAND_STDOUT_LOG_LIMIT,
} from "./constants";
import { buildExcerpt } from "./internal-utils";
import { presentRunCommand } from "./presenters";
import { getRunById } from "./run-queries";
import { appendRunLog, appendSystemRunLog } from "./run-writer";

export async function writeRunCommandArtifacts(runId: string, stdout: string, stderr: string) {
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

export async function recordRunCommand(input: {
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
