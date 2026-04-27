import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Play } from "lucide-react";
import { useAgentStream } from "../hooks/useAgentStream";

function ChevronIcon({ open }: { open: boolean }) {
  return open ? (
    <ChevronDown size={11} strokeWidth={2.5} className="inline-block -mt-0.5 mr-0.5" aria-hidden="true" />
  ) : (
    <ChevronRight size={11} strokeWidth={2.5} className="inline-block -mt-0.5 mr-0.5" aria-hidden="true" />
  );
}
import { renderMarkdown } from "../lib/markdown";
import { formatToolArgs, renderStreamText } from "../lib/stream-render";

/**
 * Live "agent typing" panel. Subscribes to /v1/runs/:id/agent-stream and
 * renders the model's incremental output (text deltas + reasoning + tool
 * call args + preliminary tool results like stdout chunks) in real time.
 *
 * Renders rich content where possible: markdown for prose / parsed JSON
 * envelopes, monospace JSON fragments otherwise. Auto-collapses when the
 * run leaves an active state and the stream goes quiet — past output is
 * preserved in the timeline below, no need to clutter.
 */
export const AgentStreamPanel = memo(function AgentStreamPanel({
  runId,
  runStatus,
}: {
  runId: string | null;
  runStatus: string | null;
}) {
  const stream = useAgentStream(runId, runStatus);
  const [showReasoning, setShowReasoning] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);

  // Memoise expensive renders (markdown parse) on every keystroke is fine —
  // the SDK delta cadence is plenty fast. Recompute only when text actually
  // changes.
  const rendered = useMemo(() => renderStreamText(stream.text), [stream.text]);
  const reasoningHtml = useMemo(
    () => (stream.reasoning ? renderMarkdown(stream.reasoning) : ""),
    [stream.reasoning],
  );
  const toolArgs = useMemo(() => formatToolArgs(stream.partialToolArgs), [stream.partialToolArgs]);

  // Auto-scroll to bottom as new tokens arrive.
  useEffect(() => {
    const el = textRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [stream.text, stream.reasoning, stream.partialToolArgs, stream.preliminaryResults.length]);

  const isLive = ["pending", "researching", "planning", "executing", "reviewing"].includes(runStatus ?? "");
  const hasContent =
    stream.text.length > 0 ||
    stream.reasoning.length > 0 ||
    stream.partialToolArgs.length > 0 ||
    stream.preliminaryResults.length > 0;

  if (!isLive && !hasContent) return null;

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] font-semibold text-[var(--fg2)] uppercase tracking-wide flex items-center gap-2">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${
              stream.connected && !stream.done
                ? "bg-[#3fb950] animate-pulse"
                : stream.done
                  ? "bg-[#7d8590]"
                  : "bg-[#d29922]"
            }`}
          />
          Agent stream
          {stream.connected && !stream.done && (
            <span className="text-[10px] font-normal text-[#3fb950] normal-case">live</span>
          )}
          {stream.done && (
            <span className="text-[10px] font-normal text-[var(--fg3)] normal-case">turn done</span>
          )}
          {rendered.fromJson && (
            <span className="text-[9px] font-normal text-[#bc8cff] normal-case px-1 rounded bg-[#bc8cff20]">
              structured
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          {rendered.fromJson && (
            <button
              onClick={() => setShowRaw((v) => !v)}
              className="text-[10px] text-[var(--fg2)] hover:text-[var(--color-base-content)]"
              title="Toggle raw JSON view"
            >
              {showRaw ? "rendered" : "raw"}
            </button>
          )}
          {stream.reasoning.length > 0 && (
            <button
              onClick={() => setShowReasoning((v) => !v)}
              className="text-[10px] text-[var(--fg2)] hover:text-[#bc8cff]"
            >
              <ChevronIcon open={showReasoning} /> reasoning ({stream.reasoning.length} chars)
            </button>
          )}
        </div>
      </div>

      {/* Reasoning (foldable, only shown when present) */}
      {showReasoning && stream.reasoning.length > 0 && (
        <div
          className="arche-prose arche-prose-sm mb-2 px-3 py-2 bg-[var(--color-base-300)] border border-[var(--border-color)] rounded-[var(--rounded-box)] text-[10px] text-[#7d8590] leading-relaxed max-h-48 overflow-auto"
          dangerouslySetInnerHTML={{ __html: reasoningHtml }}
        />
      )}

      {/* Main output — markdown when free-form prose or extracted from JSON,
          raw JSON pretty-print otherwise */}
      {(stream.text.length > 0 || stream.connected) && (
        <div
          ref={textRef}
          className="px-3 py-2 bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] text-[11px] text-[var(--color-base-content)] leading-relaxed max-h-72 overflow-auto"
        >
          {stream.text.length === 0 ? (
            <span className="text-[var(--fg3)] italic">Waiting for first token…</span>
          ) : showRaw || (rendered.primaryHtml === null && rendered.rawText !== null) ? (
            <pre className="whitespace-pre-wrap font-mono text-[10px] m-0 leading-relaxed">
              {rendered.rawText ?? stream.text}
              {stream.connected && !stream.done && (
                <span className="inline-block w-1 h-3 ml-0.5 align-middle bg-[#58a6ff] animate-pulse" />
              )}
            </pre>
          ) : rendered.primaryHtml ? (
            <>
              <div
                className="arche-prose arche-prose-sm"
                dangerouslySetInnerHTML={{ __html: rendered.primaryHtml }}
              />
              {stream.connected && !stream.done && (
                <span className="inline-block w-1 h-3 ml-0.5 align-middle bg-[#58a6ff] animate-pulse" />
              )}
            </>
          ) : (
            <span className="text-[var(--fg3)] italic">Streaming…</span>
          )}
        </div>
      )}

      {/* Partial tool call args — formatted JSON when parseable */}
      {stream.partialToolArgs.length > 0 && (
        <div className="mt-2 px-3 py-1.5 bg-[#58a6ff10] border border-[#58a6ff40] rounded-[var(--rounded-box)] text-[10px] text-[#58a6ff] font-mono whitespace-pre-wrap break-all max-h-32 overflow-auto">
          <span className="opacity-70">tool args › </span>
          {toolArgs}
        </div>
      )}

      {/* Preliminary tool results (e.g. stdout chunks from run_command) */}
      {stream.preliminaryResults.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] text-[var(--fg3)] uppercase tracking-wide mb-1">
            Tool progress ({stream.preliminaryResults.length})
          </div>
          <div className="px-3 py-2 bg-[var(--color-base-300)] border border-[var(--border-color)] rounded-[var(--rounded-box)] text-[10px] text-[var(--fg2)] font-mono whitespace-pre-wrap leading-relaxed max-h-40 overflow-auto">
            {stream.preliminaryResults.map((p, i) => (
              <PreliminaryLine key={`${p.toolCallId}-${i}`} result={p.result} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

function PreliminaryLine({ result }: { result: unknown }) {
  if (result && typeof result === "object") {
    const r = result as { type?: string; data?: unknown; command?: unknown };
    if (r.type === "started" && typeof r.command === "string") {
      return (
        <div className="text-[#e3b341] flex items-center gap-1">
          <Play size={9} strokeWidth={2.5} aria-hidden="true" /> {r.command}
        </div>
      );
    }
    if (r.type === "stdout_chunk" && typeof r.data === "string") {
      return <span>{r.data}</span>;
    }
    if (r.type === "stderr_chunk" && typeof r.data === "string") {
      return <span className="text-[#f85149]">{r.data}</span>;
    }
  }
  return (
    <div className="text-[var(--fg3)] italic">
      {typeof result === "string" ? result : JSON.stringify(result).slice(0, 200)}
    </div>
  );
}
