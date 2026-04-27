import { useEffect, useReducer, useRef } from "react";

/**
 * Live agent stream events emitted by the backend's per-run channel.
 * Mirror of the AgentStreamEvent union in src/lib/arche/dashboard/events.ts.
 */
export type AgentStreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "reasoning_delta"; delta: string }
  | { type: "tool_call_started"; toolName: string }
  | { type: "tool_call_args_delta"; delta: string }
  | { type: "tool_preliminary"; toolCallId: string; result: unknown }
  | { type: "turn_complete"; turn: number }
  | { type: "done" };

export type AgentStreamState = {
  /** Accumulated assistant text from `text_delta` events. */
  text: string;
  /** Accumulated reasoning ("thinking") text — only populated for reasoning models. */
  reasoning: string;
  /** Args of the tool call currently being typed by the model (raw JSON fragment). */
  partialToolArgs: string;
  /** Last few preliminary tool results (e.g. stdout chunks from run_command). */
  preliminaryResults: Array<{ toolCallId: string; result: unknown }>;
  /** Whether the stream is currently connected. */
  connected: boolean;
  /** Whether the model has emitted a `done` event for the latest turn. */
  done: boolean;
};

const INITIAL_STATE: AgentStreamState = {
  text: "",
  reasoning: "",
  partialToolArgs: "",
  preliminaryResults: [],
  connected: false,
  done: false,
};

type Action =
  | { kind: "reset" }
  | { kind: "connected" }
  | { kind: "event"; event: AgentStreamEvent };

const PRELIMINARY_KEEP = 20;

function reducer(state: AgentStreamState, action: Action): AgentStreamState {
  switch (action.kind) {
    case "reset":
      return INITIAL_STATE;
    case "connected":
      return { ...state, connected: true };
    case "event": {
      const ev = action.event;
      switch (ev.type) {
        case "text_delta":
          return { ...state, text: state.text + ev.delta, done: false };
        case "reasoning_delta":
          return { ...state, reasoning: state.reasoning + ev.delta, done: false };
        case "tool_call_args_delta":
          return { ...state, partialToolArgs: state.partialToolArgs + ev.delta };
        case "tool_call_started":
          return { ...state, partialToolArgs: "" };
        case "tool_preliminary":
          return {
            ...state,
            preliminaryResults: [
              ...state.preliminaryResults.slice(-(PRELIMINARY_KEEP - 1)),
              { toolCallId: ev.toolCallId, result: ev.result },
            ],
          };
        case "turn_complete":
          // A turn ended — clear the partial-args buffer so the next tool call
          // doesn't render concatenated noise from the previous one.
          return { ...state, partialToolArgs: "" };
        case "done":
          return { ...state, done: true, partialToolArgs: "" };
        default:
          return state;
      }
    }
  }
}

/**
 * Subscribes to /v1/runs/:id/agent-stream while the run is in an active
 * "model is talking" status, accumulates text/reasoning deltas + preliminary
 * tool results, and exposes them for live rendering.
 *
 * Resets when runId changes. Closes the EventSource on unmount.
 */
export function useAgentStream(
  runId: string | null,
  runStatus: string | null,
): AgentStreamState {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Tear down any previous connection before opening a new one.
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    dispatch({ kind: "reset" });

    if (!runId) return;
    // Stream is only useful while the model could be talking. We include the
    // approval-waiting states because there's a brief window where the run is
    // already paused but the SDK callback may still emit a final `done`.
    const isLive = ["pending", "researching", "planning", "executing", "reviewing"].includes(runStatus ?? "");
    if (!isLive) return;

    const es = new EventSource(`/v1/runs/${runId}/agent-stream`);
    esRef.current = es;

    es.onopen = () => {
      dispatch({ kind: "connected" });
    };

    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as AgentStreamEvent;
        dispatch({ kind: "event", event });
      } catch {
        // Ignore non-JSON frames (e.g. ": connected" comments).
      }
    };

    es.onerror = () => {
      // Browser auto-reconnects; nothing to do here. The reducer keeps the
      // accumulated text so the UI doesn't flicker on transient drops.
    };

    return () => {
      es.close();
      if (esRef.current === es) {
        esRef.current = null;
      }
    };
  }, [runId, runStatus]);

  return state;
}
