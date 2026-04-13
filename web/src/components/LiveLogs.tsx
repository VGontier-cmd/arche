import { useEffect, useRef, useState } from "react";

type LogEntry = {
  id: number;
  stream: string;
  message: string;
  timestamp: string | null;
};

const TERMINAL_STATUSES = new Set(["success", "pushed", "failed", "cancelled", "publish_rejected"]);

export function LiveLogs({ runId, runStatus }: { runId: string; runStatus: string }) {
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

  // Auto-scroll
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
    <div className="mb-5">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--fg2)] uppercase tracking-wide mb-2 hover:text-[var(--color-base-content)] transition-colors"
      >
        <span className={`transition-transform ${expanded ? "rotate-90" : ""}`}>{"\u25B6"}</span>
        Live Logs
        {isActive && (
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#3fb950] animate-pulse ml-1" />
        )}
        <span className="font-normal text-[var(--fg3)]">({logs.length})</span>
      </button>
      {expanded && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="bg-[#0d1117] border border-[var(--border-color)] rounded-[var(--rounded-box)] p-3 font-mono text-[11px] leading-[1.6] max-h-[400px] overflow-y-auto"
        >
          {logs.length === 0 ? (
            <span className="text-[var(--fg3)]">Waiting for logs...</span>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="flex gap-2">
                <span className={log.stream === "stderr" ? "text-[#f85149]" : "text-[#8b949e]"}>
                  {log.stream === "stderr" ? "ERR" : "OUT"}
                </span>
                <span className="text-[var(--color-base-content)] whitespace-pre-wrap break-all">
                  {log.message}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
