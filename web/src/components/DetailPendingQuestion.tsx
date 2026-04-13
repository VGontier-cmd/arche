import type { ReviewFinding } from "../types";

const ROLE_LABELS: Record<string, string> = {
  planner: "Planner needs clarification",
  executor: "Executor is blocked",
  reviewer: "Reviewer needs clarification",
};

// currentRole=executor + pendingQuestion triggered by reviewer = reviewer requested changes after auto-retry
function isReviewerRequestChanges(currentRole: string | null | undefined, pendingQuestion: string | null) {
  return (
    currentRole === "executor" &&
    pendingQuestion?.includes("Reviewer requested changes") === true
  );
}

export function DetailPendingQuestion({
  pendingQuestion,
  currentRole,
  latestFindings,
}: {
  pendingQuestion: string | null;
  currentRole?: string | null;
  latestFindings?: ReviewFinding[];
}) {
  if (!pendingQuestion) return null;

  const reviewerDriven = isReviewerRequestChanges(currentRole, pendingQuestion);
  const sectionTitle = reviewerDriven
    ? "Action required — reviewer findings"
    : (currentRole ? ROLE_LABELS[currentRole] : "Pending question") ?? "Pending question";

  const contextNote = reviewerDriven
    ? "The AI executor attempted to fix the reviewer's issues automatically but was unable to fully resolve them. Please review the findings below and provide guidance to resume execution."
    : null;

  const findings = latestFindings?.length ? latestFindings : null;

  return (
    <div className="mb-5">
      <h3 className="text-[11px] font-semibold text-[var(--fg2)] uppercase tracking-wide mb-2">
        {sectionTitle}
      </h3>
      {contextNote && (
        <p className="text-[11px] text-[var(--fg2)] mb-2">{contextNote}</p>
      )}
      <pre className="whitespace-pre-wrap text-[#d29922] text-xs bg-[var(--color-base-200)] p-2 rounded-[var(--rounded-box)] mb-2">
        {pendingQuestion}
      </pre>
      {findings && (
        <div className="space-y-2">
          {findings.map((f, i) => (
            <div
              key={i}
              className="border border-[#f8514930] rounded-[var(--rounded-box)] bg-[#3c111620] p-2"
            >
              <p className="text-[11px] font-semibold text-[#f85149] mb-1">
                {f.title}
                {f.file && <span className="font-normal text-[var(--fg2)] ml-1">({f.file})</span>}
              </p>
              <pre className="whitespace-pre-wrap text-xs text-[var(--fg2)]">{f.body}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
