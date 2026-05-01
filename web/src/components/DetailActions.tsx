import type { DashboardRun } from "../types";
import { Button } from "./ui/Button";
import { Kbd } from "./ui/Kbd";
import { SectionHeading } from "./ui/SectionHeading";

export function DetailActions({
  run,
  onAction,
  onOpenRespond,
  gitlabConfigured,
  githubConfigured,
  pendingAction,
  autoCreateMr,
}: {
  run: DashboardRun;
  onAction: (runId: string, action: string) => void;
  onOpenRespond: (runId: string, title: string) => void;
  gitlabConfigured: boolean;
  githubConfigured: boolean;
  pendingAction?: string | null;
  autoCreateMr?: boolean;
}) {
  const isLoading = (action: string) => pendingAction === action;
  const disabled = pendingAction != null;
  const buttons: React.ReactNode[] = [];

  const withKbd = (label: string, key: string) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {label}
      <Kbd>{key}</Kbd>
    </span>
  );

  if (run.status === "awaiting_plan_approval") {
    buttons.push(
      <Button
        key="approve-plan"
        variant="primary"
        disabled={disabled}
        isLoading={isLoading("approve-plan")}
        onClick={() => onAction(run.id, "approve-plan")}
      >
        {withKbd("Approve Plan", "a")}
      </Button>,
      <Button
        key="request-changes"
        variant="secondary"
        disabled={disabled}
        onClick={() => onOpenRespond(run.id, "Request changes to the plan")}
      >
        Request Changes
      </Button>,
      <Button
        key="cancel-plan"
        variant="danger"
        disabled={disabled}
        isLoading={isLoading("cancel")}
        onClick={() => onAction(run.id, "cancel")}
      >
        {withKbd("Cancel", "c")}
      </Button>,
    );
  }

  if (run.status === "awaiting_publish_approval") {
    buttons.push(
      <Button
        key="approve-publish"
        variant="primary"
        disabled={disabled}
        isLoading={isLoading("approve-publish")}
        onClick={() => onAction(run.id, "approve-publish")}
      >
        {withKbd("Approve Publish", "a")}
      </Button>,
      <Button
        key="reject-publish"
        variant="danger"
        disabled={disabled}
        isLoading={isLoading("reject-publish")}
        onClick={() => onAction(run.id, "reject-publish")}
      >
        {withKbd("Reject", "x")}
      </Button>,
    );
  }

  if (run.status === "needs_human_input") {
    const isReviewerDriven =
      run.currentRole === "executor" &&
      run.pendingQuestion?.includes("Reviewer requested changes") === true;
    const respondTitle = isReviewerDriven
      ? "Provide guidance to resume execution"
      : run.currentRole === "planner"
      ? "Answer planner question"
      : run.currentRole === "reviewer"
      ? "Answer reviewer question"
      : "Respond to the run";
    buttons.push(
      <Button
        key="respond"
        variant="primary"
        disabled={disabled}
        onClick={() => onOpenRespond(run.id, respondTitle)}
      >
        {withKbd(isReviewerDriven ? "Provide Guidance" : "Respond", "h")}
      </Button>,
      <Button
        key="force-approve"
        variant="secondary"
        disabled={disabled}
        isLoading={isLoading("force-approve")}
        onClick={() => onAction(run.id, "force-approve")}
      >
        {withKbd("Force Approve", "f")}
      </Button>,
      <Button
        key="cancel-human"
        variant="danger"
        disabled={disabled}
        isLoading={isLoading("cancel")}
        onClick={() => onAction(run.id, "cancel")}
      >
        {withKbd("Cancel", "c")}
      </Button>,
    );
  }

  if (run.status === "pushed" && !autoCreateMr && (gitlabConfigured || githubConfigured)) {
    buttons.push(
      <Button
        key="create-mr"
        variant="primary"
        disabled={disabled}
        isLoading={isLoading("create-mr")}
        onClick={() => onAction(run.id, "create-mr")}
      >
        {githubConfigured && !gitlabConfigured
          ? "Create Pull Request"
          : "Create Merge Request"}
      </Button>,
    );
  }

  if (run.status === "failed") {
    buttons.push(
      <Button
        key="retry"
        variant="secondary"
        disabled={disabled}
        isLoading={isLoading("retry")}
        onClick={() => onAction(run.id, "retry")}
      >
        {withKbd("Retry (full)", "t")}
      </Button>,
    );
    if (run.planMarkdown) {
      buttons.push(
        <Button
          key="retry-executor"
          variant="secondary"
          disabled={disabled}
          isLoading={isLoading("retry-executor")}
          onClick={() => onAction(run.id, "retry-executor")}
        >
          Re-execute
        </Button>,
      );
    }
  }

  const terminalStatuses = [
    "success",
    "pushed",
    "failed",
    "cancelled",
    "publish_rejected",
    "awaiting_plan_approval",
    "awaiting_publish_approval",
    "needs_human_input",
  ];
  if (!terminalStatuses.includes(run.status)) {
    buttons.push(
      <Button
        key="cancel-active"
        variant="danger"
        disabled={disabled}
        isLoading={isLoading("cancel")}
        onClick={() => onAction(run.id, "cancel")}
      >
        {withKbd("Cancel", "c")}
      </Button>,
    );
  }

  const archivableStatuses = ["success", "pushed", "failed", "cancelled", "publish_rejected"];
  if (archivableStatuses.includes(run.status)) {
    buttons.push(
      <Button
        key="archive"
        variant="ghost"
        disabled={disabled}
        isLoading={isLoading("archive")}
        onClick={() => onAction(run.id, "archive")}
      >
        Archive
      </Button>,
    );
  }

  if (buttons.length === 0) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <SectionHeading>Actions</SectionHeading>
      <div className="flex flex-wrap" style={{ gap: 8 }}>
        {buttons}
      </div>
    </div>
  );
}
