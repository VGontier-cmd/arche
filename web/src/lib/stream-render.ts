import { renderMarkdown } from "./markdown";

/**
 * Heuristics for rendering live agent stream text. The executor returns prose
 * or markdown; the planner / reviewer / researcher return JSON. We pick a
 * strategy per-shape and degrade gracefully when the payload is still
 * streaming and the JSON isn't closed yet.
 */

const PLANNER_FIELDS = ["planMarkdown", "summary", "architectureNotes", "implementedPlanDelta"];

export type StreamRenderResult = {
  /** Markdown HTML for the "main" rendered view, ready for dangerouslySetInnerHTML. */
  primaryHtml: string | null;
  /** Optional raw text fallback (monospace) when primary rendering isn't useful. */
  rawText: string | null;
  /** True when we found a parseable JSON envelope and pulled out its markdown fields. */
  fromJson: boolean;
};

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

/**
 * Try to parse the accumulated text as JSON. Returns the parsed value or null.
 * Tolerates `{...}` wrapped in code fences (which models sometimes do).
 */
function tryParseJson(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // Strip common code-fence wrappers.
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

/**
 * Pull the most reader-friendly markdown chunk out of a parsed structured
 * payload. Walks both top-level fields (planMarkdown, summary, …) and the
 * first proposal in `proposals[]` to surface what the planner actually plans
 * to do, as opposed to its meta-fields like risks or open questions.
 */
function extractMarkdownFromJson(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;

  for (const field of PLANNER_FIELDS) {
    const v = obj[field];
    if (typeof v === "string" && v.length > 0) return v;
  }

  // Planner returns proposals[] — show the first one's planMarkdown.
  if (Array.isArray(obj.proposals) && obj.proposals.length > 0) {
    const first = obj.proposals[0] as Record<string, unknown>;
    const md = first?.planMarkdown;
    if (typeof md === "string" && md.length > 0) {
      return `### Proposal: ${first.approach ?? ""}\n\n${md}`;
    }
  }

  // Reviewer findings → bullet list.
  if (Array.isArray(obj.findings) && obj.findings.length > 0) {
    const lines: string[] = [];
    if (typeof obj.summary === "string") lines.push(`**Decision: ${obj.decision ?? "?"}** — ${obj.summary}`, "");
    lines.push("**Findings:**");
    for (const f of obj.findings as Array<Record<string, unknown>>) {
      lines.push(`- **${f.title ?? "untitled"}**${f.file ? ` (\`${f.file}\`)` : ""}: ${f.body ?? ""}`);
    }
    return lines.join("\n");
  }

  return null;
}

/**
 * Render a streaming agent text into the best-available view. While the JSON
 * is still arriving, we display the raw partial in monospace; once it parses,
 * we switch to the rich markdown extraction.
 */
export function renderStreamText(text: string): StreamRenderResult {
  if (!text) return { primaryHtml: null, rawText: null, fromJson: false };

  if (looksLikeJson(text)) {
    const parsed = tryParseJson(text);
    if (parsed !== null) {
      const extracted = extractMarkdownFromJson(parsed);
      if (extracted) {
        return { primaryHtml: renderMarkdown(extracted), rawText: null, fromJson: true };
      }
      // Parsed but no human-friendly field — pretty-print as JSON.
      return {
        primaryHtml: null,
        rawText: JSON.stringify(parsed, null, 2),
        fromJson: true,
      };
    }
    // Still streaming — show raw monospace.
    return { primaryHtml: null, rawText: text, fromJson: false };
  }

  // Free-form text → markdown directly.
  return { primaryHtml: renderMarkdown(text), rawText: null, fromJson: false };
}

/**
 * Render a partial tool-call args fragment. While still streaming the model
 * may emit unbalanced JSON; we show it monospace either way.
 */
export function formatToolArgs(text: string): string {
  if (!text) return "";
  const parsed = tryParseJson(text);
  if (parsed !== null) {
    return JSON.stringify(parsed, null, 2);
  }
  return text;
}
