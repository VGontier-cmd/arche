import { useMemo, useState } from "react";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";

const MAX_AUTO_LINES = 500;

type LineKind = "header" | "addition" | "deletion" | "hunk" | "diff" | "context";

interface ParsedLine {
  kind: LineKind;
  text: string;
  // Source-side line numbers — null when the line belongs to the other side.
  oldLineNo: number | null;
  newLineNo: number | null;
  /** True for the FIRST line of every file (so we can sticky the file header). */
  isFileBoundary?: boolean;
  /** Group identifier (file index) — used to break sticky headers cleanly. */
  fileIndex: number;
}

function parseDiff(diff: string): ParsedLine[] {
  if (!diff) return [];
  const out: ParsedLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  let fileIndex = -1;
  let nextIsFileBoundary = false;

  for (const raw of diff.split("\n")) {
    const line = raw;
    if (line.startsWith("diff ") || (line.startsWith("--- ") && !line.startsWith("--- /"))) {
      fileIndex += 1;
      nextIsFileBoundary = true;
    }
    let kind: LineKind;
    if (line.startsWith("+++") || line.startsWith("---")) kind = "header";
    else if (line.startsWith("@@")) {
      kind = "hunk";
      // Parse the hunk header to reset line numbers
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) {
        oldNo = parseInt(m[1]!, 10) - 1;
        newNo = parseInt(m[2]!, 10) - 1;
      }
    } else if (line.startsWith("diff ")) kind = "diff";
    else if (line.startsWith("+")) kind = "addition";
    else if (line.startsWith("-")) kind = "deletion";
    else kind = "context";

    let oldLineNo: number | null = null;
    let newLineNo: number | null = null;
    if (kind === "context") {
      oldNo += 1;
      newNo += 1;
      oldLineNo = oldNo;
      newLineNo = newNo;
    } else if (kind === "addition") {
      newNo += 1;
      newLineNo = newNo;
    } else if (kind === "deletion") {
      oldNo += 1;
      oldLineNo = oldNo;
    }

    out.push({
      kind,
      text: line,
      oldLineNo,
      newLineNo,
      fileIndex: Math.max(fileIndex, 0),
      isFileBoundary: nextIsFileBoundary && (kind === "diff" || kind === "header"),
    });
    if (kind !== "diff" && kind !== "header") nextIsFileBoundary = false;
  }
  return out;
}

function lineStyle(kind: LineKind): React.CSSProperties {
  switch (kind) {
    case "header":
      return {
        color: "var(--c-bone)",
        background: "var(--surface-2)",
        fontWeight: 700,
      };
    case "diff":
      return {
        color: "var(--c-fog-300)",
        background: "var(--surface-2)",
        fontWeight: 700,
      };
    case "hunk":
      return {
        color: "var(--c-blue-200)",
        background: "var(--c-blue-950)",
      };
    case "addition":
      return {
        color: "var(--c-success-fg)",
        background: "var(--c-success-bg)",
      };
    case "deletion":
      return {
        color: "var(--c-error-fg)",
        background: "var(--c-error-bg)",
      };
    case "context":
    default:
      return { color: "var(--c-fog-300)" };
  }
}

function lineSymbol(kind: LineKind): string {
  switch (kind) {
    case "addition": return "+";
    case "deletion": return "−";
    case "hunk":     return "·";
    default:         return " ";
  }
}

