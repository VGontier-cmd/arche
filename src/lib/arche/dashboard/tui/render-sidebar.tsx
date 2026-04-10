import { Box, Text } from "ink";
import { Fragment } from "react";
import type { ReactNode } from "react";

import type { DashboardControllerState } from "../controller";
import type { DashboardSnapshot } from "../snapshot";

import {
  formatRunStatusColoredInk,
  renderFlowMixBarInk,
  semanticCounterLetterInk,
  semanticStatInk,
  tDimWhiteInk,
  tItalicGreyInk,
} from "./ink-styled";
import { runSectionIconInk } from "./render-workflow-timeline";
import { extractPlainText } from "./plain-text";
import {
  flowMixBarWidth,
  formatCenteredPaneLabel,
  truncateLine,
  truncateToVisibleWidth,
} from "./text-format";
import {
  FAILED_RUN_STATUSES,
  HEADER_BANNER_LINES,
  PAL,
  SUCCESS_RUN_STATUS,
} from "./theme";

const HEADER_META_LINE_COUNT = 4;
import { collectProjectSummary, formatAge } from "./tui-helpers";

export function renderHeaderInk(snapshot: DashboardSnapshot, screenWidth: number) {
  const innerWidth = Math.max(24, screenWidth - 4);
  /** Side-by-side layout needs room for ASCII block (~56 cols) + meta (~28 cols). */
  const useSideBySideBanner = innerWidth >= 92;
  const workerOnlineCount = Math.max(
    0,
    snapshot.summary.workerCount - snapshot.summary.offlineWorkerCount,
  );
  const workerOfflineCount = snapshot.summary.offlineWorkerCount;

  const credentialDot = (ok: boolean) =>
    ok ? <Text color={PAL.done}>●</Text> : <Text color={PAL.failedFg}>●</Text>;

  const credentialsLine = (
    <Text>
      <Text color={PAL.grey}>Env </Text>
      <Text color={PAL.grey}>OpenRouter </Text>
      {credentialDot(snapshot.credentialEnv.openRouter)}
      <Text> </Text>
      <Text color={PAL.grey}>GitLab </Text>
      {credentialDot(snapshot.credentialEnv.gitlab)}
      <Text> </Text>
      <Text color={PAL.grey}>Jira </Text>
      {credentialDot(snapshot.credentialEnv.jira)}
    </Text>
  );

  const servicesLine = (
    <Text>
      <Text color={PAL.grey}>Services </Text>
      API server{" "}
      {snapshot.services.serverRunning ? (
        <Text color={PAL.done}>●</Text>
      ) : (
        <Text color={PAL.failedFg}>●</Text>
      )}{" "}
      Worker service{" "}
      {snapshot.services.workerRunning ? (
        <Text color={PAL.done}>●</Text>
      ) : (
        <Text color={PAL.failedFg}>●</Text>
      )}
    </Text>
  );

  const workersLine = (
    <Text>
      <Text color={PAL.grey}>Workers </Text>
      <Text color={PAL.done}>●</Text>{" "}
      <Text bold color={PAL.white}>
        {workerOnlineCount}
      </Text>
      <Text color={PAL.grey}>/</Text>
      <Text color={PAL.white}>{snapshot.summary.workerCount}</Text> online{" "}
      <Text color={PAL.grey}>○</Text>{" "}
      <Text color={PAL.white}>{workerOfflineCount}</Text> offline
    </Text>
  );

  const selectedLine = snapshot.selectedRun ? (
    <Text>
      <Text color={PAL.grey}>Selected </Text>
      <Text bold color={PAL.white}>
        {snapshot.selectedRun.ticketKey}
      </Text>{" "}
      {formatRunStatusColoredInk(snapshot.selectedRun.status)}
    </Text>
  ) : (
    <Text>
      <Text color={PAL.grey}>Selected </Text>
      <Text color={PAL.dimWhite}>none</Text>
    </Text>
  );

  const bannerBlock = (
    <Box flexDirection="column" flexShrink={0}>
      {HEADER_BANNER_LINES.map((line, i) => (
        <Text key={`b-${i}`}>{line.trimEnd()}</Text>
      ))}
    </Box>
  );

  const packRow = (row: ReactNode, key: string) => {
    const plain = extractPlainText(row);
    /** ASCII block ~56–58 cols + divider column + horizontal padding. */
    const budget = useSideBySideBanner
      ? Math.max(28, innerWidth - 58 - 7)
      : innerWidth;
    if (plain.length <= budget) {
      return <Text key={key}>{row}</Text>;
    }
    return (
      <Text key={key}>{truncateLine(plain, budget)}</Text>
    );
  };

  const metaBlock = (
    <Box flexDirection="column" flexGrow={useSideBySideBanner ? 1 : 0} minWidth={24}>
      {packRow(credentialsLine, "cred")}
      {packRow(servicesLine, "svc")}
      {packRow(workersLine, "work")}
      {packRow(selectedLine, "sel")}
    </Box>
  );

  const dividerHeight = Math.max(
    HEADER_BANNER_LINES.length,
    HEADER_META_LINE_COUNT,
  );
  const verticalDivider = (
    <Box
      flexShrink={0}
      paddingX={1}
      marginLeft={1}
      marginRight={1}
      justifyContent="flex-start"
    >
      <Text color={PAL.dimWhite}>
        {Array.from({ length: dividerHeight }, () => "│").join("\n")}
      </Text>
    </Box>
  );

  const horizontalRuleWidth = Math.max(16, innerWidth - 4);
  const horizontalDivider = (
    <Box flexDirection="column" marginTop={1} marginBottom={1} width="100%">
      <Text color={PAL.dimWhite}>{"─".repeat(horizontalRuleWidth)}</Text>
    </Box>
  );

  if (useSideBySideBanner) {
    return (
      <Box flexDirection="row" alignItems="flex-start" width="100%">
        <Box flexShrink={0} paddingRight={1}>
          {bannerBlock}
        </Box>
        {verticalDivider}
        <Box flexGrow={1} minWidth={24} paddingLeft={1}>
          {metaBlock}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      <Box paddingBottom={1}>{bannerBlock}</Box>
      {horizontalDivider}
      <Box paddingLeft={1}>{metaBlock}</Box>
    </Box>
  );
}

type RunSectionKind = "inbox" | "active" | "recent";

function appendRunSectionInk(
  lines: ReactNode[],
  focusLineByRunId: Map<string, number>,
  label: string,
  runs: DashboardSnapshot["inboxRuns"],
  state: DashboardControllerState,
  kind: RunSectionKind,
) {
  lines.push(
    <Text>
      <Text bold color={PAL.white}>
        {label} ({runs.length})
      </Text>
    </Text>,
  );
  if (runs.length === 0) {
    lines.push(
      <Text>
        {" "}
        {tItalicGreyInk("none")}
      </Text>,
    );
    return;
  }

  for (const run of runs) {
    focusLineByRunId.set(run.id, lines.length);
    const highlighted =
      run.id === state.highlightedRunId ? (
        <Text color={PAL.active}>&gt;</Text>
      ) : (
        <Text> </Text>
      );
    const selected = run.id === state.selectedRunId ? "*" : " ";
    const icon = runSectionIconInk(kind, run.status);
    lines.push(
      <Text>
        {highlighted}
        {selected}
        {icon}{" "}
        <Text bold color={PAL.white}>
          {run.ticketKey}
        </Text>{" "}
        {formatRunStatusColoredInk(run.status)}
      </Text>,
    );
    lines.push(
      <Text>
        {"    "}
        {tDimWhiteInk(
          `${run.currentRole ?? "—"} · cycle ${run.currentCycle ?? 0} · ${run.repoName ?? "—"}`,
        )}
      </Text>,
    );
  }
}

function sliceWindowNodes(
  nodes: ReactNode[],
  focusIndex: number,
  maxLines: number,
): ReactNode[] {
  if (nodes.length <= maxLines) {
    return nodes;
  }
  const half = Math.max(0, Math.floor(maxLines / 2));
  let start = Math.max(0, focusIndex - half);
  let end = start + maxLines;
  if (end > nodes.length) {
    end = nodes.length;
    start = Math.max(0, end - maxLines);
  }
  return nodes.slice(start, end);
}

export function renderLeftPaneInk(
  snapshot: DashboardSnapshot,
  state: DashboardControllerState,
  maxLines: number,
  maxWidth: number,
  stdoutCols: number,
) {
  const lines: ReactNode[] = [];
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
  const labelCol = 8;
  const statCol = 6;
  const barW = Math.max(
    4,
    Math.min(
      flowMixBarWidth(stdoutCols),
      maxWidth - labelCol - statCol - 3,
    ),
  );

  const flowRow = (
    label: string,
    value: number,
    kind: "inbox" | "active" | "failed" | "done",
  ) => (
    <Box flexDirection="row" alignItems="center" columnGap={1}>
      <Box width={labelCol}>
        <Text color={PAL.grey}>{label.padEnd(labelCol)}</Text>
      </Box>
      <Box width={barW}>
        {renderFlowMixBarInk(value, runMax, barW, kind)}
      </Box>
      <Box justifyContent="flex-end" width={statCol}>
        {semanticStatInk(value, kind)}
      </Box>
    </Box>
  );

  lines.push(
    <Text bold color={PAL.white}>
      Flow Mix
    </Text>,
  );
  lines.push(flowRow("Inbox", snapshot.summary.inboxCount, "inbox"));
  lines.push(flowRow("Active", snapshot.summary.activeCount, "active"));
  lines.push(flowRow("Failed", snapshot.summary.failedCount, "failed"));
  lines.push(flowRow("Done", successfulRuns, "done"));

  lines.push(
    <Text>
      <Text bold color={PAL.white}>
        Projects ({projects.length})
      </Text>
    </Text>,
  );
  if (projects.length === 0) {
    lines.push(
      <Text>
        {" "}
        {tItalicGreyInk("none")}
      </Text>,
    );
  } else {
    const topProjects = projects.slice(
      0,
      Math.min(4, Math.max(2, Math.floor(maxLines / 10))),
    );
    for (const project of topProjects) {
      const dot =
        snapshot.selectedRun?.ticketProjectKey === project.key ? (
          <Text color={PAL.done}>●</Text>
        ) : (
          <Text color={PAL.grey}>●</Text>
        );
      const jobLabel = project.total === 1 ? "1 job" : `${project.total} jobs`;
      lines.push(
        <Text>
          {" "}
          {dot}{" "}
          <Text bold color={PAL.white}>
            {project.key}
          </Text>{" "}
          <Text color={PAL.grey}>[{jobLabel}]</Text>{" "}
          {semanticCounterLetterInk("i", project.inbox, "inbox")}{" "}
          {semanticCounterLetterInk("a", project.active, "active")}{" "}
          {semanticCounterLetterInk("f", project.failed, "failed")}{" "}
          {semanticCounterLetterInk("d", project.done, "done")}
        </Text>,
      );
    }
  }

  lines.push(<Text> </Text>);
  /** Active first: in-flight work stays visible without scrolling past a long inbox. */
  appendRunSectionInk(lines, focusLineByRunId, "Active", snapshot.activeRuns, state, "active");
  lines.push(<Text> </Text>);
  appendRunSectionInk(lines, focusLineByRunId, "Inbox", snapshot.inboxRuns, state, "inbox");
  lines.push(<Text> </Text>);
  appendRunSectionInk(lines, focusLineByRunId, "Recent", snapshot.recentRuns, state, "recent");
  lines.push(
    <Text>
      <Text bold color={PAL.white}>
        Workers ({snapshot.workers.length})
      </Text>
    </Text>,
  );
  if (snapshot.workers.length === 0) {
    lines.push(
      <Text>
        {" "}
        {tItalicGreyInk("none")}
      </Text>,
    );
  } else {
    for (const worker of snapshot.workers) {
      const head = worker.offline ? (
        <Text color={PAL.failedFg}>◯</Text>
      ) : (
        <Text color={PAL.done}>◉</Text>
      );
      lines.push(
        <Text>
          {" "}
          {head} <Text color={PAL.inbox}>{worker.name}</Text>{" "}
          {worker.status}/{worker.activity}{" "}
          {tItalicGreyInk(`hb ${formatAge(worker.heartbeatAgeMs)}`)}
        </Text>,
      );
    }
  }

  const highlightIndex =
    (state.highlightedRunId
      ? focusLineByRunId.get(state.highlightedRunId)
      : undefined) ?? 0;
  const sliced = sliceWindowNodes(lines, highlightIndex, maxLines);
  return (
    <Fragment>
      {sliced.map((row, i) => (
        <LineClamped key={i} maxWidth={maxWidth}>
          {row}
        </LineClamped>
      ))}
    </Fragment>
  );
}

function LineClamped({
  children,
  maxWidth,
}: {
  children: ReactNode;
  maxWidth: number;
}) {
  const plain = extractPlainText(children);
  if (plain.length <= maxWidth) {
    return <Box overflow="hidden">{children}</Box>;
  }
  return (
    <Box overflow="hidden" width={maxWidth}>
      <Text color={PAL.dimWhite}>{truncateToVisibleWidth(plain, maxWidth)}</Text>
    </Box>
  );
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
