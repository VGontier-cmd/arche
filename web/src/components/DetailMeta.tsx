import { useState } from "react";
import type { DashboardRun } from "../types";
import { formatCost, formatDuration, formatTime } from "../lib/format";

export function DetailMeta({
  run,
  jiraBaseUrl,
  onViewTicketHistory,
}: {
  run: DashboardRun;
  jiraBaseUrl?: string | null;
  onViewTicketHistory?: (ticketKey: string) => void;
}) {
  const rows: Array<{ label: string; value: string; color?: string; copyable?: boolean }> = [
    { label: "Run ID", value: run.id, copyable: true },
    { label: "Repository", value: run.repoName || "-" },
    { label: "Branch", value: run.branchName || "-", copyable: !!run.branchName },
    {
      label: "Phase",
      value: `${run.currentRole || "-"} cycle ${run.currentCycle}`,
    },
    { label: "Worker", value: run.workerId || "-" },
    { label: "Started", value: formatTime(run.startedAt) },
    {
      label: "Duration",
      value: formatDuration(run.startedAt, run.finishedAt),
    },
  ];

  if (run.estimatedCostUsd !== null && run.estimatedCostUsd !== undefined) {
    rows.push({
      label: "Cost",
      value: formatCost(run.estimatedCostUsd),
      color: "text-[#39d2c0]",
    });
  }

  if (run.promptTokens) {
    rows.push({
      label: "Tokens",
      value: `${run.promptTokens?.toLocaleString() || 0} in / ${run.completionTokens?.toLocaleString() || 0} out`,
    });
  }

  return (
    <div className="mb-5">
      <h3 className="text-[11px] font-semibold text-[var(--fg2)] uppercase tracking-wide mb-2">
        Details
      </h3>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {rows.map((row) => (
          <Row key={row.label} {...row} />
        ))}
        {run.ticketKey && (
          <>
            <span className="text-[var(--fg2)]">Ticket</span>
            <span className="flex items-center gap-2">
              {jiraBaseUrl ? (
                <a
                  href={`${jiraBaseUrl}/browse/${run.ticketKey}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#58a6ff] hover:underline"
                >
                  {run.ticketKey}
                </a>
              ) : (
                <span>{run.ticketKey}</span>
              )}
              {onViewTicketHistory && (
                <button
                  onClick={() => onViewTicketHistory(run.ticketKey)}
                  className="btn-default"
                  style={{ padding: "1px 8px", fontSize: "11px" }}
                >
                  History
                </button>
              )}
            </span>
          </>
        )}
        {run.failureReason && (
          <>
            <span className="text-[var(--fg2)]">Failure</span>
            <span className="text-[#f85149]">{run.failureReason}</span>
          </>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  color,
  copyable,
}: {
  label: string;
  value: string;
  color?: string;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <>
      <span className="text-[var(--fg2)]">{label}</span>
      <span className={`${color || "text-[var(--color-base-content)]"} flex items-center gap-1.5 group`}>
        <span className="truncate">{value}</span>
        {copyable && (
          <button
            onClick={handleCopy}
            className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-[var(--fg3)] hover:text-[#58a6ff] shrink-0"
            title="Copy"
          >
            {copied ? "✓" : "⎘"}
          </button>
        )}
      </span>
    </>
  );
}
