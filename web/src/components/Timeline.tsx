import type { DashboardTimelineItem } from "../types";
import { formatTime } from "../lib/format";

const sourceColors: Record<string, string> = {
  event: "text-[#79c0ff]",
  log: "text-[#b1bac4]",
  command: "text-[#e3b341]",
  message: "text-[#d2a8ff]",
  task: "text-[#56d4cf]",
};

export function Timeline({ timeline }: { timeline: DashboardTimelineItem[] }) {
  if (timeline.length === 0) return null;

  const items = timeline.slice(-100);

  return (
    <div className="mb-5">
      <h3 className="text-[11px] font-semibold text-[var(--fg2)] uppercase tracking-wide mb-2">
        Timeline
      </h3>
      <div className="flex flex-col text-[11px] max-h-[400px] overflow-y-auto">
        {items.map((item, i) => (
          <div
            key={item.id}
            className={`flex gap-2 px-2 py-1 rounded-sm hover:bg-[var(--color-base-300)] ${i % 2 === 0 ? "bg-[var(--color-base-200)]" : ""}`}
          >
            <span className="text-[#7d8590] min-w-[80px] whitespace-nowrap">
              {formatTime(item.timestamp)}
            </span>
            <span
              className={`min-w-[60px] font-semibold ${sourceColors[item.source] || "text-[#b1bac4]"}`}
            >
              {item.source}
            </span>
            <span className="text-[#e6edf3] break-all">
              {item.title || ""}
            </span>
            {item.detail && (
              <span className="text-[#b1bac4] text-[11px] block ml-[90px] whitespace-pre-wrap max-h-[60px] overflow-auto">
                {item.detail}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
