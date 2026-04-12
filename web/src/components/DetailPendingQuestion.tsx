export function DetailPendingQuestion({
  pendingQuestion,
}: {
  pendingQuestion: string | null;
}) {
  if (!pendingQuestion) return null;

  return (
    <div className="mb-5">
      <h3 className="text-[11px] font-semibold text-[var(--fg2)] uppercase tracking-wide mb-2">
        Pending Question
      </h3>
      <pre className="whitespace-pre-wrap text-[#d29922] text-xs bg-[var(--color-base-200)] p-2 rounded-[var(--rounded-box)]">
        {pendingQuestion}
      </pre>
    </div>
  );
}
