import { desc, eq } from "drizzle-orm";

import { db, withSqliteWriteRetry } from "../../db/client";
import { runEvents, runLogs, runMessages, runs, type RunRow } from "../../db/schema";
import { TERMINAL_RUN_STATES } from "../policy";
import { redactText, truncateText } from "../logging";
import type { RunStatus } from "../types";
import { RUN_LOG_MESSAGE_LIMIT, RUN_MESSAGE_LIMIT } from "./constants";
import { sanitizePayload } from "./internal-utils";
import { presentRunMessage } from "./presenters";

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
