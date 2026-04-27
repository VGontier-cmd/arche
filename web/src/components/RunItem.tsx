import type { DashboardRun } from "../types";
import { formatCost, formatDuration, formatRelativeTime } from "../lib/format";
import { StatusBadge } from "./StatusBadge";

const ACTIVE_STATUSES = new Set(["executing", "planning", "reviewing", "running", "publishing"]);

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
  const cost = run.estimatedCostUsd ? ` · ${formatCost(run.estimatedCostUsd)}` : "";
  const findingsCount = run.latestFindings?.length ?? 0;
  const showFindingsBadge = run.status === "needs_human_input" && findingsCount > 0;
  const isActive = ACTIVE_STATUSES.has(run.status);

  return (
    <div
      className={`flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border-color)] cursor-pointer transition-colors relative ${
        selected
          ? "bg-[var(--color-base-300)] border-l-2 border-l-[#58a6ff]"
          : "hover:bg-[var(--color-base-200)]"
      } ${isActive ? "bg-[#0c2d6b15]" : ""}`}
      onClick={() => onSelect(run.id)}
    >
      {/* Active runs get a "breathing" animated indicator on the left so the
          audience can spot which ticket the agent is currently working on
          without reading status text. */}
      {isActive && (
        <span className="relative flex items-center shrink-0" aria-hidden="true">
          <span className="absolute w-3 h-3 rounded-full bg-[#3fb950] opacity-75 animate-ping" />
          <span className="relative w-2 h-2 rounded-full bg-[#3fb950]" />
        </span>
      )}

      {onToggleCheck && (
        <input
          type="checkbox"
          checked={isChecked ?? false}
          onChange={() => onToggleCheck(run.id)}
          onClick={(e) => e.stopPropagation()}
          className="accent-[#58a6ff] cursor-pointer shrink-0"
        />
      )}

      <StatusBadge status={run.status} mrUrl={run.mrUrl} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 font-semibold text-[var(--color-base-content)] text-xs">
          {jiraBaseUrl ? (
            <a
              href={`${jiraBaseUrl}/browse/${run.ticketKey}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#58a6ff] hover:underline shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              {run.ticketKey}
            </a>
          ) : (
            <span className="shrink-0">{run.ticketKey}</span>
          )}
          {showFindingsBadge && (
            <span className="inline-flex items-center px-1 py-0 rounded text-[9px] font-bold bg-[#3c1116] text-[#f85149] shrink-0">
              {findingsCount}
            </span>
          )}
        </div>

        {run.ticketTitle && (
          <div className="text-[11px] text-[var(--color-base-content)] truncate opacity-70 mt-0.5">
            {run.ticketTitle}
          </div>
        )}

        <div className="text-[11px] text-[var(--fg2)] truncate">
          {run.repoName || "-"}
          {cost}
          {workerStep != null && isActive && (
            <span className="ml-1 text-[#58a6ff]">· step {workerStep}</span>
          )}
        </div>

        <div className="text-[10px] text-[var(--fg3)]">
          {formatRelativeTime(run.createdAt)} · {formatDuration(run.startedAt, run.finishedAt)}
        </div>
      </div>
    </div>
  );
}
