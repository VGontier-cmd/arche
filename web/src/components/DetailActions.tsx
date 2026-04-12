import type { DashboardRun } from "../types";

function Kbd({ children }: { children: string }) {
  return (
    <span className="text-[9px] text-[var(--fg3)] ml-1 opacity-60">[{children}]</span>
  );
}

export function DetailActions({
  run,
  onAction,
  onOpenRespond,
  gitlabConfigured,
}: {
  run: DashboardRun;
  onAction: (runId: string, action: string) => void;
  onOpenRespond: (runId: string, title: string) => void;
  gitlabConfigured: boolean;
}) {
  const buttons: React.ReactNode[] = [];

  if (run.status === "awaiting_plan_approval") {
    buttons.push(
      <button
        key="approve-plan"
        className="btn-primary"
        onClick={() => onAction(run.id, "approve-plan")}
      >
        Approve Plan<Kbd>a</Kbd>
      </button>,
    );
    buttons.push(
      <button
        key="request-changes"
        className="btn-default"
        onClick={() =>
          onOpenRespond(run.id, "Request changes to the plan")
        }
      >
        Request Changes
      </button>,
    );
    buttons.push(
      <button
        key="cancel-plan"
        className="btn-danger"
        onClick={() => onAction(run.id, "cancel")}
      >
        Cancel<Kbd>c</Kbd>
      </button>,
    );
  }

  if (run.status === "awaiting_publish_approval") {
    buttons.push(
      <button
        key="approve-publish"
        className="btn-primary"
        onClick={() => onAction(run.id, "approve-publish")}
      >
        Approve Publish<Kbd>a</Kbd>
      </button>,
    );
    buttons.push(
      <button
        key="reject-publish"
        className="btn-danger"
        onClick={() => onAction(run.id, "reject-publish")}
      >
        Reject<Kbd>x</Kbd>
      </button>,
    );
  }

  if (run.status === "needs_human_input") {
    buttons.push(
      <button
        key="respond"
        className="btn-primary"
        onClick={() => onOpenRespond(run.id, "Respond to the run")}
      >
        Respond<Kbd>h</Kbd>
      </button>,
    );
    buttons.push(
      <button
        key="cancel-human"
        className="btn-danger"
        onClick={() => onAction(run.id, "cancel")}
      >
        Cancel<Kbd>c</Kbd>
      </button>,
    );
  }

  if (run.status === "pushed" && gitlabConfigured) {
    buttons.push(
      <button
        key="create-mr"
        className="btn-primary"
        onClick={() => onAction(run.id, "create-mr")}
      >
        Create Merge Request
      </button>,
    );
  }

  if (run.status === "failed") {
    buttons.push(
      <button
        key="retry"
        className="btn-default"
        onClick={() => onAction(run.id, "retry")}
      >
        Retry<Kbd>t</Kbd>
      </button>,
    );
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
        onClick={() => onAction(run.id, "cancel")}
      >
        Cancel<Kbd>c</Kbd>
      </button>,
    );
  }

  const archivableStatuses = ["success", "pushed", "failed", "cancelled", "publish_rejected"];
  if (archivableStatuses.includes(run.status)) {
    buttons.push(
      <button
        key="archive"
        className="btn-default"
        onClick={() => onAction(run.id, "archive")}
      >
        Archive
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
