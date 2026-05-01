import { useCallback, useEffect, useRef, useState, memo } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Diamond,
  Dot,
  Eye,
  FileEdit,
  FilePlus,
  FileX,
  Layers,
  MessageSquare,
  Play,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import type { DashboardTimelineItem } from "../types";
import { fetchTimeline } from "../api/client";
import { formatTime } from "../lib/format";
import { Button } from "./ui/Button";
import { SectionHeading } from "./ui/SectionHeading";

type SourceKind = "event" | "log" | "command" | "message" | "task";

interface SourceStyle {
  Icon: LucideIcon;
  color: string;
}

const SOURCE_STYLES: Record<SourceKind, SourceStyle> = {
  event:   { Icon: Diamond,        color: "var(--c-blue-200)"   },
  log:     { Icon: Dot,            color: "var(--c-steel-300)"  },
  command: { Icon: Terminal,       color: "var(--c-gold-300)"   },
  message: { Icon: MessageSquare,  color: "var(--c-info-fg)"    },
  task:    { Icon: Layers,         color: "var(--c-info-fg)"    },
};

interface ActionMeta {
  Icon: LucideIcon;
  color: string;
  label: string;
}

function detectActionTool(title: string): ActionMeta | null {
  if (title.startsWith("Writing file:"))    return { Icon: FileEdit, color: "var(--c-success-fg)",  label: "write"  };
  if (title.startsWith("Reading"))          return { Icon: Eye,      color: "var(--c-fog-300)",     label: "read"   };
  if (title.startsWith("Deleting file:"))   return { Icon: FileX,    color: "var(--c-error-fg)",    label: "delete" };
  if (title.startsWith("Applying patch"))   return { Icon: FilePlus, color: "var(--c-blue-200)",    label: "patch"  };
  if (title.startsWith("Running command:")) return { Icon: ArrowRight, color: "var(--c-gold-300)",  label: "cmd"    };
  if (title.startsWith("Finished:"))        return { Icon: Check,    color: "var(--c-success-fg)",  label: "finish" };
  return null;
}

const PAGE_SIZE = 100;

