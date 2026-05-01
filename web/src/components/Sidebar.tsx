import { forwardRef, useMemo, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import type { DashboardRun, DashboardWorker } from "../types";
import { RunItem } from "./RunItem";
import {
  SidebarFilters,
  EMPTY_FILTERS,
  hasActiveFilters,
  type FilterState,
} from "./SidebarFilters";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";

type Section = {
  title: string;
  runs: DashboardRun[];
};

function filterRuns(
  runs: DashboardRun[],
  query: string,
  filters: FilterState,
): DashboardRun[] {
  let result = runs;

  if (query) {
    const q = query.toLowerCase();
    result = result.filter((r) =>
      [r.ticketKey, r.ticketTitle, r.repoName].some((f) =>
        f?.toLowerCase().includes(q),
      ),
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
    const ms =
      filters.period === "24h"
        ? 86_400_000
        : filters.period === "7d"
        ? 604_800_000
        : 2_592_000_000;
    const cutoff = now - ms;
    result = result.filter((r) => {
      const t = r.createdAt ? new Date(r.createdAt).getTime() : 0;
      return t >= cutoff;
    });
  }

  return result;
}

export const Sidebar = forwardRef<
  HTMLInputElement,
  {
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
  }
>(function Sidebar(
  {
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
  },
  searchRef,
) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const isFiltered = search !== "" || hasActiveFilters(filters);

  const emptyMessages: Record<string, string> = {
    Inbox: isFiltered ? "No matches" : "All caught up",
    Active: isFiltered ? "No matches" : "",
    Recent: isFiltered ? "No matches" : "",
  };

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

  const sections: Section[] = useMemo(
    () => [
      { title: "Inbox", runs: filterRuns(inboxRuns, search, filters) },
      { title: "Active", runs: filterRuns(activeRuns, search, filters) },
      { title: "Recent", runs: filterRuns(recentRuns, search, filters) },
    ],
    [inboxRuns, activeRuns, recentRuns, search, filters],
  );

  const checkedCount = checkedRunIds?.size ?? 0;
  const allInboxChecked =
    inboxRuns.length > 0 && inboxRuns.every((r) => checkedRunIds?.has(r.id));
  const filterCount =
    filters.statuses.size +
    (filters.repository ? 1 : 0) +
    (filters.period !== "all" ? 1 : 0);

  return (
    <div
      className="w-full lg:w-[380px] lg:min-w-[300px] overflow-y-auto lg:max-h-full max-h-[40vh] shrink-0"
      style={{
        borderBottom: "1px solid var(--hairline)",
        background: "var(--surface-0)",
      }}
    >
      <div
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid var(--hairline)",
          background: "var(--surface-1)",
          position: "sticky",
          top: 0,
          zIndex: 1,
        }}
      >
        <div className="flex items-center" style={{ gap: 6 }}>
          <Input
            ref={searchRef}
            type="search"
            name="run-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search runs…"
            leftIcon={<Search size={12} strokeWidth={2} />}
            aria-label="Search runs"
            spellCheck={false}
            autoComplete="off"
          />
          <Button
            size="sm"
            variant={hasActiveFilters(filters) ? "primary" : filtersOpen ? "secondary" : "ghost"}
            leftIcon={<SlidersHorizontal size={12} strokeWidth={2} />}
            onClick={() => setFiltersOpen((v) => !v)}
            aria-pressed={filtersOpen}
            aria-label={
              filterCount > 0
                ? `Filters, ${filterCount} active`
                : "Toggle filters"
            }
            title="Toggle filters"
          >
            {filterCount > 0 ? `Filters · ${filterCount}` : "Filters"}
          </Button>
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
        <div
          className="flex items-center"
          style={{
            gap: 8,
            padding: "10px 14px",
            background: "var(--surface-2)",
            borderBottom: "1px solid var(--hairline)",
            fontSize: "var(--text-body-sm)",
          }}
        >
          <span style={{ color: "var(--c-fog-300)" }}>
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                color: "var(--c-blue-200)",
              }}
            >
              {checkedCount}
            </span>{" "}
            selected
          </span>
          <Button
            size="xs"
            variant="primary"
            onClick={() => onBulkAction("approve-plan")}
          >
            Approve All
          </Button>
          <Button
            size="xs"
            variant="danger"
            onClick={() => onBulkAction("cancel")}
          >
            Cancel All
          </Button>
        </div>
      )}

      {sections.map((section) => {
        const empty = section.runs.length === 0;
        const emptyMsg = emptyMessages[section.title];
        if (empty && !emptyMsg) return null;

        return (
          <div key={section.title}>
            <div
              className="flex items-center"
              style={{
                gap: 8,
                padding: "12px 16px 6px",
                borderBottom: "1px solid var(--hairline)",
                background: "var(--surface-1)",
              }}
            >
              {section.title === "Inbox" &&
                onCheckAllInbox &&
                section.runs.length > 0 && (
                  <input
                    type="checkbox"
                    checked={allInboxChecked}
                    onChange={(e) => onCheckAllInbox(e.target.checked)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Select all inbox runs"
                    style={{
                      accentColor: "var(--c-blue-400)",
                      cursor: "pointer",
                    }}
                  />
                )}
              <span
                style={{
                  fontSize: "var(--text-label-md)",
                  fontWeight: 700,
                  color: "var(--c-fog-300)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {section.title}
                <Badge tone="neutral" size="sm">
                  {section.runs.length}
                </Badge>
              </span>
            </div>
            {empty ? (
              <div
                style={{
                  padding: "16px 12px",
                  fontSize: "var(--text-body-sm)",
                  color: "var(--c-steel-300)",
                  textAlign: "center",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {emptyMsg}
                {isFiltered && section.title === "Inbox" && (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      setSearch("");
                      setFilters(EMPTY_FILTERS);
                    }}
                  >
                    Clear filters
                  </Button>
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
                  onToggleCheck={
                    section.title === "Inbox" ? onToggleCheck : undefined
                  }
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
