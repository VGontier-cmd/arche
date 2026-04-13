import { useCallback, useEffect, useRef, useState, memo } from "react";
import type { DashboardTimelineItem } from "../types";
import { fetchTimeline } from "../api/client";
import { formatTime } from "../lib/format";

const sourceStyles: Record<string, { color: string; icon: string }> = {
  event: { color: "text-[#79c0ff]", icon: "\u25C6" },
  log: { color: "text-[#b1bac4]", icon: "\u2022" },
  command: { color: "text-[#e3b341]", icon: "\u25B8" },
  message: { color: "text-[#d2a8ff]", icon: "\u25AC" },
  task: { color: "text-[#56d4cf]", icon: "\u25A0" },
};

const PAGE_SIZE = 100;

const ThinkingBlock = memo(function ThinkingBlock({ excerpt }: { excerpt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ml-[137px] mt-0.5">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="text-[10px] text-[#7d8590] hover:text-[#b1bac4] flex items-center gap-1"
      >
        <span>{open ? "\u25BE" : "\u25B8"}</span>
        <span>Thinking...</span>
      </button>
      {open && (
        <div className="mt-0.5 px-2 py-1.5 bg-[var(--color-base-300)] border border-[var(--border-color)] rounded text-[10px] text-[#7d8590] whitespace-pre-wrap leading-tight max-h-48 overflow-y-auto">
          {excerpt}
        </div>
      )}
    </div>
  );
});

export function Timeline({
  timeline,
  timelineTotal,
  runId,
}: {
  timeline: DashboardTimelineItem[];
  timelineTotal: number;
  runId: string | null;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [extraItems, setExtraItems] = useState<DashboardTimelineItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Reset extra items when run changes
  useEffect(() => {
    setExtraItems([]);
  }, [runId]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const loadOlder = useCallback(async () => {
    if (!runId || loading) return;
    setLoading(true);
    try {
      // We have the latest items from the snapshot. Load items from the beginning.
      const currentCount = timeline.length + extraItems.length;
      const offset = 0;
      const limit = currentCount + PAGE_SIZE;
      const result = await fetchTimeline(runId, offset, limit);
      // Extra items = everything from the fetch that isn't already in the snapshot timeline
      const snapshotIds = new Set(timeline.map((t) => t.id));
      const newExtra = result.items.filter((item) => !snapshotIds.has(item.id));
      setExtraItems(newExtra);
    } catch (e) {
      console.error("Failed to load older timeline items", e);
    } finally {
      setLoading(false);
    }
  }, [runId, loading, timeline, extraItems]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  // Auto-scroll to bottom when new items arrive if user is near the bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const currentCount = timeline.length + extraItems.length;
    if (currentCount > prevCountRef.current) {
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      if (isNearBottom) {
        el.scrollTop = el.scrollHeight;
      }
    }
    prevCountRef.current = currentCount;
  }, [timeline.length, extraItems.length]);

  if (timeline.length === 0 && extraItems.length === 0) return null;

  // Merge: extra items (older, from pagination) + snapshot timeline items
  // Both are chronologically sorted, extras come first
  const allItems = [...extraItems, ...timeline.filter((t) => !extraItems.some((e) => e.id === t.id))];
  const hasMore = timelineTotal > allItems.length;

  return (
    <div className="mb-5">
      <h3 className="text-[11px] font-semibold text-[var(--fg2)] uppercase tracking-wide mb-2">
        Timeline ({allItems.length}/{timelineTotal})
      </h3>
      <div ref={scrollRef} className="flex flex-col text-[11px] max-h-[400px] overflow-y-auto rounded-[var(--rounded-box)] border border-[var(--border-color)]">
        {hasMore && (
          <button
            onClick={loadOlder}
            disabled={loading}
            className="px-3 py-1.5 text-center text-[#58a6ff] hover:bg-[var(--color-base-300)] text-[10px] border-b border-[var(--border-color)]"
          >
            {loading ? "Loading..." : "Load older items"}
          </button>
        )}
        {allItems.map((item, i) => {
          const style = sourceStyles[item.source] || sourceStyles.log;
          const hasDetail = !!item.detail;
          const isExpanded = expanded.has(item.id);
          return (
            <div
              key={item.id}
              className={`px-3 py-1.5 hover:bg-[var(--color-base-300)] ${hasDetail ? "cursor-pointer" : ""} ${i % 2 === 0 ? "bg-[var(--color-base-200)]" : "bg-[var(--color-base-100)]"}`}
              onClick={hasDetail ? () => toggle(item.id) : undefined}
            >
              <div className="flex items-start gap-2">
                <span className="text-[#7d8590] min-w-[65px] whitespace-nowrap shrink-0">
                  {formatTime(item.timestamp)}
                </span>
                <span
                  className={`min-w-[70px] shrink-0 font-semibold ${style.color}`}
                >
                  {style.icon} {item.source}
                </span>
                <span className="text-[#e6edf3] break-words min-w-0 flex-1">
                  {item.title || ""}
                </span>
                {hasDetail && (
                  <span className="text-[var(--fg3)] shrink-0 text-[9px] select-none">
                    {isExpanded ? "\u25BC" : "\u25B6"}
                  </span>
                )}
              </div>
              {hasDetail && (
                <div
                  className={`ml-[137px] mt-0.5 text-[#8b949e] text-[10px] whitespace-pre-wrap leading-tight ${isExpanded ? "overflow-auto" : "max-h-[60px] overflow-hidden"}`}
                >
                  {item.detail}
                </div>
              )}
              {item.source === "message" && item.thinkingExcerpt && (
                <ThinkingBlock excerpt={item.thinkingExcerpt} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
