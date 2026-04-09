import { listAvailableDashboardActions } from "../actions";
import type { DashboardControllerState } from "../controller";
import type { DashboardSnapshot } from "../snapshot";

import type { DashboardLayout } from "./layout-types";
import { PAL } from "./theme";
import {
  semanticStat,
  stripBlessedTags,
  truncateLine,
} from "./text-format";
import { renderDetailPane } from "./render-detail";
import {
  buildOpsDetailLabelContent,
  renderHeader,
  renderLeftPane,
} from "./render-sidebar";
import { renderTimelinePane } from "./render-workflow-timeline";

export function renderDashboardLayout(
  snapshot: DashboardSnapshot,
  state: DashboardControllerState,
  statusMessage: string,
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
  } = {},
): DashboardLayout {
  const selectedRun = snapshot.selectedRun;
  const actions = listAvailableDashboardActions(selectedRun);
  const detailOuter = dimensions.detailOuterWidth ?? 56;

  return {
    header: renderHeader(snapshot, dimensions.screenWidth ?? 120),
    left: renderLeftPane(
      snapshot,
      state,
      dimensions.leftHeight ?? 24,
      dimensions.leftWidth ?? 40,
    ),
    detailLabel: ` ${buildOpsDetailLabelContent(snapshot, state, detailOuter)} `,
    detail: renderDetailPane(
      snapshot,
      state,
      dimensions.detailHeight ?? 24,
      dimensions.detailWidth ?? 56,
    ),
    timeline: renderTimelinePane(snapshot, dimensions.timelineWidth ?? 56),
    footer: renderFooter(
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
    modalBody: state.modal ? renderModalBody(state) : null,
  };
}

function renderFooter(
  snapshot: DashboardSnapshot,
  _state: DashboardControllerState,
  statusMessage: string,
  _actions: ReturnType<typeof listAvailableDashboardActions>,
  footerWidth: number,
) {
  const dim = PAL.dimWhite;
  const white = PAL.white;
  const footKey = (label: string) =>
    `{${dim}-fg}[{/${dim}-fg}{${white}-fg}{bold}${label}{/}{${dim}-fg}]{/}`;
  const gap = (text: string) => `{${dim}-fg}${text}{/}`;

  let hints = [
    footKey("Tab"),
    gap(" Cycle  "),
    footKey("↑↓"),
    gap(" Move  "),
    footKey("Enter"),
    gap(" Select  "),
    footKey("t"),
    gap(" Retry  "),
    footKey("r"),
    gap(" Refresh  "),
    footKey("q"),
    gap(" Quit"),
  ].join("");

  if (statusMessage && !statusMessage.startsWith("Inbox ")) {
    hints += gap(`  │  ${statusMessage}`);
  }

  const right = [
    `{${PAL.grey}-fg}Inbox{/} `,
    semanticStat(snapshot.summary.inboxCount, "inbox"),
    `  {${PAL.grey}-fg}Active{/} `,
    semanticStat(snapshot.summary.activeCount, "active"),
    `  {${PAL.grey}-fg}Failed{/} `,
    semanticStat(snapshot.summary.failedCount, "failed"),
    `  {${PAL.grey}-fg}Workers{/} `,
    `{${white}-fg}${snapshot.summary.workerCount}{/}`,
  ].join("");

  let line = `${hints}  ${right}`;
  if (stripBlessedTags(line).length > footerWidth) {
    const rightPlain = stripBlessedTags(right);
    const hintBudget = Math.max(24, footerWidth - rightPlain.length - 4);
    hints = truncateLine(stripBlessedTags(hints), hintBudget);
    line = `{${dim}-fg}${hints}{/}  ${right}`;
  }
  return line;
}

function renderModalBody(state: DashboardControllerState) {
  if (!state.modal) {
    return null;
  }
  if (state.modal.kind === "confirm") {
    return [state.modal.body, "", "Enter confirm", "Esc cancel"].join("\n");
  }
  return [
    "Question:",
    state.modal.question,
    "",
    "Response:",
    state.modal.value || "(empty)",
    "",
    "Ctrl+S send",
    "Esc cancel",
  ].join("\n");
}
