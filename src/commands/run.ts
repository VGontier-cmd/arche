import { EventEmitter } from "node:events";

import type { Command } from "commander";

import { printJson } from "../lib/cli-helpers";

const TERMINAL_STATUSES = new Set([
  "success", "pushed", "failed", "cancelled", "publish_rejected",
]);

const STATUS_LABEL: Record<string, string> = {
  pending: "pending",
  planning: "planning…",
  awaiting_plan_approval: "waiting for plan approval",
  executing: "executing…",
  reviewing: "reviewing…",
  awaiting_publish_approval: "waiting for publish approval",
  needs_human_input: "needs human input",
  publishing: "publishing…",
  pushed: "pushed ✓",
  success: "success ✓",
  failed: "failed ✗",
  cancelled: "cancelled",
  publish_rejected: "publish rejected",
};

export function register(program: Command) {
  program
    .command("run")
    .description("Trigger a run for a Jira ticket")
    .argument("<ticketKey>", "Jira ticket key, e.g. PROJ-123")
    .option("--force", "bypass eligibility checks and active-run guard")
    .option("--watch", "stream run status to stdout until terminal state")
    .option("--title <title>", "inline ticket title (skips Jira fetch — useful when Jira is not configured)")
    .option("--description <text>", "inline ticket description (paired with --title)")
    .option("--issue-type <type>", "inline ticket issue type (default: Task)")
    .action(async (
      ticketKey: string,
      options: { force?: boolean; watch?: boolean; title?: string; description?: string; issueType?: string },
    ) => {
      const [{ ensureArcheReady }, { createManualRunForTicket }] =
        await Promise.all([
          import("../lib/bootstrap"),
          import("../lib/arche/runs"),
        ]);
      await ensureArcheReady();
      const run = await createManualRunForTicket({
        ticketKey,
        force: Boolean(options.force),
        ...(options.title
          ? {
              inline: {
                title: options.title,
                description: options.description ?? "",
                issueType: options.issueType ?? null,
              },
            }
          : {}),
      });

      if (!options.watch) {
        printJson(run);
        return;
      }

      // -- Watch mode --
      const { env } = await import("../lib/env");
      const host = env.ARCHE_SERVER_HOST === "0.0.0.0" ? "127.0.0.1" : env.ARCHE_SERVER_HOST;
      const port = process.env.ARCHE_SERVER_PORT ?? "8787";
      const base = `http://${host}:${port}`;
      const runId = run.id;

      console.log(`Run ${runId} started for ${ticketKey}. Watching…\n`);

      let lastStatus = "";
      const pollStatus = async () => {
        const res = await fetch(`${base}/v1/runs/${runId}`);
        if (!res.ok) return null;
        return res.json() as Promise<{ status: string; failureReason?: string | null; pendingQuestion?: string | null }>;
      };

      await new Promise<void>((resolve) => {
        const eventSource = new EventEmitter();

        const handleActivity = async () => {
          const current = await pollStatus().catch(() => null);
          if (!current) return;
          if (current.status !== lastStatus) {
            lastStatus = current.status;
            const label = STATUS_LABEL[current.status] ?? current.status;
            const ts = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
            process.stdout.write(`[${ts}] ${label}\n`);
            if (current.pendingQuestion) {
              process.stdout.write(`  → ${current.pendingQuestion}\n`);
            }
            if (TERMINAL_STATUSES.has(current.status)) {
              if (current.failureReason) {
                process.stdout.write(`  → ${current.failureReason}\n`);
              }
              eventSource.emit("done");
            }
          }
        };

        eventSource.on("done", () => resolve());

        // Use SSE stream for real-time activity, fall back to polling
        const sseUrl = `${base}/v1/runs/${runId}/stream`;
        let sseController: AbortController | null = null;

        const startSse = async () => {
          sseController = new AbortController();
          try {
            const res = await fetch(sseUrl, { signal: sseController.signal });
            if (!res.ok || !res.body) return;
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const text = decoder.decode(value);
              if (text.includes("data:")) {
                await handleActivity();
                if (TERMINAL_STATUSES.has(lastStatus)) break;
              }
            }
          } catch {
            // SSE ended or aborted — normal
          }
        };

        // Initial poll + SSE
        handleActivity().then(() => {
          if (!TERMINAL_STATUSES.has(lastStatus)) startSse();
        });
      });
    });
}
