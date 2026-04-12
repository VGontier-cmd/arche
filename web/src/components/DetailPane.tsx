import type { DashboardRun, DashboardSnapshot } from "../types";
import { StatusBadge } from "./StatusBadge";
import { DetailMeta } from "./DetailMeta";
import { DetailActions } from "./DetailActions";
import { DetailPlan } from "./DetailPlan";
import { DiffViewer } from "./DiffViewer";
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

      <DetailMeta run={run} jiraBaseUrl={snapshot.jiraBaseUrl} />
      <DetailActions
        run={run}
        onAction={onAction}
        onOpenRespond={onOpenRespond}
        gitlabConfigured={snapshot.credentialEnv.gitlab}
      />
      {run.mrUrl && (
        <div className="mb-5">
          <a
            href={run.mrUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--rounded-box)] bg-[#238636] text-white hover:bg-[#2ea043] transition-colors"
          >
            View Merge Request &#8599;
          </a>
        </div>
      )}
      <DetailPlan planMarkdown={run.planMarkdown} />
      <DiffViewer diffExcerpt={run.diffExcerpt} />
      <DetailPendingQuestion pendingQuestion={run.pendingQuestion} />
      <TasksList tasks={snapshot.tasks} />
      <Timeline timeline={snapshot.timeline} timelineTotal={snapshot.timelineTotal} runId={snapshot.selectedRunId} />
    </div>
  );
}
