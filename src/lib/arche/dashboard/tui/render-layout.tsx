import { Text } from "ink";
import { Fragment } from "react";
import type { ReactNode } from "react";

import { listAvailableDashboardActions } from "../actions";
import type { DashboardControllerState } from "../controller";
import type { DashboardSnapshot } from "../snapshot";

import type { HostMetricsSample } from "./host-metrics";
import { HostResourceRow } from "./host-resource-row";
import type { DashboardLayout } from "./layout-types";
import { MetricsSummaryRow } from "./metric-cards";
import { semanticStatInk } from "./ink-styled";
import { extractPlainText } from "./plain-text";
import { renderDetailPaneInk } from "./render-detail";
import {
  buildOpsDetailLabelContent,
  renderHeaderInk,
  renderLeftPaneInk,
} from "./render-sidebar";
import {
  renderTimelinePaneInk,
} from "./render-workflow-timeline";
import { PAL } from "./theme";
import { truncateLine } from "./text-format";

export function countTimelineRows(snapshot: DashboardSnapshot): number {
  if (snapshot.timeline.length === 0) {
    return 1;
  }
  let n = 0;
  for (const item of snapshot.timeline) {
    n += 1;
    if (item.detail) {
      n += 1;
    }
  }
  return n;
}

export function renderDashboardLayout(
  snapshot: DashboardSnapshot,
  state: DashboardControllerState,
  statusMessage: string,
  hostMetrics: { sample: HostMetricsSample } | null,
  dimensions: {
    screenWidth?: number;
    leftHeight?: number;
    leftWidth?: number;
    detailHeight?: number;
    detailWidth?: number;
    timelineHeight?: number;
    timelineWidth?: number;
    detailOuterWidth?: number;
    footerWidth?: number;
    stdoutCols?: number;
  } = {},
): DashboardLayout {
  const selectedRun = snapshot.selectedRun;
  const actions = listAvailableDashboardActions(selectedRun);
  const detailOuter = dimensions.detailOuterWidth ?? 56;
  const stdoutCols = dimensions.stdoutCols ?? process.stdout.columns ?? 80;

  const totalTimelineRows = countTimelineRows(snapshot);
  const visTimeline = dimensions.timelineHeight ?? 12;
  const maxTimelineScroll = Math.max(0, totalTimelineRows - visTimeline);
  const timelineScroll = Math.min(state.scrollByPane.timeline, maxTimelineScroll);

  return {
    header: renderHeaderInk(snapshot, dimensions.screenWidth ?? 120),
    metricsRow: (
      <MetricsSummaryRow
        summary={snapshot.summary}
        stdoutWidth={dimensions.screenWidth ?? stdoutCols}
      />
    ),
    hostMetricsRow: hostMetrics ? (
      <HostResourceRow
        sample={hostMetrics.sample}
        stdoutWidth={dimensions.screenWidth ?? stdoutCols}
      />
    ) : null,
    left: renderLeftPaneInk(
      snapshot,
      state,
      dimensions.leftHeight ?? 24,
      dimensions.leftWidth ?? 40,
      stdoutCols,
    ),
    detailLabel: ` ${buildOpsDetailLabelContent(snapshot, state, detailOuter)} `,
    detail: renderDetailPaneInk(
      snapshot,
      state,
      dimensions.detailHeight ?? 24,
      dimensions.detailWidth ?? 56,
    ),
    timeline: renderTimelinePaneInk(
      snapshot,
      dimensions.timelineWidth ?? 56,
      timelineScroll,
      visTimeline,
    ),
    footer: renderFooterInk(
      snapshot,
      state,
      statusMessage,
      actions,
      dimensions.footerWidth ?? 120,
    ),
    modalTitle: state.modal
      ? state.modal.kind === "confirm"
        ? state.modal.title
        : `Reply for ${state.modal.ticketKey}`
      : null,
    modalBody: state.modal ? renderModalBodyInk(state) : null,
  };
}

function renderFooterInk(
  snapshot: DashboardSnapshot,
  _state: DashboardControllerState,
  statusMessage: string,
  _actions: ReturnType<typeof listAvailableDashboardActions>,
  footerWidth: number,
) {
  const dim = PAL.dimWhite;
  const white = PAL.white;

  const hintsMain = (
    <Text>
      <Text color={dim}>[</Text>
      <Text bold color={white}>
        Tab
      </Text>
      <Text color={dim}>]</Text>
      <Text color={dim}> Cycle </Text>
      <Text color={dim}>[</Text>
      <Text bold color={white}>
        ↑↓
      </Text>
      <Text color={dim}>]</Text>
      <Text color={dim}> Move </Text>
      <Text color={dim}>[</Text>
      <Text bold color={white}>
        Enter
      </Text>
      <Text color={dim}>]</Text>
      <Text color={dim}> Select </Text>
      <Text color={dim}>[</Text>
      <Text bold color={white}>
        t
      </Text>
      <Text color={dim}>]</Text>
      <Text color={dim}> Retry </Text>
      <Text color={dim}>[</Text>
      <Text bold color={white}>
        r
      </Text>
      <Text color={dim}>]</Text>
      <Text color={dim}> Refresh </Text>
      <Text color={dim}>[</Text>
      <Text bold color={white}>
        q
      </Text>
      <Text color={dim}>]</Text>
      <Text color={dim}> Quit</Text>
      {statusMessage && !statusMessage.startsWith("Inbox ") ? (
        <Text color={dim}>{`  │  ${statusMessage}`}</Text>
      ) : null}
    </Text>
  );

  const right = (
    <Text>
      <Text color={PAL.grey}>Inbox </Text>
      {semanticStatInk(snapshot.summary.inboxCount, "inbox")}
      <Text> </Text>
      <Text color={PAL.grey}>Active </Text>
      {semanticStatInk(snapshot.summary.activeCount, "active")}
      <Text> </Text>
      <Text color={PAL.grey}>Failed </Text>
      {semanticStatInk(snapshot.summary.failedCount, "failed")}
      <Text> </Text>
      <Text color={PAL.grey}>Workers </Text>
      <Text color={white}>{snapshot.summary.workerCount}</Text>
    </Text>
  );

  const hintsPlain = extractPlainText(hintsMain);
  const rightPlain = extractPlainText(right);
  if (hintsPlain.length + 2 + rightPlain.length <= footerWidth) {
    return (
      <Text>
        {hintsMain} {"  "}
        {right}
      </Text>
    );
  }
  const hintBudget = Math.max(24, footerWidth - rightPlain.length - 4);
  const trimmed = truncateLine(hintsPlain, hintBudget);
  return (
    <Text>
      <Text color={dim}>{trimmed}</Text>
      {"  "}
      {right}
    </Text>
  );
}

function renderModalBodyInk(state: DashboardControllerState): ReactNode {
  if (!state.modal) {
    return null;
  }
  if (state.modal.kind === "confirm") {
    return (
      <Fragment>
        <Text>{state.modal.body}</Text>
        <Text> </Text>
        <Text>Enter confirm</Text>
        <Text>Esc cancel</Text>
      </Fragment>
    );
  }
  return (
    <Fragment>
      <Text>Question:</Text>
      <Text>{state.modal.question}</Text>
      <Text> </Text>
      <Text>Response:</Text>
      <Text>{state.modal.value || "(empty)"}</Text>
      <Text> </Text>
      <Text>Ctrl+S send</Text>
      <Text>Esc cancel</Text>
    </Fragment>
  );
}
