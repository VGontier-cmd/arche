import type { DashboardRun } from "../types";
import { formatCost, formatDuration, formatTime } from "../lib/format";
import { StatusBadge } from "./StatusBadge";

export function RunItem({
  run,
  selected,
  onSelect,
}: {
  run: DashboardRun;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const cost = run.estimatedCostUsd ? ` \u00b7 ${formatCost(run.estimatedCostUsd)}` : "";

  return (
    <div
      className={`flex items-center gap-2 px-4 py-2 border-b border-[var(--border-color)] cursor-pointer transition-colors ${
        selected
          ? "bg-[var(--color-base-300)] border-l-2 border-l-[#58a6ff]"
          : "hover:bg-[var(--color-base-200)]"
      }`}
      onClick={() => onSelect(run.id)}
    >
      <StatusBadge status={run.status} />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-[var(--color-base-content)]">
          {run.ticketKey}
        </div>
        <div className="text-[11px] text-[var(--fg2)]">
          {run.repoName || "-"}
          {cost}
        </div>
        <div className="text-[10px] text-[var(--fg3)]">
          {formatTime(run.createdAt)} &middot;{" "}
          {formatDuration(run.startedAt, run.finishedAt)}
        </div>
      </div>
    </div>
  );
}
