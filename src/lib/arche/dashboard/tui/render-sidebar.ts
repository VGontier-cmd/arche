import type { DashboardControllerState } from "../controller";
import type { DashboardSnapshot } from "../snapshot";

import {
  FAILED_RUN_STATUSES,
  HEADER_BANNER_LINES,
  PAL,
  SUCCESS_RUN_STATUS,
} from "./theme";
import {
  centerPlainLine,
  flowMixBarWidth,
  formatCenteredPaneLabel,
  formatRunStatusColored,
  formatRunStatusForHeader,
  renderFlowMixBar,
  semanticCounterLetter,
  semanticStat,
  stripBlessedTags,
  tDimWhite,
  tItalicGrey,
  truncateLine,
  truncateToVisibleWidth,
} from "./text-format";
import { collectProjectSummary, formatAge, sliceWindow } from "./tui-helpers";

export function renderHeader(snapshot: DashboardSnapshot, screenWidth: number) {
  const innerWidth = Math.max(24, screenWidth - 4);
  const successfulRuns = snapshot.recentRuns.filter(
    (run) => run.status === SUCCESS_RUN_STATUS,
  ).length;
  const workerOnlineCount = Math.max(
    0,
    snapshot.summary.workerCount - snapshot.summary.offlineWorkerCount,
  );
  const workerOfflineCount = snapshot.summary.offlineWorkerCount;
  const projects = collectProjectSummary(snapshot);
  const projectBits = projects.slice(0, 4).map((p) => {
    const dot = p.total > 0 ? `{${PAL.done}-fg}●{/}` : `{${PAL.grey}-fg}○{/}`;
    return `${dot} {${PAL.white}-fg}{bold}${p.key}{/}`;
  });
  const projectsLine =
    projectBits.length > 0
      ? `{${PAL.grey}-fg}Projects{/}  ${projectBits.join("  ")}`
      : `{${PAL.grey}-fg}Projects{/}  {${PAL.dimWhite}-fg}none{/}`;

  const onlineDot = `{${PAL.done}-fg}●{/}`;
  const offlineDot = `{${PAL.grey}-fg}○{/}`;
  const workersLine = `{${PAL.grey}-fg}Workers{/}  ${onlineDot} {${PAL.white}-fg}{bold}${workerOnlineCount}{/}{${PAL.grey}-fg}/{/}{${PAL.white}-fg}${snapshot.summary.workerCount}{/} online  ${offlineDot} {${PAL.white}-fg}${workerOfflineCount}{/} offline`;
  const serverDot = snapshot.services.serverRunning
    ? `{${PAL.done}-fg}●{/}`
    : `{${PAL.failedFg}-fg}●{/}`;
  const workerDot = snapshot.services.workerRunning
    ? `{${PAL.done}-fg}●{/}`
    : `{${PAL.failedFg}-fg}●{/}`;
  const servicesLine = `{${PAL.grey}-fg}Services{/}  API server ${serverDot}  Worker service ${workerDot}`;

  const selectedLine = snapshot.selectedRun
    ? `{${PAL.grey}-fg}Selected{/}  {${PAL.white}-fg}{bold}${snapshot.selectedRun.ticketKey}{/}  ${formatRunStatusForHeader(snapshot.selectedRun.status)}`
    : `{${PAL.grey}-fg}Selected{/}  {${PAL.dimWhite}-fg}none{/}`;

  const statsLine = [
    `{${PAL.grey}-fg}Inbox [{/}`,
    semanticStat(snapshot.summary.inboxCount, "inbox"),
    `{${PAL.grey}-fg}]{/}`,
    `  │  `,
    `{${PAL.grey}-fg}Active [{/}`,
    semanticStat(snapshot.summary.activeCount, "active"),
    `{${PAL.grey}-fg}]{/}`,
    `  │  `,
    `{${PAL.grey}-fg}Failed [{/}`,
    semanticStat(snapshot.summary.failedCount, "failed"),
    `{${PAL.grey}-fg}]{/}`,
    `  │  `,
    `{${PAL.grey}-fg}Done [{/}`,
    semanticStat(successfulRuns, "done"),
    `{${PAL.grey}-fg}]{/}`,
  ].join("");

  const bannerLines = HEADER_BANNER_LINES.map((line) =>
    centerPlainLine(line, innerWidth),
  );

  const lines = [
    ...bannerLines,
    statsLine,
    projectsLine,
    servicesLine,
    workersLine,
    selectedLine,
  ];

  return lines
    .map((line) =>
      stripBlessedTags(line).length <= innerWidth
        ? line
        : truncateLine(stripBlessedTags(line), innerWidth),
    )
    .join("\n");
}

