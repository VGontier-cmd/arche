import { Text } from "ink";
import { Fragment } from "react";
import type { ReactNode } from "react";

import type { DashboardSnapshot } from "../snapshot";

import { FAILED_RUN_STATUSES, PAL, SUCCESS_RUN_STATUS } from "./theme";
import {
  formatWorkflowStateBadgeInk,
  tDimWhiteInk,
  tItalicGreyInk,
} from "./ink-styled";
import { truncateUnicode } from "./text-format";
import { formatTimestamp } from "./tui-helpers";

export function timelineSourceTagInk(
  source: DashboardSnapshot["timeline"][number]["source"],
): ReactNode {
  if (source === "event") {
    return (
      <Text color={PAL.active} bold>
        [event]
      </Text>
    );
  }
  if (source === "log" || source === "message") {
    return <Text color={PAL.grey}>[log]</Text>;
  }
  return <Text color={PAL.branchBlue}>[system]</Text>;
}

export function renderTimelinePaneInk(
  snapshot: DashboardSnapshot,
  maxWidth: number,
  scrollOffset: number,
  maxLines: number,
) {
  if (snapshot.timeline.length === 0) {
    return <Text color={PAL.dimWhite}>No timeline entries for the selected run.</Text>;
  }

  const inner = Math.max(8, maxWidth - 4);
  const rows: ReactNode[] = [];

  for (const item of snapshot.timeline) {
    const ts = tItalicGreyInk(formatTimestamp(item.timestamp));
    const tag = timelineSourceTagInk(item.source);
    const titlePlain = item.title;
    const headPlainLen =
      formatTimestamp(item.timestamp).length +
      1 +
      (item.source === "event" ? 7 : item.source === "log" || item.source === "message" ? 5 : 8) +
      1;
    const titleBudget = Math.max(8, inner - headPlainLen);
    rows.push(
      <Text key={`${item.timestamp}-${titlePlain}-h`}>
        {ts} {tag}{" "}
        <Text color={PAL.white}>{truncateUnicode(titlePlain, titleBudget)}</Text>
      </Text>,
    );

    if (item.detail) {
      rows.push(
        <Text key={`${item.timestamp}-${titlePlain}-d`}>
          {"  "}
          {tDimWhiteInk(truncateUnicode(item.detail, inner - 2, "…"))}
        </Text>,
      );
    }
  }

  const window = rows.slice(scrollOffset, scrollOffset + Math.max(1, maxLines));
  return (
    <Fragment>
      {window.map((row, i) => (
        <Fragment key={i}>{row}</Fragment>
      ))}
    </Fragment>
  );
}

export function renderWorkflowLaneInk(snapshot: DashboardSnapshot): ReactNode[] {
  const run = snapshot.selectedRun;
  if (!run) {
    return [<Text key="n"> {tDimWhiteInk("No run selected.")}</Text>];
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
        role: "planner" as const,
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
        role: "executor" as const,
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

  return stages.map((stage) => (
    <Text key={stage.label}>
      {"  "}
      <Text bold color={PAL.white}>
        {stage.label.padEnd(5, " ")}
      </Text>{" "}
      {formatWorkflowStateBadgeInk(stage.state)}
      <Text color={PAL.dimWhite}> {stage.detail}</Text>
    </Text>
  ));
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

export function runSectionIconInk(
  kind: "inbox" | "active" | "recent",
  status: string,
): ReactNode {
  if (kind === "inbox") {
    return <Text color={PAL.inbox}>·</Text>;
  }
  if (kind === "active") {
    return (
      <Text color={PAL.active} bold>
        ⟳
      </Text>
    );
  }
  if (status === SUCCESS_RUN_STATUS) {
    return <Text color={PAL.done}>✓</Text>;
  }
  if (FAILED_RUN_STATUSES.has(status)) {
    return (
      <Text color={PAL.failedFg} bold>
        ✗
      </Text>
    );
  }
  return <Text color={PAL.grey}>·</Text>;
}