export function DiffViewer({ diffExcerpt }: { diffExcerpt: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const lines = useMemo(() => parseDiff(diffExcerpt || ""), [diffExcerpt]);

  const stats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const l of lines) {
      if (l.kind === "addition") additions++;
      else if (l.kind === "deletion") deletions++;
    }
    return { additions, deletions };
  }, [lines]);

  if (!diffExcerpt) {
    return (
      <p
        style={{
          fontSize: "var(--text-body-sm)",
          color: "var(--c-steel-300)",
          padding: "16px 0",
          textAlign: "center",
        }}
      >
        No diff available yet.
      </p>
    );
  }

  const isLarge = lines.length > MAX_AUTO_LINES;
  const visibleLines = isLarge && !expanded ? lines.slice(0, MAX_AUTO_LINES) : lines;
  const hiddenCount = lines.length - visibleLines.length;

  return (
    <div>
      {/* Stats bar */}
      <div
        className="flex items-center"
        style={{
          gap: 10,
          marginBottom: 12,
          fontSize: "var(--text-body-sm)",
          color: "var(--c-fog-300)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>{lines.length.toLocaleString()} lines</span>
        {stats.additions > 0 && (
          <Badge tone="success" size="md">
            +{stats.additions.toLocaleString()}
          </Badge>
        )}
        {stats.deletions > 0 && (
          <Badge tone="danger" size="md">
            −{stats.deletions.toLocaleString()}
          </Badge>
        )}
        {isLarge && (
          <span
            style={{ marginLeft: "auto", color: "var(--c-steel-300)", fontSize: 11 }}
          >
            {expanded
              ? "Showing all"
              : `Showing first ${MAX_AUTO_LINES.toLocaleString()} of ${lines.length.toLocaleString()}`}
          </span>
        )}
      </div>

      <div
        style={{
          background: "var(--surface-1)",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius-md)",
          maxHeight: "60vh",
          overflow: "auto",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          lineHeight: 1.55,
        }}
      >
        {visibleLines.map((line, i) => {
          const isFileHead = line.kind === "header" || line.kind === "diff";
          return (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "44px 44px 16px 1fr",
                alignItems: "stretch",
                ...lineStyle(line.kind),
                position: isFileHead ? "sticky" : undefined,
                top: isFileHead ? 0 : undefined,
                zIndex: isFileHead ? 2 : undefined,
                borderTop: line.isFileBoundary
                  ? "1px solid var(--hairline-strong)"
                  : undefined,
              }}
            >
              {/* Old line number */}
              <span
                aria-hidden="true"
                style={{
                  textAlign: "right",
                  padding: "0 6px 0 8px",
                  color: "var(--c-steel-300)",
                  borderRight: "1px solid var(--hairline)",
                  userSelect: "none",
                  fontVariantNumeric: "tabular-nums",
                  background: "var(--surface-1)",
                }}
              >
                {line.oldLineNo ?? ""}
              </span>
              {/* New line number */}
              <span
                aria-hidden="true"
                style={{
                  textAlign: "right",
                  padding: "0 6px 0 8px",
                  color: "var(--c-steel-300)",
                  borderRight: "1px solid var(--hairline)",
                  userSelect: "none",
                  fontVariantNumeric: "tabular-nums",
                  background: "var(--surface-1)",
                }}
              >
                {line.newLineNo ?? ""}
              </span>
              {/* Symbol gutter */}
              <span
                aria-hidden="true"
                style={{
                  textAlign: "center",
                  fontWeight: 700,
                  userSelect: "none",
                  color: "currentColor",
                  opacity: 0.7,
                }}
              >
                {lineSymbol(line.kind)}
              </span>
              {/* Text */}
              <span
                style={{
                  padding: "0 8px",
                  whiteSpace: "pre",
                }}
              >
                {/* Strip the leading +/- so the symbol gutter carries it */}
                {line.kind === "addition" || line.kind === "deletion"
                  ? line.text.slice(1) || " "
                  : line.text || " "}
              </span>
            </div>
          );
        })}
      </div>

      {isLarge && !expanded && (
        <div style={{ marginTop: 8 }}>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setExpanded(true)}
          >
            Show full diff ({hiddenCount.toLocaleString()} more lines)
          </Button>
        </div>
      )}
      {isLarge && expanded && (
        <div style={{ marginTop: 8 }}>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setExpanded(false)}
          >
            Collapse to first {MAX_AUTO_LINES.toLocaleString()} lines
          </Button>
        </div>
      )}
    </div>
  );
}
