import type { DashboardActionKind } from "./actions";
import type { DashboardSnapshot } from "./snapshot";

export const DASHBOARD_FOCUSED_PANES = ["lists", "detail", "timeline"] as const;
export type DashboardFocusedPane = (typeof DASHBOARD_FOCUSED_PANES)[number];

export const DASHBOARD_DETAIL_TABS = ["overview", "plan", "findings"] as const;
export type DashboardDetailTab = (typeof DASHBOARD_DETAIL_TABS)[number];

export type DashboardConfirmModalState = {
  kind: "confirm";
  actionKind: DashboardActionKind;
  runId: string;
  title: string;
  body: string;
};

export type DashboardHumanReplyModalState = {
  kind: "human_reply";
  runId: string;
  ticketKey: string;
  question: string;
  value: string;
};

export type DashboardModalState =
  | DashboardConfirmModalState
  | DashboardHumanReplyModalState
  | null;

export type DashboardControllerState = {
  selectedRunId: string | null;
  highlightedRunId: string | null;
  focusedPane: DashboardFocusedPane;
  detailTab: DashboardDetailTab;
  scrollByPane: Record<DashboardFocusedPane, number>;
  modal: DashboardModalState;
};

export type DashboardControllerEffect =
  | { type: "refresh" }
  | { type: "quit" }
  | {
      type: "execute_action";
      action: {
        kind: DashboardActionKind;
        runId: string;
        message?: string;
      };
    }
  | { type: "notify"; message: string }
  | null;

export function createDashboardControllerState(): DashboardControllerState {
  return {
    selectedRunId: null,
    highlightedRunId: null,
    focusedPane: "lists",
    detailTab: "overview",
    scrollByPane: {
      lists: 0,
      detail: 0,
      timeline: 0,
    },
    modal: null,
  };
}

export function getNavigableRunIds(snapshot: DashboardSnapshot) {
  return [...snapshot.inboxRuns, ...snapshot.activeRuns, ...snapshot.recentRuns].map((run) => run.id);
}

export function reconcileDashboardControllerState(
  state: DashboardControllerState,
  snapshot: DashboardSnapshot,
): DashboardControllerState {
  const navigableRunIds = getNavigableRunIds(snapshot);
  const selectedRunId =
    state.selectedRunId && navigableRunIds.includes(state.selectedRunId)
      ? state.selectedRunId
      : snapshot.selectedRunId;
  const highlightedRunId =
    state.highlightedRunId && navigableRunIds.includes(state.highlightedRunId)
      ? state.highlightedRunId
      : selectedRunId;

  return {
    ...state,
    selectedRunId: selectedRunId ?? null,
    highlightedRunId: highlightedRunId ?? null,
    modal: state.modal && !navigableRunIds.includes(state.modal.runId) ? null : state.modal,
  };
}