const ThinkingBlock = memo(function ThinkingBlock({ excerpt }: { excerpt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginLeft: 137, marginTop: 4 }}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        style={{
          fontSize: 10,
          color: "var(--c-steel-300)",
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontFamily: "inherit",
        }}
        aria-expanded={open}
      >
        {open
          ? <ChevronDown size={11} strokeWidth={2} aria-hidden="true" />
          : <ChevronRight size={11} strokeWidth={2} aria-hidden="true" />}
        Thinking…
      </button>
      {open && (
        <div
          style={{
            marginTop: 4,
            padding: "8px 10px",
            background: "var(--surface-2)",
            border: "1px solid var(--hairline)",
            borderRadius: "var(--radius-sm)",
            fontSize: 10,
            color: "var(--c-fog-300)",
            whiteSpace: "pre-wrap",
            lineHeight: 1.45,
            maxHeight: 192,
            overflowY: "auto",
          }}
        >
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
      const currentCount = timeline.length + extraItems.length;
      const offset = 0;
      const limit = currentCount + PAGE_SIZE;
      const result = await fetchTimeline(runId, offset, limit);
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
  const [replaying, setReplaying] = useState(false);
  const replayCancelRef = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const currentCount = timeline.length + extraItems.length;
    if (currentCount > prevCountRef.current) {
      const isNearBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      if (isNearBottom) {
        el.scrollTop = el.scrollHeight;
      }
    }
    prevCountRef.current = currentCount;
  }, [timeline.length, extraItems.length]);

  useEffect(() => {
    replayCancelRef.current = true;
    setReplaying(false);
  }, [runId]);

  const startReplay = useCallback(() => {
    const el = scrollRef.current;
    if (!el || replaying) return;
    const target = el.scrollHeight - el.clientHeight;
    if (target <= 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.scrollTop = target;
      return;
    }
    setReplaying(true);
    replayCancelRef.current = false;
    el.scrollTop = 0;

    const durationMs = 5_000;
    const startTime = performance.now();

    const tick = () => {
      if (replayCancelRef.current) {
        setReplaying(false);
        return;
      }
      const elapsed = performance.now() - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      const eased =
        progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      el.scrollTop = target * eased;
      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        setReplaying(false);
      }
    };
    requestAnimationFrame(tick);
  }, [replaying]);

  if (timeline.length === 0 && extraItems.length === 0) return null;

  const allItems = [
    ...extraItems,
    ...timeline.filter((t) => !extraItems.some((e) => e.id === t.id)),
  ];
  const hasMore = timelineTotal > allItems.length;

  return (
    <section style={{ marginBottom: 20 }} aria-labelledby="timeline-heading">
      <SectionHeading
        id="timeline-heading"
        trailing={
          <Button
            size="xs"
            variant="ghost"
            leftIcon={<Play size={10} strokeWidth={2.5} />}
            onClick={startReplay}
            disabled={replaying || allItems.length < 4}
            title="Replay the timeline by scrolling from start to end"
          >
            {replaying ? "Replaying…" : "Replay"}
          </Button>
        }
      >
        Timeline ({allItems.length}/{timelineTotal})
      </SectionHeading>

      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        style={{
          display: "flex",
          flexDirection: "column",
          fontSize: 11,
          maxHeight: 400,
          overflowY: "auto",
          background: "var(--surface-1)",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius-md)",
        }}
      >
        {hasMore && (
          <button
            onClick={loadOlder}
            disabled={loading}
            style={{
              padding: "8px 12px",
              textAlign: "center",
              color: "var(--c-blue-400)",
              background: "transparent",
              border: "none",
              borderBottom: "1px solid var(--hairline)",
              fontSize: 10,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "inherit",
            }}
            onMouseEnter={(e) => {
              if (!loading) e.currentTarget.style.background = "var(--surface-2)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            {loading ? "Loading…" : "Load older items"}
          </button>
        )}

        {allItems.map((item, i) => {
          const source = (item.source as SourceKind) ?? "log";
          const isAction = item.source === "message" && item.kind === "action";
          const actionTool = isAction ? detectActionTool(item.title) : null;
          const style = SOURCE_STYLES[source] ?? SOURCE_STYLES.log;
          const Icon = actionTool ? actionTool.Icon : style.Icon;
          const color = actionTool ? actionTool.color : style.color;
          const sourceLabel = actionTool ? actionTool.label : item.source;
          const hasDetail = !!item.detail;
          const isExpanded = expanded.has(item.id);

          return (
            <div
              key={item.id}
              role={hasDetail ? "button" : undefined}
              tabIndex={hasDetail ? 0 : undefined}
              onClick={hasDetail ? () => toggle(item.id) : undefined}
              onKeyDown={
                hasDetail
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggle(item.id);
                      }
                    }
                  : undefined
              }
              style={{
                position: "relative",
                padding: "8px 12px 8px 16px",
                borderBottom:
                  i === allItems.length - 1
                    ? "none"
                    : "1px solid var(--hairline)",
                cursor: hasDetail ? "pointer" : "default",
                transition: "background var(--dur-fast) var(--ease-out)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--surface-2)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              {/* Source-tone bullet on the left edge */}
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: 6,
                  top: 14,
                  width: 4,
                  height: 4,
                  background: color,
                  borderRadius: "50%",
                  opacity: 0.85,
                }}
              />

              <div className="flex items-start" style={{ gap: 8 }}>
                {/* Sticky timestamp column */}
                <span
                  className="tabular shrink-0"
                  style={{
                    color: "var(--c-steel-300)",
                    minWidth: 65,
                    whiteSpace: "nowrap",
                    fontSize: 10,
                  }}
                >
                  {formatTime(item.timestamp)}
                </span>
                {/* Icon + source label column */}
                <span
                  className="shrink-0 flex items-center"
                  style={{
                    minWidth: 78,
                    gap: 5,
                    color,
                    fontWeight: 700,
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  <Icon size={11} strokeWidth={2} aria-hidden="true" />
                  {sourceLabel}
                </span>
                {/* Title */}
                <span
                  className="break-words flex-1"
                  style={{
                    minWidth: 0,
                    color: isAction ? color : "var(--c-fog-100)",
                  }}
                >
                  {item.title || ""}
                </span>
                {hasDetail && (
                  <span
                    aria-hidden="true"
                    className="shrink-0"
                    style={{
                      color: "var(--c-steel-300)",
                      display: "inline-flex",
                      alignItems: "center",
                    }}
                  >
                    {isExpanded
                      ? <ChevronDown size={11} strokeWidth={2} />
                      : <ChevronRight size={11} strokeWidth={2} />}
                  </span>
                )}
              </div>
              {hasDetail && (
                <div
                  style={{
                    marginLeft: 137,
                    marginTop: 4,
                    color: "var(--c-fog-300)",
                    fontSize: 10,
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.45,
                    maxHeight: isExpanded ? undefined : 60,
                    overflow: isExpanded ? "auto" : "hidden",
                  }}
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
    </section>
  );
}
