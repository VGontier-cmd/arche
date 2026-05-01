import type { DashboardRun } from "../types";
import { formatCost, formatDuration, formatRelativeTime } from "../lib/format";
import { StatusPill } from "./ui/StatusPill";
import { Badge } from "./ui/Badge";
import { statusMeta, toneVars } from "./ui/tokens";

const ACTIVE_STATUSES = new Set([
  "executing",
  "planning",
  "reviewing",
  "running",
  "publishing",
  "researching",
]);

export function RunItem({
  run,
  selected,
  onSelect,
  jiraBaseUrl,
  isChecked,
  onToggleCheck,
  workerStep,
}: {
  run: DashboardRun;
  selected: boolean;
  onSelect: (id: string) => void;
  jiraBaseUrl?: string | null;
  isChecked?: boolean;
  onToggleCheck?: (id: string) => void;
  workerStep?: number | null;
}) {
  const findingsCount = run.latestFindings?.length ?? 0;
  const showFindingsBadge =
    run.status === "needs_human_input" && findingsCount > 0;
  const isActive = ACTIVE_STATUSES.has(run.status);

  // Status spine — drives the left edge color from the same token system that
  // powers StatusPill / RunHeadline. No more inline #58a6ff.
  const meta = statusMeta(run.status);
  const tone = toneVars(meta.tone);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(run.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(run.id);
        }
      }}
      className="flex items-center cursor-pointer relative"
      style={{
        gap: 8,
        padding: "10px 16px 10px 18px",
        borderBottom: "1px solid var(--hairline)",
        background: selected
          ? "var(--surface-2)"
          : "transparent",
        transition: "background var(--dur-fast) var(--ease-out)",
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.background = "var(--surface-1)";
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.background = "transparent";
      }}
    >
      {/* Status spine — full-height left edge bar, tone-driven */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: selected ? 4 : 3,
          background: tone.fg,
          opacity: selected ? 1 : 0.7,
          boxShadow: meta.live ? tone.glow : undefined,
          transition:
            "width var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out)",
        }}
      />

      {/* Active "breathing" dot — only on live phases */}
      {isActive && (
        <span
          aria-hidden="true"
          className="relative flex items-center shrink-0"
          style={{ width: 12, height: 12 }}
        >
          <span
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background: "var(--c-blue-400)",
              opacity: 0.5,
              animation: "ping 1.4s var(--ease-out) infinite",
            }}
          />
          <span
            style={{
              position: "relative",
              width: 6,
              height: 6,
              margin: "auto",
              borderRadius: "50%",
              background: "var(--c-blue-200)",
            }}
          />
        </span>
      )}

      {onToggleCheck && (
        <input
          type="checkbox"
          checked={isChecked ?? false}
          onChange={() => onToggleCheck(run.id)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${run.ticketKey}${run.ticketTitle ? ` — ${run.ticketTitle}` : ""}`}
          className="cursor-pointer shrink-0"
          style={{ accentColor: "var(--c-blue-400)" }}
        />
      )}

      <StatusPill status={run.status} mrUrl={run.mrUrl} size="sm" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center" style={{ gap: 6 }}>
          {jiraBaseUrl ? (
            <a
              href={`${jiraBaseUrl}/browse/${run.ticketKey}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                color: "var(--c-bone)",
              }}
              className="hover:underline shrink-0"
            >
              {run.ticketKey}
            </a>
          ) : (
            <span
              className="shrink-0"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                color: "var(--c-bone)",
              }}
            >
              {run.ticketKey}
            </span>
          )}
          {showFindingsBadge && (
            <Badge tone="danger">{findingsCount}</Badge>
          )}
        </div>

        {run.ticketTitle && (
          <div
            className="truncate"
            style={{
              fontSize: 11,
              color: "var(--c-fog-100)",
              marginTop: 2,
              opacity: 0.85,
            }}
          >
            {run.ticketTitle}
          </div>
        )}

        <div
          className="truncate"
          style={{ fontSize: 10, color: "var(--c-fog-300)", marginTop: 2 }}
        >
          {run.repoName || "—"}
          {run.estimatedCostUsd ? ` · ${formatCost(run.estimatedCostUsd)}` : ""}
          {workerStep != null && isActive && (
            <span style={{ marginLeft: 6, color: "var(--c-blue-200)" }}>
              · step {workerStep}
            </span>
          )}
        </div>

        <div style={{ fontSize: 10, color: "var(--c-steel-300)", marginTop: 1 }}>
          {formatRelativeTime(run.createdAt)} ·{" "}
          {formatDuration(run.startedAt, run.finishedAt)}
        </div>
      </div>
    </div>
  );
}
