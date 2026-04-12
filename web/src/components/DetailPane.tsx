import type { DashboardRun, DashboardSnapshot } from "../types";
import { StatusBadge } from "./StatusBadge";
import { DetailMeta } from "./DetailMeta";
import { DetailActions } from "./DetailActions";
import { DetailPlan } from "./DetailPlan";
import { DetailPendingQuestion } from "./DetailPendingQuestion";
import { TasksList } from "./TasksList";
import { Timeline } from "./Timeline";

export function DetailPane({
  snapshot,
  onAction,
  onOpenRespond,
}: {
  snapshot: DashboardSnapshot;
  onAction: (runId: string, action: string) => void;
  onOpenRespond: (runId: string, title: string) => void;
}) {
  const run: DashboardRun | null = snapshot.selectedRun;

  if (!run) {
    return (
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="text-[var(--fg3)] p-5 text-center">
          Select a run to view details
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      <h2 className="text-sm mb-3 text-[var(--color-base-content)]">
        <StatusBadge status={run.status} />{" "}
        {run.ticketKey}: {run.ticketTitle || ""}
      </h2>

      <DetailMeta run={run} />
      <DetailActions
        run={run}
        onAction={onAction}
        onOpenRespond={onOpenRespond}
        gitlabConfigured={snapshot.credentialEnv.gitlab}
      />
      <DetailPlan planMarkdown={run.planMarkdown} />
      <DetailPendingQuestion pendingQuestion={run.pendingQuestion} />
      <TasksList tasks={snapshot.tasks} />
      <Timeline timeline={snapshot.timeline} />
    </div>
  );
}
