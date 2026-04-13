import type { DashboardRun } from "../types";

function Kbd({ children }: { children: string }) {
  return (
    <span className="text-[9px] text-[var(--fg3)] ml-1 opacity-60">[{children}]</span>
  );
}

function Spinner() {
  return (
    <span className="inline-block w-3 h-3 border border-current border-t-transparent rounded-full animate-spin ml-1" />
  );
}

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

  if (run.status === "awaiting_plan_approval") {
    buttons.push(
      <button
        key="approve-plan"
        className="btn-primary"
        disabled={disabled}
        onClick={() => onAction(run.id, "approve-plan")}
      >
        Approve Plan{isLoading("approve-plan") ? <Spinner /> : <Kbd>a</Kbd>}
      </button>,
    );
    buttons.push(
      <button
        key="request-changes"
        className="btn-default"
        disabled={disabled}
        onClick={() => onOpenRespond(run.id, "Request changes to the plan")}
      >
        Request Changes
      </button>,
    );
    buttons.push(
      <button
        key="cancel-plan"
        className="btn-danger"
        disabled={disabled}
        onClick={() => onAction(run.id, "cancel")}
      >
        Cancel{isLoading("cancel") ? <Spinner /> : <Kbd>c</Kbd>}
      </button>,
    );
  }

  if (run.status === "awaiting_publish_approval") {
    buttons.push(
      <button
        key="approve-publish"
        className="btn-primary"
        disabled={disabled}
        onClick={() => onAction(run.id, "approve-publish")}
      >
        Approve Publish{isLoading("approve-publish") ? <Spinner /> : <Kbd>a</Kbd>}
      </button>,
    );
    buttons.push(
      <button
        key="reject-publish"
        className="btn-danger"
        disabled={disabled}
        onClick={() => onAction(run.id, "reject-publish")}
      >
        Reject{isLoading("reject-publish") ? <Spinner /> : <Kbd>x</Kbd>}
      </button>,
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
      <button
        key="respond"
        className="btn-primary"
        disabled={disabled}
        onClick={() => onOpenRespond(run.id, respondTitle)}
      >
        {isReviewerDriven ? "Provide Guidance" : "Respond"}<Kbd>h</Kbd>
      </button>,
    );
    buttons.push(
      <button
        key="force-approve"
        className="btn-default"
        disabled={disabled}
        onClick={() => onAction(run.id, "force-approve")}
      >
        Force Approve{isLoading("force-approve") ? <Spinner /> : <Kbd>f</Kbd>}
      </button>,
    );
    buttons.push(
      <button
        key="cancel-human"
        className="btn-danger"
        disabled={disabled}
        onClick={() => onAction(run.id, "cancel")}
      >
        Cancel{isLoading("cancel") ? <Spinner /> : <Kbd>c</Kbd>}
      </button>,
    );
  }

  if (run.status === "pushed" && !autoCreateMr && (gitlabConfigured || githubConfigured)) {
    buttons.push(
      <button
        key="create-mr"
        className="btn-primary"
        disabled={disabled}
        onClick={() => onAction(run.id, "create-mr")}
      >
        {githubConfigured && !gitlabConfigured ? "Create Pull Request" : "Create Merge Request"}
        {isLoading("create-mr") && <Spinner />}
      </button>,
    );
  }

  if (run.status === "failed") {
    buttons.push(
      <button
        key="retry"
        className="btn-default"
        disabled={disabled}
        onClick={() => onAction(run.id, "retry")}
      >
        Retry (full){isLoading("retry") ? <Spinner /> : <Kbd>t</Kbd>}
      </button>,
    );
    if (run.planMarkdown) {
      buttons.push(
        <button
          key="retry-executor"
          className="btn-default"
          disabled={disabled}
          onClick={() => onAction(run.id, "retry-executor")}
        >
          Re-execute{isLoading("retry-executor") && <Spinner />}
        </button>,
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
      <button
        key="cancel-active"
        className="btn-danger"
        disabled={disabled}
        onClick={() => onAction(run.id, "cancel")}
      >
        Cancel{isLoading("cancel") ? <Spinner /> : <Kbd>c</Kbd>}
      </button>,
    );
  }

  const archivableStatuses = ["success", "pushed", "failed", "cancelled", "publish_rejected"];
  if (archivableStatuses.includes(run.status)) {
    buttons.push(
      <button
        key="archive"
        className="btn-default"
        disabled={disabled}
        onClick={() => onAction(run.id, "archive")}
      >
        Archive{isLoading("archive") && <Spinner />}
      </button>,
    );
  }

  if (buttons.length === 0) return null;

  return (
    <div className="mb-5">
      <h3 className="text-[11px] font-semibold text-[var(--fg2)] uppercase tracking-wide mb-2">
        Actions
      </h3>
      <div className="flex gap-2 flex-wrap">{buttons}</div>
    </div>
  );
}
