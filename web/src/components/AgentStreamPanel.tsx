import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Play } from "lucide-react";
import { useAgentStream } from "../hooks/useAgentStream";
import { renderMarkdown } from "../lib/markdown";
import { formatToolArgs, renderStreamText } from "../lib/stream-render";

function ChevronIcon({ open }: { open: boolean }) {
  return open ? (
    <ChevronDown size={11} strokeWidth={2.5} aria-hidden="true" />
  ) : (
    <ChevronRight size={11} strokeWidth={2.5} aria-hidden="true" />
  );
}

/**
 * Live "agent typing" panel. Subscribes to /v1/runs/:id/agent-stream and
 * renders the model's incremental output (text deltas + reasoning + tool
 * call args + preliminary tool results) in real time.
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

  const rendered = useMemo(() => renderStreamText(stream.text), [stream.text]);
  const reasoningHtml = useMemo(
    () => (stream.reasoning ? renderMarkdown(stream.reasoning) : ""),
    [stream.reasoning],
  );
  const toolArgs = useMemo(
    () => formatToolArgs(stream.partialToolArgs),
    [stream.partialToolArgs],
  );

  useEffect(() => {
    const el = textRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [
    stream.text,
    stream.reasoning,
    stream.partialToolArgs,
    stream.preliminaryResults.length,
  ]);

  const isLive = ["pending", "researching", "planning", "executing", "reviewing"].includes(
    runStatus ?? "",
  );
  const hasContent =
    stream.text.length > 0 ||
    stream.reasoning.length > 0 ||
    stream.partialToolArgs.length > 0 ||
    stream.preliminaryResults.length > 0;

  if (!isLive && !hasContent) return null;

  const dotColor =
    stream.connected && !stream.done
      ? "var(--c-success-fg)"
      : stream.done
      ? "var(--c-steel-300)"
      : "var(--c-warning-fg)";

  return (
    <section
      style={{ marginBottom: 20 }}
      aria-labelledby="stream-heading"
    >
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 8 }}
      >
        <h3
          id="stream-heading"
          className="flex items-center"
          style={{
            fontSize: "var(--text-label-md)",
            fontWeight: 700,
            color: "var(--c-fog-300)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            gap: 6,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: dotColor,
              animation:
                stream.connected && !stream.done
                  ? "pulse 1.4s var(--ease-in-out) infinite"
                  : "none",
              boxShadow:
                stream.connected && !stream.done
                  ? "0 0 6px rgba(95, 209, 122, 0.6)"
                  : undefined,
            }}
          />
          Agent stream
          {stream.connected && !stream.done && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 500,
                color: "var(--c-success-fg)",
                textTransform: "lowercase",
                letterSpacing: 0,
              }}
            >
              live
            </span>
          )}
          {stream.done && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 500,
                color: "var(--c-steel-300)",
                textTransform: "lowercase",
                letterSpacing: 0,
              }}
            >
              turn done
            </span>
          )}
          {rendered.fromJson && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 500,
                padding: "1px 5px",
                borderRadius: 2,
                background: "var(--c-info-bg)",
                color: "var(--c-info-fg)",
                textTransform: "lowercase",
                letterSpacing: 0,
              }}
            >
              structured
            </span>
          )}
        </h3>
        <div className="flex items-center" style={{ gap: 8 }}>
          {rendered.fromJson && (
            <button
              onClick={() => setShowRaw((v) => !v)}
              style={{
                fontSize: 10,
                color: "var(--c-fog-300)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--c-fog-100)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--c-fog-300)";
              }}
              title="Toggle raw JSON view"
            >
              {showRaw ? "rendered" : "raw"}
            </button>
          )}
          {stream.reasoning.length > 0 && (
            <button
              onClick={() => setShowReasoning((v) => !v)}
              style={{
                fontSize: 10,
                color: "var(--c-fog-300)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                fontFamily: "inherit",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--c-info-fg)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--c-fog-300)";
              }}
              aria-expanded={showReasoning}
            >
              <ChevronIcon open={showReasoning} /> reasoning ({stream.reasoning.length} chars)
            </button>
          )}
        </div>
      </div>

      {/* Reasoning */}
      {showReasoning && stream.reasoning.length > 0 && (
        <div
          className="arche-prose arche-prose-sm"
          style={{
            marginBottom: 8,
            padding: "8px 12px",
            background: "var(--surface-2)",
            border: "1px solid var(--hairline)",
            borderRadius: "var(--radius-md)",
            fontSize: 10,
            color: "var(--c-fog-300)",
            lineHeight: 1.55,
            maxHeight: 192,
            overflow: "auto",
          }}
          dangerouslySetInnerHTML={{ __html: reasoningHtml }}
        />
      )}

      {/* Main output */}
      {(stream.text.length > 0 || stream.connected) && (
        <div
          ref={textRef}
          style={{
            padding: "10px 12px",
            background: "var(--surface-1)",
            border: "1px solid var(--hairline)",
            borderRadius: "var(--radius-md)",
            fontSize: 11,
            color: "var(--c-fog-100)",
            lineHeight: 1.55,
            maxHeight: 288,
            overflow: "auto",
          }}
        >
          {stream.text.length === 0 ? (
            <span style={{ color: "var(--c-steel-300)", fontStyle: "italic" }}>
              Waiting for first token…
            </span>
          ) : showRaw ||
            (rendered.primaryHtml === null && rendered.rawText !== null) ? (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                margin: 0,
                lineHeight: 1.55,
              }}
            >
              {rendered.rawText ?? stream.text}
              {stream.connected && !stream.done && <LiveCursor />}
            </pre>
          ) : rendered.primaryHtml ? (
            <>
              <div
                className="arche-prose arche-prose-sm"
                dangerouslySetInnerHTML={{ __html: rendered.primaryHtml }}
              />
              {stream.connected && !stream.done && <LiveCursor />}
            </>
          ) : (
            <span style={{ color: "var(--c-steel-300)", fontStyle: "italic" }}>
              Streaming…
            </span>
          )}
        </div>
      )}

      {/* Partial tool args */}
      {stream.partialToolArgs.length > 0 && (
        <div
          style={{
            marginTop: 8,
            padding: "8px 12px",
            background: "var(--c-blue-950)",
            border: "1px solid var(--c-blue-700)",
            borderRadius: "var(--radius-md)",
            fontSize: 10,
            color: "var(--c-blue-200)",
            fontFamily: "var(--font-mono)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            maxHeight: 128,
            overflow: "auto",
          }}
        >
          <span style={{ opacity: 0.7 }}>tool args › </span>
          {toolArgs}
        </div>
      )}

      {/* Preliminary tool results */}
      {stream.preliminaryResults.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: "var(--c-steel-300)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 4,
            }}
          >
            Tool progress ({stream.preliminaryResults.length})
          </div>
          <div
            style={{
              padding: "8px 12px",
              background: "var(--surface-2)",
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius-md)",
              fontSize: 10,
              color: "var(--c-fog-300)",
              fontFamily: "var(--font-mono)",
              whiteSpace: "pre-wrap",
              lineHeight: 1.55,
              maxHeight: 160,
              overflow: "auto",
            }}
          >
            {stream.preliminaryResults.map((p, i) => (
              <PreliminaryLine key={`${p.toolCallId}-${i}`} result={p.result} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
});

function LiveCursor() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 4,
        height: 12,
        marginLeft: 2,
        verticalAlign: "middle",
        background: "var(--c-blue-400)",
        animation: "blink 1.1s var(--ease-in-out) infinite",
      }}
    />
  );
}

function PreliminaryLine({ result }: { result: unknown }) {
  if (result && typeof result === "object") {
    const r = result as { type?: string; data?: unknown; command?: unknown };
    if (r.type === "started" && typeof r.command === "string") {
      return (
        <div
          className="flex items-center"
          style={{ color: "var(--c-gold-300)", gap: 4 }}
        >
          <Play size={9} strokeWidth={2.5} aria-hidden="true" /> {r.command}
        </div>
      );
    }
    if (r.type === "stdout_chunk" && typeof r.data === "string") {
      return <span>{r.data}</span>;
    }
    if (r.type === "stderr_chunk" && typeof r.data === "string") {
      return <span style={{ color: "var(--c-error-fg)" }}>{r.data}</span>;
    }
  }
  return (
    <div style={{ color: "var(--c-steel-300)", fontStyle: "italic" }}>
      {typeof result === "string"
        ? result
        : JSON.stringify(result).slice(0, 200)}
    </div>
  );
}
