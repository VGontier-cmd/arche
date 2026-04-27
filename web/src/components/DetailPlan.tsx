import { renderMarkdown } from "../lib/markdown";

export function DetailPlan({ planMarkdown }: { planMarkdown: string | null }) {
  if (!planMarkdown) return null;

  return (
    <div className="mb-5">
      <h3 className="text-[11px] font-semibold text-[var(--fg2)] uppercase tracking-wide mb-2">
        Plan
      </h3>
      <div
        className="arche-prose max-h-[600px] overflow-auto bg-[var(--color-base-200)] p-3 rounded-[var(--rounded-box)]"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(planMarkdown) }}
      />
    </div>
  );
}
