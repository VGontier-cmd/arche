import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { DashboardRun } from "../types";
import { formatCost, formatDuration, formatTime } from "../lib/format";
import { Button } from "./ui/Button";
import { SectionHeading } from "./ui/SectionHeading";

type Tone = "default" | "info" | "danger";

interface MetaRow {
  label: string;
  value: string;
  tone?: Tone;
  copyable?: boolean;
}

const cellStyle = (divider: boolean): React.CSSProperties => ({
  padding: "8px 14px",
  borderTop: divider ? "1px solid var(--hairline)" : "none",
  minWidth: 0,
});

const labelStyle: React.CSSProperties = {
  fontSize: "var(--text-label-md)",
  color: "var(--c-fog-300)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const TONE_COLOR: Record<Tone, string> = {
  default: "var(--c-fog-100)",
  info:    "var(--c-gold-300)",
  danger:  "var(--c-error-fg)",
};

function valueStyle(tone: Tone = "default"): React.CSSProperties {
  return {
    color: TONE_COLOR[tone],
    fontFamily: "var(--font-mono)",
    fontVariantNumeric: "tabular-nums",
  };
}

export function DetailMeta({
  run,
  jiraBaseUrl,
  onViewTicketHistory,
}: {
  run: DashboardRun;
  jiraBaseUrl?: string | null;
  onViewTicketHistory?: (ticketKey: string) => void;
}) {
  const rows: MetaRow[] = [
    { label: "Run ID",     value: run.id, copyable: true },
    { label: "Repository", value: run.repoName || "—" },
    { label: "Branch",     value: run.branchName || "—", copyable: !!run.branchName },
    {
      label: "Phase",
      value: `${run.currentRole || "—"} cycle ${run.currentCycle}`,
    },
    { label: "Worker",   value: run.workerId || "—" },
    { label: "Started",  value: formatTime(run.startedAt) },
    { label: "Duration", value: formatDuration(run.startedAt, run.finishedAt) },
  ];

  if (run.estimatedCostUsd !== null && run.estimatedCostUsd !== undefined) {
    rows.push({
      label: "Cost",
      value: formatCost(run.estimatedCostUsd),
      tone: "info",
    });
  }

  if (run.promptTokens) {
    rows.push({
      label: "Tokens",
      value: `${run.promptTokens?.toLocaleString() || 0} in / ${run.completionTokens?.toLocaleString() || 0} out`,
    });
  }

  return (
    <section style={{ marginBottom: 20 }} aria-labelledby="meta-heading">
      <SectionHeading id="meta-heading">Details</SectionHeading>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "max-content 1fr",
          fontSize: "var(--text-body-sm)",
          background: "var(--surface-1)",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
        }}
      >
        {rows.map((row, idx) => (
          <Row key={row.label} row={row} divider={idx > 0} />
        ))}

        {run.ticketKey && (
          <>
            <span style={{ ...cellStyle(true), ...labelStyle }}>Ticket</span>
            <span
              style={{
                ...cellStyle(true),
                borderLeft: "1px solid var(--hairline)",
              }}
            >
              <span className="flex items-center" style={{ gap: 8 }}>
                {jiraBaseUrl ? (
                  <a
                    href={`${jiraBaseUrl}/browse/${run.ticketKey}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: "var(--c-blue-400)",
                      fontFamily: "var(--font-display)",
                      fontWeight: 700,
                      letterSpacing: "-0.01em",
                    }}
                    className="hover:underline"
                  >
                    {run.ticketKey}
                  </a>
                ) : (
                  <span
                    style={{
                      fontFamily: "var(--font-display)",
                      fontWeight: 700,
                      color: "var(--c-bone)",
                    }}
                  >
                    {run.ticketKey}
                  </span>
                )}
                {onViewTicketHistory && (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => onViewTicketHistory(run.ticketKey)}
                  >
                    History
                  </Button>
                )}
              </span>
            </span>
          </>
        )}

        {run.failureReason && (
          <>
            <span style={{ ...cellStyle(true), ...labelStyle }}>Failure</span>
            <span
              style={{
                ...cellStyle(true),
                ...valueStyle("danger"),
                borderLeft: "1px solid var(--hairline)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {run.failureReason}
            </span>
          </>
        )}
      </div>
    </section>
  );
}

function Row({ row, divider }: { row: MetaRow; divider: boolean }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(row.value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <>
      <span style={{ ...cellStyle(divider), ...labelStyle }}>{row.label}</span>
      <span
        className="reveal-host"
        style={{
          ...cellStyle(divider),
          ...valueStyle(row.tone),
          borderLeft: "1px solid var(--hairline)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span className="truncate" style={{ minWidth: 0, flex: 1 }}>
          {row.value}
        </span>
        {row.copyable && (
          <button
            onClick={handleCopy}
            className="shrink-0 reveal-target-inline"
            aria-label={`Copy ${row.label}`}
            data-copied={copied || undefined}
            style={{
              color: copied ? "var(--c-success-fg)" : "var(--c-fog-300)",
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              transition:
                "opacity var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)",
            }}
          >
            {copied ? (
              <Check size={11} strokeWidth={2.5} aria-hidden="true" />
            ) : (
              <Copy size={11} strokeWidth={2} aria-hidden="true" />
            )}
          </button>
        )}
      </span>
    </>
  );
}
