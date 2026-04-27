import { asc, desc, eq, gt, and, isNull, gte } from "drizzle-orm";

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

const SUCCESS_STATUSES = new Set(["success", "pushed"]);
const FAILURE_STATUSES = new Set(["failed", "cancelled", "publish_rejected"]);

export type RepoMetrics = {
  repoName: string;
  totalRuns: number;
  successfulRuns: number;
  successRate: number;
  totalCostUsd: number;
  avgDurationMs: number;
};

export type MetricsSummary = {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  successRate: number;
  totalCostUsd: number;
  avgCostUsd: number;
  avgDurationMs: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  byRepo: RepoMetrics[];
};

export async function getMetricsSummary(since?: Date): Promise<MetricsSummary> {
  const rows = await db
    .select({
      status: runs.status,
      repoName: runs.repoName,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
      promptTokens: runs.promptTokens,
      completionTokens: runs.completionTokens,
      estimatedCostUsd: runs.estimatedCostUsd,
    })
    .from(runs)
    .where(and(isNull(runs.archivedAt), since ? gte(runs.createdAt, since) : undefined));

  let successfulRuns = 0;
  let failedRuns = 0;
  let totalCostUsd = 0;
  let costCount = 0;
  let totalDurationMs = 0;
  let durationCount = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  const repoMap = new Map<string, {
    total: number;
    success: number;
    costUsd: number;
    durationMs: number;
    durationCount: number;
  }>();

  for (const row of rows) {
    if (SUCCESS_STATUSES.has(row.status)) successfulRuns++;
    if (FAILURE_STATUSES.has(row.status)) failedRuns++;

    const cost = row.estimatedCostUsd ? Number(row.estimatedCostUsd) : 0;
    if (cost > 0) {
      totalCostUsd += cost;
      costCount++;
    }

    if (row.startedAt && row.finishedAt) {
      const dur = row.finishedAt.getTime() - row.startedAt.getTime();
      totalDurationMs += dur;
      durationCount++;
    }

    totalPromptTokens += row.promptTokens ?? 0;
    totalCompletionTokens += row.completionTokens ?? 0;

    const key = row.repoName ?? "(unknown)";
    const entry = repoMap.get(key) ?? { total: 0, success: 0, costUsd: 0, durationMs: 0, durationCount: 0 };
    entry.total++;
    if (SUCCESS_STATUSES.has(row.status)) entry.success++;
    entry.costUsd += cost;
    if (row.startedAt && row.finishedAt) {
      entry.durationMs += row.finishedAt.getTime() - row.startedAt.getTime();
      entry.durationCount++;
    }
    repoMap.set(key, entry);
  }

  const finished = successfulRuns + failedRuns;
  const byRepo: RepoMetrics[] = [...repoMap.entries()]
    .map(([repoName, e]) => ({
      repoName,
      totalRuns: e.total,
      successfulRuns: e.success,
      successRate: e.total > 0 ? Math.round((e.success / e.total) * 100) : 0,
      totalCostUsd: e.costUsd,
      avgDurationMs: e.durationCount > 0 ? Math.round(e.durationMs / e.durationCount) : 0,
    }))
    .sort((a, b) => b.totalRuns - a.totalRuns);

  return {
    totalRuns: rows.length,
    successfulRuns,
    failedRuns,
    successRate: finished > 0 ? Math.round((successfulRuns / finished) * 100) : 0,
    totalCostUsd,
    avgCostUsd: costCount > 0 ? totalCostUsd / costCount : 0,
    avgDurationMs: durationCount > 0 ? Math.round(totalDurationMs / durationCount) : 0,
    totalPromptTokens,
    totalCompletionTokens,
    byRepo,
  };
}

export type CostEstimate = {
  estimatedCostUsd: number | null;
  basedOnRuns: number;
  repoName: string | null;
};

export async function getCostEstimateForRun(runId: string): Promise<CostEstimate> {
  const run = await getRunById(runId);
  const repoName = run.repoName;
  if (!repoName) return { estimatedCostUsd: null, basedOnRuns: 0, repoName: null };

  // Fetch last 20 successful runs on the same repo that have a cost
  const recentRuns = await db
    .select({ estimatedCostUsd: runs.estimatedCostUsd })
    .from(runs)
    .where(and(
      eq(runs.repoName, repoName),
      isNull(runs.archivedAt),
    ))
    .orderBy(desc(runs.createdAt))
    .limit(30);

  const costs = recentRuns
    .map((r) => (r.estimatedCostUsd ? Number(r.estimatedCostUsd) : null))
    .filter((c): c is number => c !== null && c > 0)
    .slice(0, 20);

  if (costs.length === 0) return { estimatedCostUsd: null, basedOnRuns: 0, repoName };

  // Median cost
  const sorted = [...costs].sort((a, b) => a - b);
  const median = sorted.length % 2 === 0
    ? ((sorted[sorted.length / 2 - 1] ?? 0) + (sorted[sorted.length / 2] ?? 0)) / 2
    : (sorted[Math.floor(sorted.length / 2)] ?? 0);

  return { estimatedCostUsd: median, basedOnRuns: costs.length, repoName };
}

export async function listRuns() {
  const rows = await db.select().from(runs).orderBy(desc(runs.createdAt));
  return rows.map(presentRun);
}

// Escape characters that would corrupt markdown table cells or inline code spans.
// Used for any user-provided values (titles, branch names, finding bodies) that
// flow into the exported report.
function escapeMarkdownInline(input: string): string {
  return input.replace(/[|`<>]/g, (ch) => `\\${ch}`);
}

function escapeMarkdownBlock(input: string): string {
  // Block content can keep most markdown but strip stray closing fences.
  return input.replace(/```/g, "``\u200b`");
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
    `# Run Report: ${escapeMarkdownInline(run.ticketKey)} — ${escapeMarkdownInline(run.ticketTitle)}`,
    "",
    `| Field | Value |`,
    `|---|---|`,
    `| Status | \`${escapeMarkdownInline(run.status)}\` |`,
    `| Repository | ${escapeMarkdownInline(repoName)} |`,
    `| Branch | \`${escapeMarkdownInline(run.branchName ?? "-")}\` |`,
    `| Started | ${startedAt} |`,
    `| Finished | ${finishedAt} |`,
    `| Duration | ${durationStr} |`,
    `| Cost | ${cost} |`,
    `| Tokens | ${tokens} |`,
    run.mrUrl ? `| MR / PR | [${escapeMarkdownInline(run.mrUrl)}](${run.mrUrl}) |` : `| MR / PR | - |`,
    "",
  ];

  if (run.planMarkdown) {
    lines.push("## Plan", "", run.planMarkdown, "");
    if (Array.isArray(run.planRisks) && run.planRisks.length > 0) {
      lines.push("**Risks:**", "");
      for (const risk of run.planRisks) lines.push(`- ${escapeMarkdownInline(risk)}`);
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
      escapeMarkdownBlock(run.diffExcerpt),
      "```",
      "",
    );
  }

  if (findings.length > 0) {
    lines.push("## Reviewer Findings", "");
    findings.forEach((f, i) => {
      const fileSuffix = f.file ? ` \`(${escapeMarkdownInline(f.file)})\`` : "";
      lines.push(`### ${i + 1}. ${escapeMarkdownInline(f.title)}${fileSuffix}`);
      lines.push("", f.body, "");
    });
  }

  if (run.latestReviewSummary) {
    lines.push("## Review Summary", "", run.latestReviewSummary, "");
  }

  if (run.failureReason) {
    lines.push("## Failure", "", `> ${escapeMarkdownInline(run.failureReason)}`, "");
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
