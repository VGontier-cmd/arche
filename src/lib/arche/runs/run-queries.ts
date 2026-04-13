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

export async function exportRunAsMarkdown(runId: string): Promise<string> {
  const run = await getRunById(runId);

  let repoName = run.repositoryId ?? "-";
  if (run.repositoryId) {
    try {
      const { getRepositoryById } = await import("./repositories");
      const repo = await getRepositoryById(run.repositoryId);
      repoName = repo.name;
    } catch {
      // ignore
    }
  }

  const startedAt = run.startedAt ? new Date(run.startedAt).toISOString().replace("T", " ").slice(0, 19) : "-";
  const finishedAt = run.finishedAt ? new Date(run.finishedAt).toISOString().replace("T", " ").slice(0, 19) : "-";
  const durationSec = run.startedAt && run.finishedAt
    ? Math.floor((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000)
    : null;
  const durationStr = durationSec !== null
    ? durationSec < 60 ? `${durationSec}s` : `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
    : "-";
  const cost = run.estimatedCostUsd !== null && run.estimatedCostUsd !== undefined
    ? `$${Number(run.estimatedCostUsd).toFixed(4)}`
    : "-";
  const tokens = run.promptTokens ? `${run.promptTokens.toLocaleString()} in / ${(run.completionTokens ?? 0).toLocaleString()} out` : "-";

  const findings: Array<{ title: string; body: string; file?: string | null }> =
    Array.isArray(run.latestFindings) ? run.latestFindings : [];

  const diffLines = run.diffExcerpt ? run.diffExcerpt.split("\n") : [];
  const additions = diffLines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const deletions = diffLines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;

  const lines: string[] = [
    `# Run Report: ${run.ticketKey} — ${run.ticketTitle}`,
    "",
    `| Field | Value |`,
    `|---|---|`,
    `| Status | \`${run.status}\` |`,
    `| Repository | ${repoName} |`,
    `| Branch | \`${run.branchName ?? "-"}\` |`,
    `| Started | ${startedAt} |`,
    `| Finished | ${finishedAt} |`,
    `| Duration | ${durationStr} |`,
    `| Cost | ${cost} |`,
    `| Tokens | ${tokens} |`,
    run.mrUrl ? `| MR / PR | [${run.mrUrl}](${run.mrUrl}) |` : `| MR / PR | - |`,
    "",
  ];

  if (run.planMarkdown) {
    lines.push("## Plan", "", run.planMarkdown, "");
    if (Array.isArray(run.planRisks) && run.planRisks.length > 0) {
      lines.push("**Risks:**", "");
      for (const risk of run.planRisks) lines.push(`- ${risk}`);
      lines.push("");
    }
  }

  if (run.diffExcerpt) {
    lines.push(
      "## Changes",
      "",
      `+${additions} −${deletions} lines`,
      "",
      "```diff",
      run.diffExcerpt,
      "```",
      "",
    );
  }

  if (findings.length > 0) {
    lines.push("## Reviewer Findings", "");
    findings.forEach((f, i) => {
      lines.push(`### ${i + 1}. ${f.title}${f.file ? ` \`(${f.file})\`` : ""}`);
      lines.push("", f.body, "");
    });
  }

  if (run.latestReviewSummary) {
    lines.push("## Review Summary", "", run.latestReviewSummary, "");
  }

  if (run.failureReason) {
    lines.push("## Failure", "", `> ${run.failureReason}`, "");
  }

  lines.push(`---`, ``, `*Exported from Arche on ${new Date().toISOString().slice(0, 10)}*`);

  return lines.join("\n");
}

export async function getRunsByTicketKey(ticketKey: string) {
  const rows = await db
    .select()
    .from(runs)
    .where(eq(runs.ticketKey, ticketKey))
    .orderBy(desc(runs.createdAt));
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
