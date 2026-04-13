import { useState } from "react";

const COLLAPSED_LINE_THRESHOLD = 30;

function computeDiffStats(lines: string[]) {
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { additions, deletions };
}

export function DiffViewer({ diffExcerpt }: { diffExcerpt: string | null }) {
  if (!diffExcerpt) return null;

  const lines = diffExcerpt.split("\n");
  const isLong = lines.length > COLLAPSED_LINE_THRESHOLD;
  const [expanded, setExpanded] = useState(!isLong);
  const { additions, deletions } = computeDiffStats(lines);

  return (
    <div className="mb-5">
      <h3
        className="text-[11px] font-semibold text-[var(--fg2)] uppercase tracking-wide mb-2 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        Diff {isLong && (expanded ? "\u25BE" : "\u25B8")}{" "}
        <span className="font-normal ml-1 normal-case">
          ({lines.length} lines
          {additions > 0 && <span className="text-[#3fb950] ml-1">+{additions}</span>}
          {deletions > 0 && <span className="text-[#f85149] ml-1">−{deletions}</span>}
          )
        </span>
      </h3>
      {expanded && (
        <pre className="text-[11px] max-h-[400px] overflow-auto bg-[var(--color-base-200)] border border-[var(--border-color)] p-2 rounded-[var(--rounded-box)] leading-relaxed">
          {lines.map((line, i) => (
            <div key={i} className={classifyLine(line)}>
              {line || "\u00A0"}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

function classifyLine(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "font-bold text-[var(--color-base-content)]";
  if (line.startsWith("+")) return "text-[#3fb950] bg-[#3fb95015]";
  if (line.startsWith("-")) return "text-[#f85149] bg-[#f8514915]";
  if (line.startsWith("@@")) return "text-[#58a6ff]";
  if (line.startsWith("diff ")) return "font-bold text-[var(--fg2)] mt-2";
  return "text-[var(--fg2)]";
}
