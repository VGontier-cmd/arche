import { forwardRef, useMemo, useState } from "react";
import type { DashboardRun } from "../types";
import { RunItem } from "./RunItem";

type Section = {
  title: string;
  runs: DashboardRun[];
};

function filterRuns(runs: DashboardRun[], query: string): DashboardRun[] {
  if (!query) return runs;
  const q = query.toLowerCase();
  return runs.filter((r) =>
    [r.ticketKey, r.ticketTitle, r.repoName].some((f) => f?.toLowerCase().includes(q)),
  );
}

export const Sidebar = forwardRef<HTMLInputElement, {
  inboxRuns: DashboardRun[];
  activeRuns: DashboardRun[];
  recentRuns: DashboardRun[];
  selectedRunId: string | null;
  onSelectRun: (id: string) => void;
  jiraBaseUrl?: string | null;
  checkedRunIds?: Set<string>;
  onToggleCheck?: (id: string) => void;
  onCheckAllInbox?: (checked: boolean) => void;
  onBulkAction?: (action: string) => void;
}>(function Sidebar({
  inboxRuns,
  activeRuns,
  recentRuns,
  selectedRunId,
  onSelectRun,
  jiraBaseUrl,
  checkedRunIds,
  onToggleCheck,
  onCheckAllInbox,
  onBulkAction,
}, searchRef) {
  const [search, setSearch] = useState("");

  const emptyMessages: Record<string, string> = {
    Inbox: "All caught up",
    Active: "No active runs",
    Recent: "No recent runs",
  };

  const sections: Section[] = useMemo(() => [
    { title: "Inbox", runs: filterRuns(inboxRuns, search) },
    { title: "Active", runs: filterRuns(activeRuns, search) },
    { title: "Recent", runs: filterRuns(recentRuns, search) },
  ], [inboxRuns, activeRuns, recentRuns, search]);

  const checkedCount = checkedRunIds?.size ?? 0;
  const allInboxChecked = inboxRuns.length > 0 && inboxRuns.every((r) => checkedRunIds?.has(r.id));

  return (
    <div className="w-full lg:w-[380px] lg:min-w-[300px] border-b lg:border-b-0 lg:border-r border-[var(--border-color)] overflow-y-auto lg:max-h-full max-h-[40vh] shrink-0">
      <div className="px-3 py-2 border-b border-[var(--border-color)]">
        <input
          ref={searchRef}
          type="text"
          placeholder="Search runs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-[var(--color-base-100)] border border-[var(--border-color)] rounded-[var(--rounded-box)] text-[var(--color-base-content)] px-2.5 py-1.5 text-xs font-[inherit] placeholder:text-[var(--fg3)] outline-none focus:border-[#58a6ff]"
        />
      </div>

      {checkedCount > 0 && onBulkAction && (
        <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-base-300)] border-b border-[var(--border-color)] text-xs">
          <span className="text-[var(--fg2)]">{checkedCount} selected</span>
          <button className="btn-primary" style={{ padding: "3px 10px", fontSize: "11px" }} onClick={() => onBulkAction("approve-plan")}>
            Approve All
          </button>
          <button className="btn-danger" style={{ padding: "3px 10px", fontSize: "11px" }} onClick={() => onBulkAction("cancel")}>
            Cancel All
          </button>
        </div>
      )}

      {sections.map((section) => (
        <div key={section.title}>
          <div className="flex items-center gap-2 text-[11px] font-semibold text-[var(--fg2)] uppercase tracking-wide px-4 py-3 pb-1 border-b border-[var(--border-color)]">
            {section.title === "Inbox" && onCheckAllInbox && section.runs.length > 0 && (
              <input
                type="checkbox"
                checked={allInboxChecked}
                onChange={(e) => onCheckAllInbox(e.target.checked)}
                className="accent-[#58a6ff] cursor-pointer"
                onClick={(e) => e.stopPropagation()}
              />
            )}
            <span>{section.title} ({section.runs.length})</span>
          </div>
          {section.runs.length === 0 ? (
            <div className="text-[var(--fg3)] text-center py-4 text-xs">
              {emptyMessages[section.title]}
            </div>
          ) : (
            section.runs.map((run) => (
              <RunItem
                key={run.id}
                run={run}
                selected={run.id === selectedRunId}
                onSelect={onSelectRun}
                jiraBaseUrl={jiraBaseUrl}
                isChecked={checkedRunIds?.has(run.id)}
                onToggleCheck={section.title === "Inbox" ? onToggleCheck : undefined}
              />
            ))
          )}
        </div>
      ))}
    </div>
  );
});
