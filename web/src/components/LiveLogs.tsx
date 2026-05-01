import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

type LogEntry = {
  id: number;
  stream: string;
  message: string;
  timestamp: string | null;
};

const TERMINAL_STATUSES = new Set([
  "success",
  "pushed",
  "failed",
  "cancelled",
  "publish_rejected",
]);

export function LiveLogs({
  runId,
  runStatus,
}: {
  runId: string;
  runStatus: string;
}) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const isActive = !TERMINAL_STATUSES.has(runStatus);

  useEffect(() => {
    setLogs([]);
    if (!isActive) return;
    const es = new EventSource(`/v1/runs/${runId}/logs/stream`);
    es.onmessage = (event) => {
      const log: LogEntry = JSON.parse(event.data);
      setLogs((prev) => [...prev, log]);
    };
    return () => es.close();
  }, [runId, isActive]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !autoScrollRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  };

  if (!isActive && logs.length === 0) return null;

  return (
    <section style={{ marginBottom: 20 }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex items-center"
        style={{
          gap: 6,
          fontSize: "var(--text-label-md)",
          fontWeight: 700,
          color: "var(--c-fog-300)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 8,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          transition: "color var(--dur-fast) var(--ease-out)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--c-fog-100)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--c-fog-300)";
        }}
      >
        {expanded ? (
          <ChevronDown size={11} strokeWidth={2.5} aria-hidden="true" />
        ) : (
          <ChevronRight size={11} strokeWidth={2.5} aria-hidden="true" />
        )}
        Live Logs
        {isActive && (
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--c-success-fg)",
              animation: "pulse 1.4s var(--ease-in-out) infinite",
              boxShadow: "0 0 6px rgba(95, 209, 122, 0.6)",
              marginLeft: 4,
            }}
          />
        )}
        <span
          style={{
            fontWeight: 400,
            color: "var(--c-steel-300)",
            textTransform: "none",
            letterSpacing: 0,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          ({logs.length})
        </span>
      </button>
      {expanded && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            background: "var(--surface-0)",
            border: "1px solid var(--hairline)",
            borderRadius: "var(--radius-md)",
            padding: 12,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            lineHeight: 1.6,
            maxHeight: 400,
            overflowY: "auto",
          }}
        >
          {logs.length === 0 ? (
            <span style={{ color: "var(--c-steel-300)" }}>Waiting for logs…</span>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="flex" style={{ gap: 8 }}>
                <span
                  style={{
                    color:
                      log.stream === "stderr"
                        ? "var(--c-error-fg)"
                        : "var(--c-steel-300)",
                    fontWeight: 700,
                    flexShrink: 0,
                    width: 30,
                  }}
                >
                  {log.stream === "stderr" ? "ERR" : "OUT"}
                </span>
                <span
                  style={{
                    color: "var(--c-fog-100)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                  }}
                >
                  {log.message}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
