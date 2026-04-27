import { useMemo, useState } from "react";

const MAX_AUTO_LINES = 500;

function computeDiffStats(lines: string[]) {
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { additions, deletions };
}

function classifyLine(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "font-bold text-[var(--color-base-content)]";
  if (line.startsWith("+")) return "text-[#3fb950] bg-[#3fb95015]";
  if (line.startsWith("-")) return "text-[#f85149] bg-[#f8514915]";
  if (line.startsWith("@@")) return "text-[#58a6ff]";
  if (line.startsWith("diff ")) return "font-bold text-[var(--fg2)] mt-2";
  return "text-[var(--fg2)]";
}

export function DiffViewer({ diffExcerpt }: { diffExcerpt: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const lines = useMemo(() => (diffExcerpt ? diffExcerpt.split("\n") : []), [diffExcerpt]);
  const stats = useMemo(() => computeDiffStats(lines), [lines]);

  if (!diffExcerpt) {
    return (
      <p className="text-xs text-[var(--fg3)] py-4 text-center">No diff available yet.</p>
    );
  }

  const isLarge = lines.length > MAX_AUTO_LINES;
  const visibleLines = isLarge && !expanded ? lines.slice(0, MAX_AUTO_LINES) : lines;
  const hiddenCount = lines.length - visibleLines.length;

  return (
    <div>
      {/* Stats bar */}
      <div className="flex items-center gap-3 mb-3 text-xs text-[var(--fg2)]">
        <span>{lines.length.toLocaleString()} lines</span>
        {stats.additions > 0 && <span className="text-[#3fb950] font-semibold">+{stats.additions}</span>}
        {stats.deletions > 0 && <span className="text-[#f85149] font-semibold">−{stats.deletions}</span>}
        {isLarge && (
          <span className="ml-auto text-[var(--fg3)]">
            {expanded ? "Showing all" : `Showing first ${MAX_AUTO_LINES.toLocaleString()} of ${lines.length.toLocaleString()}`}
          </span>
        )}
      </div>

      <pre className="text-[11px] overflow-auto bg-[var(--color-base-200)] border border-[var(--border-color)] p-3 rounded-[var(--rounded-box)] leading-relaxed max-h-[60vh]">
        {visibleLines.map((line, i) => (
          <div key={i} className={classifyLine(line)}>
            {line || "\u00A0"}
          </div>
        ))}
      </pre>

      {isLarge && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 px-3 py-1.5 text-xs rounded-[var(--rounded-btn)] border border-[var(--border-color)] bg-[var(--color-base-200)] text-[var(--fg2)] hover:bg-[var(--color-base-300)] transition-colors"
        >
          Show full diff ({hiddenCount.toLocaleString()} more lines)
        </button>
      )}
      {isLarge && expanded && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-2 px-3 py-1.5 text-xs rounded-[var(--rounded-btn)] border border-[var(--border-color)] bg-[var(--color-base-200)] text-[var(--fg2)] hover:bg-[var(--color-base-300)] transition-colors"
        >
          Collapse to first {MAX_AUTO_LINES.toLocaleString()} lines
        </button>
      )}
    </div>
  );
}
