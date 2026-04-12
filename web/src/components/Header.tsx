import type { DashboardWorker } from "../types";
import { formatTime } from "../lib/format";

export function Header({
  workers,
  refreshedAt,
}: {
  workers: DashboardWorker[];
  refreshedAt: string;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-3 bg-[var(--color-base-200)] border-b border-[var(--border-color)]">
      <h1 className="text-base font-semibold text-[var(--color-base-content)]">
        Arche Dashboard
      </h1>
      <div className="flex items-center gap-2 text-[11px] text-[var(--fg2)]">
        <span className="flex items-center gap-2">
          {workers.map((w) => (
            <span key={w.id} className="flex items-center gap-1">
              <span
                className={`inline-block w-2 h-2 rounded-full ${w.offline ? "bg-[#f85149]" : "bg-[#3fb950]"}`}
              />
              {w.name}
            </span>
          ))}
        </span>
        <span>{formatTime(refreshedAt)}</span>
      </div>
    </div>
  );
}
