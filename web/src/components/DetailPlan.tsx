export function DetailPlan({ planMarkdown }: { planMarkdown: string | null }) {
  if (!planMarkdown) return null;

  return (
    <div className="mb-5">
      <h3 className="text-[11px] font-semibold text-[var(--fg2)] uppercase tracking-wide mb-2">
        Plan
      </h3>
      <pre className="whitespace-pre-wrap text-[var(--fg2)] text-[11px] max-h-[200px] overflow-auto bg-[var(--color-base-200)] p-2 rounded-[var(--rounded-box)]">
        {planMarkdown}
      </pre>
    </div>
  );
}
