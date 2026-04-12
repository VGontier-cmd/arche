import type { DashboardRun } from "../types";
import { formatCost, formatDuration, formatTime } from "../lib/format";

export function DetailMeta({ run, jiraBaseUrl }: { run: DashboardRun; jiraBaseUrl?: string | null }) {
  const rows: Array<{ label: string; value: string; color?: string }> = [
    { label: "Run ID", value: run.id },
    { label: "Repository", value: run.repoName || "-" },
    { label: "Branch", value: run.branchName || "-" },
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
        {jiraBaseUrl && run.ticketKey && (
          <>
            <span className="text-[var(--fg2)]">Ticket</span>
            <span>
              <a
                href={`${jiraBaseUrl}/browse/${run.ticketKey}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#58a6ff] hover:underline"
              >
                {run.ticketKey}
              </a>
            </span>
          </>
        )}
        {run.mrUrl && (
          <>
            <span className="text-[var(--fg2)]">MR</span>
            <span>
              <a
                href={run.mrUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#58a6ff] hover:underline"
              >
                {run.mrUrl}
              </a>
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
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <>
      <span className="text-[var(--fg2)]">{label}</span>
      <span className={color || "text-[var(--color-base-content)]"}>
        {value}
      </span>
    </>
  );
}
