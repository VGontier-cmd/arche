import type { DashboardSnapshot } from "../snapshot";

import { FAILED_RUN_STATUSES, PAL } from "./theme";
import {
  formatWorkflowStateBadge,
  stripBlessedTags,
  tDimWhite,
  tItalicGrey,
  truncateUnicode,
} from "./text-format";
import { formatTimestamp } from "./tui-helpers";

export function timelineSourceTag(
  source: DashboardSnapshot["timeline"][number]["source"],
): string {
  if (source === "event") {
    return `{${PAL.active}-fg}{bold}[event]{/}`;
  }
  if (source === "log" || source === "message") {
    return `{${PAL.grey}-fg}[log]{/}`;
  }
  return `{${PAL.branchBlue}-fg}[system]{/}`;
}

export function renderTimelinePane(snapshot: DashboardSnapshot, maxWidth: number) {
  if (snapshot.timeline.length === 0) {
    return `{${PAL.dimWhite}-fg}No timeline entries for the selected run.{/}`;
  }

  const inner = Math.max(8, maxWidth - 4);
  const lines: string[] = [];

  for (const item of snapshot.timeline) {
    const ts = tItalicGrey(formatTimestamp(item.timestamp));
    const tag = timelineSourceTag(item.source);
    const titlePlain = stripBlessedTags(item.title);
    const headPlainLen =
      stripBlessedTags(formatTimestamp(item.timestamp)).length +
      1 +
      stripBlessedTags(tag).length +
      1;
    const titleBudget = Math.max(8, inner - headPlainLen);
    const titleColored = `{${PAL.white}-fg}${truncateUnicode(titlePlain, titleBudget)}{/}`;
    lines.push(`${ts}  ${tag}  ${titleColored}`);

    if (item.detail) {
      lines.push(
        `  ${tDimWhite(truncateUnicode(item.detail, inner - 2, "…"))}`,
      );
    }
  }

  return lines.join("\n");
}

export function renderWorkflowLane(snapshot: DashboardSnapshot) {
  const run = snapshot.selectedRun;
  if (!run) {
    return [`  ${tDimWhite("No run selected.")}`];
  }

  const completedRoles = new Set(
    snapshot.tasks
      .filter((task) => task.status === "completed")
      .map((task) => task.role),
  );

  const stages = [
    {
      label: "PLAN",
      state: resolveRoleStageState({
        completed:
          completedRoles.has("planner") ||
          (Boolean(run.planMarkdown) && run.currentRole !== "planner") ||
          (run.currentCycle ?? 0) > 0,
        currentRole: run.currentRole,
        currentStatus: run.status,
        role: "planner",
        waitingStatus: "awaiting_plan_approval",
      }),
      detail: `${run.plannerProfile ?? "-"} / ${run.plannerDriver ?? "-"}`,
    },
    {
      label: "EXEC",
      state: resolveRoleStageState({
        completed:
          completedRoles.has("executor") ||
          run.currentRole === "reviewer" ||
          Boolean(
            run.summary && run.summary.trim() && run.currentRole !== "executor",
          ),
        currentRole: run.currentRole,
        currentStatus: run.status,
        role: "executor",
        waitingStatus: "needs_human_input",
      }),
      detail: `${run.executorProfile ?? "-"} / ${run.modelName ?? "-"}`,
    },
    {
      label: "REVIEW",
      state: resolveReviewStageState(run, completedRoles.has("reviewer")),
      detail: `${run.reviewerProfile ?? "-"} / ${run.reviewerDriver ?? "-"}`,
    },
    {
      label: "PUBLISH",
      state: resolvePublishStageState(run.status),
      detail: run.mrUrl ?? run.branchName ?? "-",
    },
  ];

  return stages.map(
    (stage) =>
      `  {${PAL.white}-fg}{bold}${stage.label.padEnd(5, " ")}{/}  ${formatWorkflowStateBadge(stage.state)}  {${PAL.dimWhite}-fg}${stage.detail}{/}`,
  );
}

function resolveRoleStageState(input: {
  completed: boolean;
  currentRole: string | null;
  currentStatus: string;
  role: "planner" | "executor";
  waitingStatus: string;
}) {
  if (input.completed && input.currentRole !== input.role) {
    return "DONE";
  }
  if (
    FAILED_RUN_STATUSES.has(input.currentStatus) &&
    input.currentRole === input.role
  ) {
    return "STOP";
  }
  if (input.currentRole === input.role) {
    if (input.currentStatus === input.waitingStatus) {
      return "HOLD";
    }
    return "LIVE";
  }
  if (input.completed) {
    return "DONE";
  }
  return "WAIT";
}

function resolveReviewStageState(
  run: NonNullable<DashboardSnapshot["selectedRun"]>,
  completed: boolean,
) {
  if (run.status === "success") {
    return "DONE";
  }
  if (run.status === "publish_rejected") {
    return "STOP";
  }
  if (run.status === "awaiting_publish_approval") {
    return "HOLD";
  }
  if (run.currentRole === "reviewer") {
    return FAILED_RUN_STATUSES.has(run.status) ? "STOP" : "LIVE";
  }
  if (completed || Boolean(run.latestReviewSummary)) {
    return "DONE";
  }
  return "WAIT";
}

function resolvePublishStageState(status: string) {
  if (status === "success") {
    return "DONE";
  }
  if (status === "awaiting_publish_approval") {
    return "HOLD";
  }
  if (status === "publish_approved" || status === "publishing") {
    return "LIVE";
  }
  if (FAILED_RUN_STATUSES.has(status)) {
    return "STOP";
  }
  return "WAIT";
}
