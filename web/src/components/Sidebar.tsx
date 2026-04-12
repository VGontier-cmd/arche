import type { DashboardRun } from "../types";
import { RunItem } from "./RunItem";

type Section = {
  title: string;
  runs: DashboardRun[];
};

export function Sidebar({
  inboxRuns,
  activeRuns,
  recentRuns,
  selectedRunId,
  onSelectRun,
}: {
  inboxRuns: DashboardRun[];
  activeRuns: DashboardRun[];
  recentRuns: DashboardRun[];
  selectedRunId: string | null;
  onSelectRun: (id: string) => void;
}) {
  const sections: Section[] = [
    { title: "Inbox", runs: inboxRuns },
    { title: "Active", runs: activeRuns },
    { title: "Recent", runs: recentRuns },
  ].filter((s) => s.runs.length > 0);

  if (sections.length === 0) {
    return (
      <div className="w-[380px] min-w-[300px] border-r border-[var(--border-color)] overflow-y-auto">
        <div className="text-[var(--fg3)] p-5 text-center">No runs</div>
      </div>
    );
  }

  return (
    <div className="w-[380px] min-w-[300px] border-r border-[var(--border-color)] overflow-y-auto">
      {sections.map((section) => (
        <div key={section.title}>
          <div className="text-[11px] font-semibold text-[var(--fg2)] uppercase tracking-wide px-4 py-3 pb-1 border-b border-[var(--border-color)]">
            {section.title} ({section.runs.length})
          </div>
          {section.runs.map((run) => (
            <RunItem
              key={run.id}
              run={run}
              selected={run.id === selectedRunId}
              onSelect={onSelectRun}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
