/**
 * Persistent agent state for SDK pause/resume across worker invocations.
 *
 * The OpenRouter SDK exposes a `state: StateAccessor` parameter on `callModel`
 * that lets the SDK persist mid-conversation state (the message history, the
 * pending tool calls, the last response) into our own storage. When combined
 * with `requireApproval`, this enables a true pause-resume flow:
 *
 *   1. Worker A calls callModel with state + requireApproval.
 *   2. Model calls a sensitive tool. SDK pauses and writes state to DB.
 *   3. Worker A releases the run as `needs_human_input`.
 *   4. Human reviews, presses "approve".
 *   5. Worker B claims the run, calls callModel again with the SAME state +
 *      `approveToolCalls: [callId]`. SDK reloads state, executes the tool,
 *      continues the loop.
 *
 * This avoids re-prompting the model from scratch every cycle and preserves
 * context faithfully across human-input gates.
 *
 * NOTE: this file currently only ships the StateAccessor implementation. The
 * full pause-resume flow needs (a) a `runs.agent_state_json` column added via
 * migration and (b) the executor + respond endpoint wired so the SDK is
 * resumed with `approveToolCalls` instead of restarted from scratch. Both are
 * tracked separately — see project_arche_demo_hardening.md.
 */
import type { StateAccessor, Tool } from "@openrouter/sdk/lib/tool-types";

import { db, withSqliteWriteRetry } from "../db/client";
import { runs } from "../db/schema";
import { eq } from "drizzle-orm";

/**
 * Build a StateAccessor backed by the `runs.agent_state_json` column.
 *
 * Usage:
 *   const state = createRunStateAccessor(runId);
 *   client.callModel({ ..., state });
 *
 * The accessor stringifies the SDK's internal ConversationState into JSON for
 * SQLite storage. The schema is opaque to us — we just round-trip whatever
 * the SDK gives us.
 */
export function createRunStateAccessor<TTools extends readonly Tool[] = readonly Tool[]>(
  runId: string,
  /** Column name to read/write — defaults to a column we'll add via migration. */
  column: "agentStateJson" = "agentStateJson",
): StateAccessor<TTools> {
  return {
    async load() {
      const row = await db
        .select()
        .from(runs)
        .where(eq(runs.id, runId))
        .limit(1);
      const raw = (row[0] as Record<string, unknown> | undefined)?.[column];
      if (typeof raw !== "string" || raw.length === 0) return null;
      try {
        return JSON.parse(raw) as Awaited<ReturnType<StateAccessor<TTools>["load"]>>;
      } catch {
        return null;
      }
    },
    async save(state) {
      const json = JSON.stringify(state);
      await withSqliteWriteRetry(() =>
        db
          .update(runs)
          .set({ [column]: json, updatedAt: new Date() } as Record<string, unknown>)
          .where(eq(runs.id, runId)),
      );
    },
  };
}
