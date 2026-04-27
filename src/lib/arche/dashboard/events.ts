import { EventEmitter } from "node:events";

export const dashboardEvents = new EventEmitter();
dashboardEvents.setMaxListeners(200);

export function notifyDashboardChanged() {
  dashboardEvents.emit("changed");
}

/** Emitted whenever a run-specific write occurs (message, event, log, or status change). */
export function notifyRunActivity(runId: string) {
  dashboardEvents.emit("run:activity", runId);
}

/**
 * Live agent stream events — text deltas, tool call args, preliminary tool
 * results — emitted by the executor while the model is still talking. The
 * dashboard's per-run agent-stream endpoint subscribes to these to render the
 * agent "typing" in real time without waiting for getResponse() to resolve.
 */
export type AgentStreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "reasoning_delta"; delta: string }
  | { type: "tool_call_started"; toolName: string }
  | { type: "tool_call_args_delta"; delta: string }
  | { type: "tool_preliminary"; toolCallId: string; result: unknown }
  | { type: "turn_complete"; turn: number }
  | { type: "done" };

/**
 * Emits an agent stream event to consumers in BOTH the local process (via
 * EventEmitter — instant) AND any remote process (via the agent_stream_events
 * SQLite table — polled at ~250 ms by the SSE route). Worker and server run
 * as separate processes in production deployments, so SQLite is the only
 * channel that crosses the boundary.
 */
export function notifyAgentEvent(runId: string, event: AgentStreamEvent) {
  dashboardEvents.emit(`agent:${runId}`, event);
  // Persist for cross-process SSE consumers. Fire-and-forget — a write
  // failure here must never break the worker. The polling consumer simply
  // won't see this event, which is acceptable for transient SDK deltas.
  void persistAgentEvent(runId, event).catch(() => undefined);
}

async function persistAgentEvent(runId: string, event: AgentStreamEvent): Promise<void> {
  const { db, withSqliteWriteRetry } = await import("../../db/client");
  const { agentStreamEvents } = await import("../../db/schema");
  await withSqliteWriteRetry(() =>
    db.insert(agentStreamEvents).values({
      runId,
      payload: event as unknown as Record<string, unknown>,
    }),
  );
}
