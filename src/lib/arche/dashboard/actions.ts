import {
  approvePlan,
  approvePublish,
  cancelRun,
  rejectPublish,
  respondToRun,
  retryRun,
} from "../runs";

export const DASHBOARD_ACTION_KINDS = [
  "approve_plan",
  "approve_publish",
  "reject_publish",
  "respond",
  "retry",
  "cancel",
] as const;

export type DashboardActionKind = (typeof DASHBOARD_ACTION_KINDS)[number];

export type DashboardActionableRun = {
  id: string;
  ticketKey: string;
  status: string;
  pendingQuestion?: string | null;
};

export type DashboardActionDescriptor = {
  kind: DashboardActionKind;
  label: string;
  hotkey: string;
  confirmationTitle?: string;
  confirmationBody?: string;
};

export type DashboardActionResult = {
  selectedRunId: string;
  message: string;
};

const TERMINAL_RETRY_STATUSES = new Set(["failed", "cancelled", "publish_rejected"]);
const CANCELABLE_STATUSES = new Set([
  "pending",
  "planning",
  "awaiting_plan_approval",
  "executing",
  "reviewing",
  "needs_human_input",
  "awaiting_publish_approval",
  "publish_approved",
  "publishing",
]);

export function getContextualApproveAction(
  run: DashboardActionableRun | null | undefined,
): DashboardActionKind | null {
  if (!run) return null;
  if (run.status === "awaiting_plan_approval") {
    return "approve_plan";
  }
  if (run.status === "awaiting_publish_approval") {
    return "approve_publish";
  }
  return null;
}

export function listAvailableDashboardActions(run: DashboardActionableRun | null | undefined) {
  if (!run) {
    return [];
  }

  const actions: DashboardActionDescriptor[] = [];
  const contextualApprove = getContextualApproveAction(run);
  if (contextualApprove) {
    actions.push(buildActionDescriptor(run, contextualApprove));
  }
  if (run.status === "needs_human_input") {
    actions.push(buildActionDescriptor(run, "respond"));
  }
  if (run.status === "awaiting_publish_approval") {
    actions.push(buildActionDescriptor(run, "reject_publish"));
  }
  if (TERMINAL_RETRY_STATUSES.has(run.status)) {
    actions.push(buildActionDescriptor(run, "retry"));
  }
  if (CANCELABLE_STATUSES.has(run.status)) {
    actions.push(buildActionDescriptor(run, "cancel"));
  }

  return actions;
}

export function buildActionDescriptor(
  run: DashboardActionableRun,
  kind: DashboardActionKind,
): DashboardActionDescriptor {
  if (kind === "approve_plan") {
    return {
      kind,
      label: "Approve plan",
      hotkey: "a",
      confirmationTitle: `Approve plan for ${run.ticketKey}?`,
      confirmationBody: "This queues the run for executor work.",
    };
  }
  if (kind === "approve_publish") {
    return {
      kind,
      label: "Approve publish",
      hotkey: "a",
      confirmationTitle: `Approve publish for ${run.ticketKey}?`,
      confirmationBody: "This queues the run for commit and push. You can create a MR afterwards.",
    };
  }
  if (kind === "reject_publish") {
    return {
      kind,
      label: "Reject publish",
      hotkey: "x",
      confirmationTitle: `Reject publish for ${run.ticketKey}?`,
      confirmationBody: "The worktree stays retained for inspection and nothing is published.",
    };
  }
  if (kind === "respond") {
    return {
      kind,
      label: "Reply",
      hotkey: "h",
    };
  }
  if (kind === "retry") {
    return {
      kind,
      label: "Retry",
      hotkey: "t",
      confirmationTitle: `Retry ${run.ticketKey}?`,
      confirmationBody: "This creates a new run from the same ticket payload.",
    };
  }
  return {
    kind,
    label: "Cancel",
    hotkey: "c",
    confirmationTitle: `Cancel ${run.ticketKey}?`,
    confirmationBody: "This stops the current run or marks it for cancellation.",
  };
}

export async function executeDashboardAction(input: {
  kind: DashboardActionKind;
  runId: string;
  message?: string;
}): Promise<DashboardActionResult> {
  if (input.kind === "approve_plan") {
    const run = await approvePlan(input.runId);
    return {
      selectedRunId: run.id,
      message: `Plan approved for ${run.ticketKey}.`,
    };
  }
  if (input.kind === "approve_publish") {
    const run = await approvePublish(input.runId);
    return {
      selectedRunId: run.id,
      message: `Publish approved for ${run.ticketKey}.`,
    };
  }
  if (input.kind === "reject_publish") {
    const run = await rejectPublish(input.runId);
    return {
      selectedRunId: run.id,
      message: `Publish rejected for ${run.ticketKey}.`,
    };
  }
  if (input.kind === "respond") {
    const run = await respondToRun(input.runId, input.message ?? "");
    return {
      selectedRunId: run.id,
      message: `Human response saved for ${run.ticketKey}.`,
    };
  }
  if (input.kind === "retry") {
    const run = await retryRun(input.runId);
    return {
      selectedRunId: run.id,
      message: `Retry created for ${run.ticketKey}.`,
    };
  }
  const run = await cancelRun(input.runId);
  return {
    selectedRunId: run.id,
    message: `Cancellation requested for ${run.ticketKey}.`,
  };
}
