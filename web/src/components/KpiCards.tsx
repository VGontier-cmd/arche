import type { DashboardSummary } from "../types";
import { useCountUp } from "../hooks/useCountUp";
import { Card } from "./ui/Card";

type Tone = "primary" | "accent" | "success" | "warning" | "error" | "info";

function KpiTile({
  label,
  value,
  tone,
  tabularValue,
}: {
  label: string;
  value: string | number;
  tone: Tone;
  tabularValue: string;
}) {
  const colorVar: Record<Tone, string> = {
    primary: "var(--c-blue-200)",
    accent:  "var(--c-gold-300)",
    success: "var(--c-success-fg)",
    warning: "var(--c-warning-fg)",
    error:   "var(--c-error-fg)",
    info:    "var(--c-info-fg)",
  };

  return (
    <Card tone="default" padding={3}>
      <div
        style={{
          fontSize: "var(--text-label-md)",
          color: "var(--c-fog-300)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        className="tabular"
        style={{
          marginTop: 4,
          fontSize: "var(--text-display-md)",
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
          color: colorVar[tone],
        }}
        aria-label={`${label}: ${tabularValue}`}
      >
        {value}
      </div>
    </Card>
  );
}

function NumberTile({
  label,
  target,
  tone,
}: {
  label: string;
  target: number;
  tone: Tone;
}) {
  const value = useCountUp(target);
  return (
    <KpiTile
      label={label}
      value={value}
      tone={tone}
      tabularValue={String(target)}
    />
  );
}

export function KpiCards({ summary }: { summary: DashboardSummary }) {
  const creditsDisplay =
    summary.availableCredits !== null
      ? new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 2,
        }).format(summary.availableCredits)
      : "—";

  // Workers tile picks tone based on health
  const workersTone: Tone =
    summary.onlineWorkerCount === 0 && summary.workerCount > 0
      ? "error"
      : summary.onlineWorkerCount < summary.workerCount
      ? "warning"
      : "success";

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-5"
      style={{ gap: 12, padding: "16px 20px 20px" }}
    >
      <NumberTile label="Inbox"  target={summary.inboxCount}  tone="accent" />
      <NumberTile label="Active" target={summary.activeCount} tone="primary" />
      <NumberTile label="Failed" target={summary.failedCount} tone="error" />
      <KpiTile
        label="Workers"
        value={`${summary.onlineWorkerCount}/${summary.workerCount}`}
        tone={workersTone}
        tabularValue={`${summary.onlineWorkerCount} of ${summary.workerCount}`}
      />
      <KpiTile
        label="Credits"
        value={creditsDisplay}
        tone={summary.availableCredits !== null ? "info" : "primary"}
        tabularValue={creditsDisplay}
      />
    </div>
  );
}
