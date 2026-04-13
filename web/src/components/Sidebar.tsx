import { forwardRef, useMemo, useState } from "react";
import type { DashboardRun, DashboardWorker } from "../types";
import { RunItem } from "./RunItem";
import { SidebarFilters, EMPTY_FILTERS, hasActiveFilters, type FilterState } from "./SidebarFilters";

type Section = {
  title: string;
  runs: DashboardRun[];
};

function filterRuns(runs: DashboardRun[], query: string, filters: FilterState): DashboardRun[] {
  let result = runs;

  if (query) {
    const q = query.toLowerCase();
    result = result.filter((r) =>
      [r.ticketKey, r.ticketTitle, r.repoName].some((f) => f?.toLowerCase().includes(q)),
    );
  }

  if (filters.statuses.size > 0) {
    result = result.filter((r) => filters.statuses.has(r.status));
  }

  if (filters.repository) {
    result = result.filter((r) => r.repoName === filters.repository);
  }

  if (filters.period !== "all") {
    const now = Date.now();
    const ms = filters.period === "24h" ? 86_400_000 : filters.period === "7d" ? 604_800_000 : 2_592_000_000;
    const cutoff = now - ms;
    result = result.filter((r) => {
      const t = r.createdAt ? new Date(r.createdAt).getTime() : 0;
      return t >= cutoff;
    });
  }

  return result;
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
  workers?: DashboardWorker[];
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
  workers = [],
}, searchRef) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const isFiltered = search !== "" || hasActiveFilters(filters);

  const emptyMessages: Record<string, string> = {
    Inbox: isFiltered ? "No matches" : "All caught up",
    Active: isFiltered ? "No matches" : "",
    Recent: isFiltered ? "No matches" : "",
  };

  // Map runId → worker step for active runs
  const workerStepByRunId = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const w of workers) {
      if (w.currentRunId) map.set(w.currentRunId, w.currentStep);
    }
    return map;
  }, [workers]);

  const repositories = useMemo(() => {
    const names = new Set<string>();
    for (const r of [...inboxRuns, ...activeRuns, ...recentRuns]) {
      if (r.repoName) names.add(r.repoName);
    }
    return [...names].sort();
  }, [inboxRuns, activeRuns, recentRuns]);

  const sections: Section[] = useMemo(() => [
    { title: "Inbox", runs: filterRuns(inboxRuns, search, filters) },
    { title: "Active", runs: filterRuns(activeRuns, search, filters) },
    { title: "Recent", runs: filterRuns(recentRuns, search, filters) },
  ], [inboxRuns, activeRuns, recentRuns, search, filters]);

  const checkedCount = checkedRunIds?.size ?? 0;
  const allInboxChecked = inboxRuns.length > 0 && inboxRuns.every((r) => checkedRunIds?.has(r.id));

  return (
    <div className="w-full lg:w-[380px] lg:min-w-[300px] border-b lg:border-b-0 lg:border-r border-[var(--border-color)] overflow-y-auto lg:max-h-full max-h-[40vh] shrink-0">
      <div className="px-3 py-2 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-1.5">
          <input
            ref={searchRef}
            type="text"
            placeholder="Search runs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-[var(--color-base-100)] border border-[var(--border-color)] rounded-[var(--rounded-box)] text-[var(--color-base-content)] px-2.5 py-1.5 text-xs font-[inherit] placeholder:text-[var(--fg3)] outline-none focus:border-[#58a6ff]"
          />
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className={`shrink-0 px-2 py-1.5 rounded-[var(--rounded-box)] border text-[11px] transition-colors ${
              hasActiveFilters(filters)
                ? "border-[#58a6ff] bg-[#58a6ff20] text-[#58a6ff]"
                : filtersOpen
                  ? "border-[var(--border-color)] bg-[var(--color-base-300)] text-[var(--color-base-content)]"
                  : "border-[var(--border-color)] text-[var(--fg3)] hover:text-[var(--fg2)]"
            }`}
            title="Toggle filters"
          >
            {hasActiveFilters(filters) ? `Filters (${filters.statuses.size + (filters.repository ? 1 : 0) + (filters.period !== "all" ? 1 : 0)})` : "Filters"}
          </button>
        </div>
      </div>

      {filtersOpen && (
        <SidebarFilters
          filters={filters}
          onChange={setFilters}
          repositories={repositories}
        />
      )}

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

      {sections.map((section) => {
        const empty = section.runs.length === 0;
        const emptyMsg = emptyMessages[section.title];
        // Hide Active/Recent when empty and not filtered
        if (empty && !emptyMsg) return null;

        return (
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
            {empty ? (
              <div className="text-[var(--fg3)] text-center py-4 text-xs flex flex-col items-center gap-1">
                {emptyMsg}
                {isFiltered && section.title === "Inbox" && (
                  <button
                    className="text-[#58a6ff] hover:underline text-[10px]"
                    onClick={() => { setSearch(""); setFilters(EMPTY_FILTERS); }}
                  >
                    Clear filters
                  </button>
                )}
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
                  workerStep={workerStepByRunId.get(run.id)}
                />
              ))
            )}
          </div>
        );
      })}
    </div>
  );
});
