import type { ReviewFinding } from "../types";
import { Card } from "./ui/Card";

const ROLE_LABELS: Record<string, string> = {
  planner: "Planner needs clarification",
  executor: "Executor is blocked",
  reviewer: "Reviewer needs clarification",
};

function isReviewerRequestChanges(
  currentRole: string | null | undefined,
  pendingQuestion: string | null,
) {
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
    : (currentRole ? ROLE_LABELS[currentRole] : "Pending question") ??
      "Pending question";

  const contextNote = reviewerDriven
    ? "The executor attempted to fix the reviewer's issues automatically but was unable to fully resolve them. Review the findings below and provide guidance to resume execution."
    : null;

  const findings = latestFindings?.length ? latestFindings : null;

  return (
    <section style={{ marginBottom: 20 }} aria-labelledby="pending-question-heading">
      <Card tone="default" accent="accent" glow="gold" padding={4}>
        <h3
          id="pending-question-heading"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-heading-md)",
            fontWeight: 700,
            color: "var(--c-gold-300)",
            letterSpacing: "-0.005em",
            marginBottom: 8,
          }}
        >
          {sectionTitle}
        </h3>
        {contextNote && (
          <p
            style={{
              fontSize: "var(--text-body-sm)",
              color: "var(--c-fog-300)",
              marginBottom: 10,
              lineHeight: 1.5,
            }}
          >
            {contextNote}
          </p>
        )}
        <pre
          style={{
            whiteSpace: "pre-wrap",
            color: "var(--c-gold-300)",
            fontSize: "var(--text-body-sm)",
            fontFamily: "var(--font-mono)",
            background: "var(--surface-2)",
            border: "1px solid var(--c-gold-700)",
            padding: "10px 12px",
            borderRadius: "var(--radius-sm)",
            marginBottom: findings ? 10 : 0,
            lineHeight: 1.5,
          }}
        >
          {pendingQuestion}
        </pre>
        {findings && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {findings.map((f, i) => (
              <div
                key={i}
                style={{
                  border: "1px solid var(--c-error-fg)",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--c-error-bg)",
                  padding: "10px 12px",
                }}
              >
                <p
                  style={{
                    fontSize: "var(--text-body-sm)",
                    fontWeight: 700,
                    color: "var(--c-error-fg)",
                    marginBottom: 6,
                  }}
                >
                  {f.title}
                  {f.file && (
                    <span
                      style={{
                        fontWeight: 400,
                        color: "var(--c-fog-300)",
                        marginLeft: 6,
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      ({f.file})
                    </span>
                  )}
                </p>
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    fontSize: "var(--text-body-sm)",
                    color: "var(--c-fog-100)",
                    fontFamily: "var(--font-mono)",
                    margin: 0,
                    lineHeight: 1.5,
                  }}
                >
                  {f.body}
                </pre>
              </div>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}
