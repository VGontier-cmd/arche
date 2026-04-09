import { buildActionDescriptor, getContextualApproveAction } from "./actions";
import { handleModalInput } from "./controller-modal";
import {
  DASHBOARD_DETAIL_TABS,
  DASHBOARD_FOCUSED_PANES,
  getNavigableRunIds,
  type DashboardControllerEffect,
  type DashboardControllerState,
  type DashboardFocusedPane,
} from "./controller-state";
import type { DashboardSnapshot } from "./snapshot";

export function handleDashboardInput(
  state: DashboardControllerState,
  snapshot: DashboardSnapshot,
  key: string,
  chars = "",
): {
  state: DashboardControllerState;
  effect: DashboardControllerEffect;
} {
  if (state.modal) {
    return handleModalInput(state, key, chars);
  }

  if (key === "q") {
    return { state, effect: { type: "quit" } };
  }
  if (key === "r") {
    return { state, effect: { type: "refresh" } };
  }
  if (key === "tab") {
    return {
      state: {
        ...state,
        focusedPane: cyclePane(state.focusedPane),
      },
      effect: null,
    };
  }
  if (key === "1" || key === "2" || key === "3") {
    return {
      state: {
        ...state,
        detailTab: DASHBOARD_DETAIL_TABS[Number(key) - 1] ?? state.detailTab,
        scrollByPane: {
          ...state.scrollByPane,
          detail: 0,
        },
      },
      effect: null,
    };
  }
  if (key === "up" || key === "k") {
    return moveWithinPane(state, snapshot, -1);
  }
  if (key === "down" || key === "j") {
    return moveWithinPane(state, snapshot, 1);
  }
  if (key === "enter" && state.focusedPane === "lists") {
    return {
      state: {
        ...state,
        selectedRunId: state.highlightedRunId,
        scrollByPane: {
          ...state.scrollByPane,
          detail: 0,
          timeline: 0,
        },
      },
      effect: null,
    };
  }

  const selectedRun = snapshot.selectedRun;
  if (!selectedRun) {
    return { state, effect: null };
  }

  if (key === "a") {
    const actionKind = getContextualApproveAction(selectedRun);
    if (!actionKind) {
      return { state, effect: { type: "notify", message: "No approval action available for this run." } };
    }
    const descriptor = buildActionDescriptor(selectedRun, actionKind);
    return {
      state: {
        ...state,
        modal: {
          kind: "confirm",
          actionKind,
          runId: selectedRun.id,
          title: descriptor.confirmationTitle ?? descriptor.label,
          body: descriptor.confirmationBody ?? "",
        },
      },
      effect: null,
    };
  }
  if (key === "h") {
    if (selectedRun.status !== "needs_human_input") {
      return { state, effect: { type: "notify", message: "This run is not waiting for human input." } };
    }
    return {
      state: {
        ...state,
        modal: {
          kind: "human_reply",
          runId: selectedRun.id,
          ticketKey: selectedRun.ticketKey,
          question: selectedRun.pendingQuestion ?? "No explicit question recorded.",
          value: selectedRun.latestHumanResponse ?? "",
        },
      },
      effect: null,
    };
  }
  if (key === "x") {
    if (selectedRun.status !== "awaiting_publish_approval") {
      return { state, effect: { type: "notify", message: "Publish rejection is only available while publish approval is pending." } };
    }
    const descriptor = buildActionDescriptor(selectedRun, "reject_publish");
    return {
      state: {
        ...state,
        modal: {
          kind: "confirm",
          actionKind: "reject_publish",
          runId: selectedRun.id,
          title: descriptor.confirmationTitle ?? descriptor.label,
          body: descriptor.confirmationBody ?? "",
        },
      },
      effect: null,
    };
  }
  if (key === "c") {
    if (!canCancelRun(selectedRun.status)) {
      return { state, effect: { type: "notify", message: "Cancel is not available for this run." } };
    }
    const descriptor = buildActionDescriptor(selectedRun, "cancel");
    return {
      state: {
        ...state,
        modal: {
          kind: "confirm",
          actionKind: "cancel",
          runId: selectedRun.id,
          title: descriptor.confirmationTitle ?? descriptor.label,
          body: descriptor.confirmationBody ?? "",
        },
      },
      effect: null,
    };
  }
  if (key === "t") {
    if (!canRetryRun(selectedRun.status)) {
      return { state, effect: { type: "notify", message: "Retry is only available for failed, cancelled, or rejected runs." } };
    }
    const descriptor = buildActionDescriptor(selectedRun, "retry");
    return {
      state: {
        ...state,
        modal: {
          kind: "confirm",
          actionKind: "retry",
          runId: selectedRun.id,
          title: descriptor.confirmationTitle ?? descriptor.label,
          body: descriptor.confirmationBody ?? "",
        },
      },
      effect: null,
    };
  }

  return { state, effect: null };
}

function moveWithinPane(
  state: DashboardControllerState,
  snapshot: DashboardSnapshot,
  delta: -1 | 1,
) {
  if (state.focusedPane === "lists") {
    const runIds = getNavigableRunIds(snapshot);
    if (runIds.length === 0) {
      return { state, effect: null };
    }
    const currentIndex = state.highlightedRunId ? runIds.indexOf(state.highlightedRunId) : 0;
    const safeIndex = currentIndex < 0 ? 0 : currentIndex;
    const nextIndex = Math.max(0, Math.min(runIds.length - 1, safeIndex + delta));
    return {
      state: {
        ...state,
        highlightedRunId: runIds[nextIndex] ?? runIds[0] ?? null,
      },
      effect: null,
    };
  }

  return {
    state: {
      ...state,
      scrollByPane: {
        ...state.scrollByPane,
        [state.focusedPane]: Math.max(0, state.scrollByPane[state.focusedPane] + delta),
      },
    },
    effect: null,
  };
}

function cyclePane(current: DashboardFocusedPane): DashboardFocusedPane {
  const index = DASHBOARD_FOCUSED_PANES.indexOf(current);
  return DASHBOARD_FOCUSED_PANES[(index + 1) % DASHBOARD_FOCUSED_PANES.length] ?? "lists";
}

function canRetryRun(status: string) {
  return status === "failed" || status === "cancelled" || status === "publish_rejected";
}

function canCancelRun(status: string) {
  return !canRetryRun(status) && status !== "success";
}
