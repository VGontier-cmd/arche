import { useCallback } from "react";

export type FilterState = {
  statuses: Set<string>;
  repository: string; // "" = all
  period: "24h" | "7d" | "30d" | "all";
};

export const EMPTY_FILTERS: FilterState = {
  statuses: new Set(),
  repository: "",
  period: "all",
};

const ALL_STATUSES = [
  { value: "pending",                   label: "Queued",          color: "#8b949e" },
  { value: "awaiting_plan_approval",    label: "Plan ready",      color: "#d29922" },
  { value: "executing",                 label: "Executing…",      color: "#58a6ff" },
  { value: "needs_human_input",         label: "Waiting for you", color: "#d29922" },
  { value: "awaiting_publish_approval", label: "Ready to ship",   color: "#d29922" },
  { value: "success",                   label: "Success",         color: "#3fb950" },
  { value: "pushed",                    label: "Shipped",         color: "#3fb950" },
  { value: "failed",                    label: "Failed",          color: "#f85149" },
  { value: "cancelled",                 label: "Cancelled",       color: "#8b949e" },
];

const PERIODS: Array<{ value: FilterState["period"]; label: string }> = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All" },
];

export function hasActiveFilters(filters: FilterState): boolean {
  return filters.statuses.size > 0 || filters.repository !== "" || filters.period !== "all";
}

export function SidebarFilters({
  filters,
  onChange,
  repositories,
}: {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  repositories: string[];
}) {
  const toggleStatus = useCallback(
    (status: string) => {
      const next = new Set(filters.statuses);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      onChange({ ...filters, statuses: next });
    },
    [filters, onChange],
  );

  const clearAll = useCallback(() => {
    onChange(EMPTY_FILTERS);
  }, [onChange]);

  return (
    <div className="px-3 py-2 border-b border-[var(--border-color)] flex flex-col gap-2">
      {/* Status filters */}
      <div>
        <span className="text-[10px] text-[var(--fg3)] uppercase tracking-wide">Status</span>
        <div className="flex flex-wrap gap-1 mt-1">
          {ALL_STATUSES.map((s) => {
            const active = filters.statuses.has(s.value);
            return (
              <button
                key={s.value}
                onClick={() => toggleStatus(s.value)}
                className="px-1.5 py-0.5 rounded text-[10px] transition-colors border"
                style={{
                  borderColor: active ? s.color : "var(--border-color)",
                  backgroundColor: active ? `${s.color}20` : "transparent",
                  color: active ? s.color : "var(--fg3)",
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Repository filter */}
      {repositories.length > 1 && (
        <div>
          <span className="text-[10px] text-[var(--fg3)] uppercase tracking-wide">Repository</span>
          <select
            value={filters.repository}
            onChange={(e) => onChange({ ...filters, repository: e.target.value })}
            className="mt-1 w-full bg-[var(--color-base-100)] border border-[var(--border-color)] rounded-[var(--rounded-box)] text-[var(--color-base-content)] px-2 py-1 text-[11px] font-[inherit] outline-none focus:border-[#58a6ff]"
          >
            <option value="">All repositories</option>
            {repositories.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      )}

      {/* Period filter */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-[var(--fg3)] uppercase tracking-wide mr-1">Period</span>
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => onChange({ ...filters, period: p.value })}
            className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
              filters.period === p.value
                ? "bg-[#58a6ff20] text-[#58a6ff] border border-[#58a6ff]"
                : "text-[var(--fg3)] border border-[var(--border-color)] hover:text-[var(--fg2)]"
            }`}
          >
            {p.label}
          </button>
        ))}
        {hasActiveFilters(filters) && (
          <button
            onClick={clearAll}
            className="ml-auto text-[10px] text-[var(--fg3)] hover:text-[#f85149] transition-colors"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