export function renderLeftPane(
  snapshot: DashboardSnapshot,
  state: DashboardControllerState,
  maxLines: number,
  maxWidth: number,
) {
  const lines: string[] = [];
  const focusLineByRunId = new Map<string, number>();
  const projects = collectProjectSummary(snapshot);
  const successfulRuns = snapshot.recentRuns.filter(
    (run) => run.status === SUCCESS_RUN_STATUS,
  ).length;
  const runMax = Math.max(
    1,
    snapshot.summary.inboxCount,
    snapshot.summary.activeCount,
    snapshot.summary.failedCount,
    successfulRuns,
  );
  const barW = Math.min(flowMixBarWidth(), Math.max(4, maxWidth - 24));

  lines.push(`{${PAL.white}-fg}{bold}Flow Mix{/}`);
  lines.push(
    `  {${PAL.grey}-fg}Inbox{/}  ${renderFlowMixBar(snapshot.summary.inboxCount, runMax, barW, "inbox")}  ${semanticStat(snapshot.summary.inboxCount, "inbox")}`,
  );
  lines.push(
    `  {${PAL.grey}-fg}Active{/}  ${renderFlowMixBar(snapshot.summary.activeCount, runMax, barW, "active")}  ${semanticStat(snapshot.summary.activeCount, "active")}`,
  );
  lines.push(
    `  {${PAL.grey}-fg}Failed{/}  ${renderFlowMixBar(snapshot.summary.failedCount, runMax, barW, "failed")}  ${semanticStat(snapshot.summary.failedCount, "failed")}`,
  );
  lines.push(
    `  {${PAL.grey}-fg}Done{/}    ${renderFlowMixBar(successfulRuns, runMax, barW, "done")}  ${semanticStat(successfulRuns, "done")}`,
  );

  lines.push("", `{${PAL.white}-fg}{bold}Projects (${projects.length}){/}`);
  if (projects.length === 0) {
    lines.push(`  ${tItalicGrey("none")}`);
  } else {
    const topProjects = projects.slice(
      0,
      Math.min(4, Math.max(2, Math.floor(maxLines / 10))),
    );
    for (const project of topProjects) {
      const dot =
        snapshot.selectedRun?.ticketProjectKey === project.key
          ? `{${PAL.done}-fg}●{/}`
          : `{${PAL.grey}-fg}●{/}`;
      const jobLabel = project.total === 1 ? "1 job" : `${project.total} jobs`;
      lines.push(
        `  ${dot} {${PAL.white}-fg}{bold}${project.key}{/}  {${PAL.grey}-fg}[${jobLabel}]{/}  ${semanticCounterLetter("i", project.inbox, "inbox")} ${semanticCounterLetter("a", project.active, "active")} ${semanticCounterLetter("f", project.failed, "failed")} ${semanticCounterLetter("d", project.done, "done")}`,
      );
    }
  }

  lines.push("");
  appendRunSection(
    lines,
    focusLineByRunId,
    "Inbox",
    snapshot.inboxRuns,
    state,
    "inbox",
  );
  lines.push("");
  appendRunSection(
    lines,
    focusLineByRunId,
    "Active",
    snapshot.activeRuns,
    state,
    "active",
  );
  lines.push("");
  appendRunSection(
    lines,
    focusLineByRunId,
    "Recent",
    snapshot.recentRuns,
    state,
    "recent",
  );
  lines.push(
    "",
    `{${PAL.white}-fg}{bold}Workers (${snapshot.workers.length}){/}`,
  );
  if (snapshot.workers.length === 0) {
    lines.push(`  ${tItalicGrey("none")}`);
  } else {
    lines.push(
      ...snapshot.workers.map((worker) => {
        const head = worker.offline
          ? `{${PAL.failedFg}-fg}◯{/}`
          : `{${PAL.done}-fg}◉{/}`;
        const hb = tItalicGrey(`hb ${formatAge(worker.heartbeatAgeMs)}`);
        return `  ${head} {${PAL.inbox}-fg}${worker.name}{/}  ${worker.status}/${worker.activity}  ${hb}`;
      }),
    );
  }

  const highlightIndex =
    (state.highlightedRunId
      ? focusLineByRunId.get(state.highlightedRunId)
      : undefined) ?? 0;
  return sliceWindow(lines, highlightIndex, maxLines)
    .map((line) => truncateToVisibleWidth(line, maxWidth))
    .join("\n");
}

type RunSectionKind = "inbox" | "active" | "recent";

function runSectionIcon(kind: RunSectionKind, status: string): string {
  if (kind === "inbox") {
    return `{${PAL.inbox}-fg}·{/}`;
  }
  if (kind === "active") {
    return `{${PAL.active}-fg}{bold}⟳{/}`;
  }
  if (status === SUCCESS_RUN_STATUS) {
    return `{${PAL.done}-fg}✓{/}`;
  }
  if (FAILED_RUN_STATUSES.has(status)) {
    return `{${PAL.failedFg}-fg}{bold}✗{/}`;
  }
  return `{${PAL.grey}-fg}·{/}`;
}

function appendRunSection(
  lines: string[],
  focusLineByRunId: Map<string, number>,
  label: string,
  runs: DashboardSnapshot["inboxRuns"],
  state: DashboardControllerState,
  kind: RunSectionKind,
) {
  lines.push(`{${PAL.white}-fg}{bold}${label} (${runs.length}){/}`);
  if (runs.length === 0) {
    lines.push(`  ${tItalicGrey("none")}`);
    return;
  }

  for (const run of runs) {
    focusLineByRunId.set(run.id, lines.length);
    const highlighted =
      run.id === state.highlightedRunId ? `{${PAL.active}-fg}>{/}` : " ";
    const selected = run.id === state.selectedRunId ? "*" : " ";
    const icon = runSectionIcon(kind, run.status);
    lines.push(
      ` ${highlighted}${selected}${icon} {${PAL.white}-fg}{bold}${run.ticketKey}{/}  ${formatRunStatusColored(run.status)}`,
    );
    lines.push(
      `    ${tDimWhite(`${run.currentRole ?? "—"} · cycle ${run.currentCycle ?? 0} · ${run.repoName ?? "—"}`)}`,
    );
  }
}

export function buildOpsDetailLabelContent(
  snapshot: DashboardSnapshot,
  state: DashboardControllerState,
  detailOuterWidth: number,
): string {
  const run = snapshot.selectedRun;
  const tab = state.detailTab;
  let plain = "⚡ OPS DETAIL";
  if (run && FAILED_RUN_STATUSES.has(run.status)) {
    plain += "  ✗ FAILED";
  }
  plain += `  (${tab})`;
  if (plain.length > detailOuterWidth - 6) {
    plain = `⚡ OPS DETAIL (${tab})`;
  }
  return formatCenteredPaneLabel(detailOuterWidth, plain);
}
