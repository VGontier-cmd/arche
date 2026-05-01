import { useCallback } from "react";
import { Button } from "./ui/Button";
import { ALL_STATUS_KEYS, statusMeta } from "./ui/tokens";

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

// Surface only the statuses operators actually filter on. The full list
// (including transient running phases) is in tokens.ts; here we promote a
// curated subset and rely on `statusMeta()` to render them consistently.
const FILTERABLE_STATUSES: ReadonlyArray<(typeof ALL_STATUS_KEYS)[number]> = [
  "pending",
  "awaiting_plan_approval",
  "executing",
  "needs_human_input",
  "awaiting_publish_approval",
  "success",
  "pushed",
  "failed",
  "cancelled",
];

const PERIODS: Array<{ value: FilterState["period"]; label: string }> = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All" },
];

export function hasActiveFilters(filters: FilterState): boolean {
  return (
    filters.statuses.size > 0 ||
    filters.repository !== "" ||
    filters.period !== "all"
  );
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
    <div
      style={{
        padding: "10px 12px",
        borderBottom: "1px solid var(--hairline)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "var(--surface-1)",
      }}
    >
      {/* Status filters — derived from the same token map as StatusPill */}
      <FieldGroup label="Status">
        <div className="flex flex-wrap" style={{ gap: 4 }}>
          {FILTERABLE_STATUSES.map((key) => {
            const active = filters.statuses.has(key);
            const meta = statusMeta(key);
            const tone =
              meta.tone === "running"
                ? "var(--c-blue-200)"
                : meta.tone === "wait"
                ? "var(--c-gold-300)"
                : meta.tone === "done"
                ? "var(--c-success-fg)"
                : meta.tone === "fail"
                ? "var(--c-error-fg)"
                : "var(--c-fog-300)";
            return (
              <button
                key={key}
                onClick={() => toggleStatus(key)}
                aria-pressed={active}
                style={{
                  padding: "2px 8px",
                  borderRadius: "var(--radius-xs)",
                  fontSize: 10,
                  fontFamily: "inherit",
                  border: `1px solid ${active ? tone : "var(--hairline)"}`,
                  background: active ? "var(--surface-2)" : "transparent",
                  color: active ? tone : "var(--c-steel-300)",
                  cursor: "pointer",
                  transition:
                    "color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out)",
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.color = "var(--c-fog-100)";
                }}
                onMouseLeave={(e) => {
                  if (!active)
                    e.currentTarget.style.color = "var(--c-steel-300)";
                }}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
      </FieldGroup>

      {/* Repository filter */}
      {repositories.length > 1 && (
        <FieldGroup label="Repository" htmlFor="filter-repository">
          <select
            id="filter-repository"
            value={filters.repository}
            onChange={(e) => onChange({ ...filters, repository: e.target.value })}
            style={{
              marginTop: 4,
              width: "100%",
              background: "var(--surface-0)",
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius-sm)",
              color: "var(--c-fog-100)",
              padding: "5px 8px",
              fontSize: 11,
              fontFamily: "inherit",
              outline: "none",
            }}
          >
            <option value="">All repositories</option>
            {repositories.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </FieldGroup>
      )}

      {/* Period filter */}
      <div className="flex items-center" style={{ gap: 4 }}>
        <span
          style={{
            fontSize: 10,
            color: "var(--c-steel-300)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontWeight: 600,
            marginRight: 4,
          }}
        >
          Period
        </span>
        {PERIODS.map((p) => {
          const active = filters.period === p.value;
          return (
            <button
              key={p.value}
              onClick={() => onChange({ ...filters, period: p.value })}
              aria-pressed={active}
              style={{
                padding: "2px 9px",
                borderRadius: "var(--radius-xs)",
                fontSize: 10,
                fontFamily: "inherit",
                border: `1px solid ${active ? "var(--c-blue-400)" : "var(--hairline)"}`,
                background: active ? "var(--c-blue-950)" : "transparent",
                color: active ? "var(--c-blue-200)" : "var(--c-steel-300)",
                cursor: "pointer",
                transition:
                  "color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out)",
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.color = "var(--c-fog-100)";
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.color = "var(--c-steel-300)";
              }}
            >
              {p.label}
            </button>
          );
        })}
        {hasActiveFilters(filters) && (
          <span style={{ marginLeft: "auto" }}>
            <Button size="xs" variant="ghost" onClick={clearAll}>
              Clear
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}

function FieldGroup({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        style={{
          fontSize: 10,
          color: "var(--c-steel-300)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 600,
          display: "block",
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}
