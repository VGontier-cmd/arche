import {
  buildActionDescriptor,
  getContextualApproveAction,
  type DashboardActionKind,
} from "./actions";
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

export function getNavigableRunIds(snapshot: DashboardSnapshot) {
  return [...snapshot.inboxRuns, ...snapshot.activeRuns, ...snapshot.recentRuns].map((run) => run.id);
}

function handleModalInput(
  state: DashboardControllerState,
  key: string,
  chars: string,
): {
  state: DashboardControllerState;
  effect: DashboardControllerEffect;
} {
  if (!state.modal) {
    return { state, effect: null };
  }

  if (key === "escape") {
    return {
      state: {
        ...state,
        modal: null,
      },
      effect: null,
    };
  }

  if (state.modal.kind === "confirm") {
    if (key === "enter") {
      return {
        state: {
          ...state,
          modal: null,
        },
        effect: {
          type: "execute_action",
          action: {
            kind: state.modal.actionKind,
            runId: state.modal.runId,
          },
        },
      };
    }
    return { state, effect: null };
  }

  if (key === "C-s") {
    if (!state.modal.value.trim()) {
      return { state, effect: { type: "notify", message: "Human response cannot be empty." } };
    }
    return {
      state: {
        ...state,
        modal: null,
      },
      effect: {
        type: "execute_action",
        action: {
          kind: "respond",
          runId: state.modal.runId,
          message: state.modal.value,
        },
      },
    };
  }
  if (key === "backspace") {
    return {
      state: {
        ...state,
        modal: {
          ...state.modal,
          value: state.modal.value.slice(0, -1),
        },
      },
      effect: null,
    };
  }
  if (key === "enter") {
    return {
      state: {
        ...state,
        modal: {
          ...state.modal,
          value: `${state.modal.value}\n`,
        },
      },
      effect: null,
    };
  }
  if (chars.length > 0 && !isControlCharacter(chars)) {
    return {
      state: {
        ...state,
        modal: {
          ...state.modal,
          value: `${state.modal.value}${chars}`,
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

function isControlCharacter(chars: string) {
  return chars.length === 0 || chars.charCodeAt(0) < 32;
}
