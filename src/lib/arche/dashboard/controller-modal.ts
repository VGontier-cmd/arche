import type {
  DashboardControllerEffect,
  DashboardControllerState,
} from "./controller-state";

export function handleModalInput(
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

function isControlCharacter(chars: string) {
  return chars.length === 0 || chars.charCodeAt(0) < 32;
}
