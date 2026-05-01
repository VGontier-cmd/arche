import { renderMarkdown } from "../lib/markdown";
import { SectionHeading } from "./ui/SectionHeading";

export function DetailPlan({ planMarkdown }: { planMarkdown: string | null }) {
  if (!planMarkdown) return null;

  return (
    <section style={{ marginBottom: 20 }} aria-labelledby="plan-heading">
      <SectionHeading id="plan-heading">Plan</SectionHeading>
      <div
        className="arche-prose"
        style={{
          maxHeight: 600,
          overflow: "auto",
          padding: "16px 18px",
          background: "var(--surface-1)",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius-md)",
          // A faint left rail in steel blue gives the plan panel a quiet
          // "annotated text" feel, distinct from the diff viewer.
          borderLeft: "3px solid var(--c-blue-700)",
        }}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(planMarkdown) }}
      />
    </section>
  );
}
