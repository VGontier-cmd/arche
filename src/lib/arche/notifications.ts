import type { OrchestratorConfig } from "../config";
import type { RunRow } from "../db/schema";

const NOTIFY_STATUSES = new Set([
  "awaiting_plan_approval",
  "awaiting_publish_approval",
  "needs_human_input",
  "failed",
]);

const STATUS_EMOJI: Record<string, string> = {
  awaiting_plan_approval: ":memo:",
  awaiting_publish_approval: ":rocket:",
  needs_human_input: ":raising_hand:",
  failed: ":x:",
};

const STATUS_LABEL: Record<string, string> = {
  awaiting_plan_approval: "Plan ready for approval",
  awaiting_publish_approval: "Ready to publish",
  needs_human_input: "Needs human input",
  failed: "Run failed",
};

export function sendSlackNotification(config: OrchestratorConfig, run: RunRow): void {
  if (!config.notifications.slack_enabled) return;
  const webhookUrl = config.notifications.slack_webhook_url.trim();
  if (!webhookUrl || !NOTIFY_STATUSES.has(run.status)) return;

  const emoji = STATUS_EMOJI[run.status] ?? ":bell:";
  const label = STATUS_LABEL[run.status] ?? run.status;
  const detail = run.status === "needs_human_input" && run.pendingQuestion
    ? `\n>${run.pendingQuestion}`
    : run.status === "failed" && run.failureReason
      ? `\n>${run.failureReason}`
      : "";

  const text = `${emoji} *${label}* — \`${run.ticketKey}\` (${run.repoName ?? "unknown repo"})${detail}`;

  // Fire-and-forget — never block a run transition
  fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn(
          `[notifications] slack webhook returned ${res.status} for run ${run.id}: ${body.slice(0, 200)}`,
        );
      }
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[notifications] slack webhook failed for run ${run.id}: ${message}`);
    });
}
