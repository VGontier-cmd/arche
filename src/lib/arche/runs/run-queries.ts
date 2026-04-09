import { asc, desc, eq, gt, and } from "drizzle-orm";

import { getConfig } from "../../config";
import { db } from "../../db/client";
import { readSecretEnv } from "../../env";
import {
  runCommands,
  runEvents,
  runLogs,
  runMessages,
  runTasks,
  runs,
} from "../../db/schema";
import { NotFoundError } from "../errors";
import { resolveExecutionProfile } from "../profiles";
import {
  presentRun,
  presentRunCommand,
  presentRunEvent,
  presentRunLog,
  presentRunMessage,
  presentRunTask,
} from "./presenters";
import { DEFAULT_PAGE_LIMIT } from "./constants";

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

export async function getRunById(runId: string) {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) {
    throw new NotFoundError(`Run ${runId} not found`);
  }
  return run;
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
