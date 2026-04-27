import { useCallback, useEffect, useState } from "react";
import type { MetricsSummary, RepoMetrics } from "../types";
import { downloadRunsCsv, fetchMetrics } from "../api/client";
import { useToast } from "../context/ToastContext";
import { formatMs, formatUsd, formatHours } from "../lib/format";

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] p-4 flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-[var(--fg3)]">{label}</span>
      <span className={`text-2xl font-bold leading-none ${accent ?? "text-[var(--color-base-content)]"}`}>
        {value}
      </span>
      {sub && <span className="text-xs text-[var(--fg2)]">{sub}</span>}
    </div>
  );
}

function RepoTable({ repos }: { repos: RepoMetrics[] }) {
  if (repos.length === 0) {
    return (
      <p className="text-xs text-[var(--fg2)] py-4 text-center">No completed runs yet.</p>
    );
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-[var(--fg3)] border-b border-[var(--border-color)]">
          <th scope="col" className="text-left py-2 pr-4 font-medium">Repository</th>
          <th scope="col" className="text-right py-2 px-2 font-medium tabular-nums">Runs</th>
          <th scope="col" className="text-right py-2 px-2 font-medium tabular-nums">Succeeded</th>
          <th scope="col" className="text-right py-2 px-2 font-medium tabular-nums">Success rate</th>
          <th scope="col" className="text-right py-2 px-2 font-medium tabular-nums">Total cost</th>
          <th scope="col" className="text-right py-2 pl-2 font-medium tabular-nums">Avg duration</th>
        </tr>
      </thead>
      <tbody>
        {repos.map((r) => (
          <tr key={r.repoName} className="border-b border-[var(--border-color)] hover:bg-[var(--color-base-300)]">
            <td className="py-2 pr-4 font-mono text-[var(--color-base-content)]">{r.repoName}</td>
            <td className="text-right py-2 px-2 text-[var(--fg2)]">{r.totalRuns}</td>
            <td className="text-right py-2 px-2 text-[#3fb950]">{r.successfulRuns}</td>
            <td className="text-right py-2 px-2">
              <span className={r.successRate >= 70 ? "text-[#3fb950]" : r.successRate >= 40 ? "text-[#d29922]" : "text-[#f85149]"}>
                {r.successRate}%
              </span>
            </td>
            <td className="text-right py-2 px-2 text-[#39d2c0]">{formatUsd(r.totalCostUsd)}</td>
            <td className="text-right py-2 pl-2 text-[var(--fg2)]">{formatMs(r.avgDurationMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const PERIOD_OPTIONS: Array<{ label: string; days: number | null }> = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "All", days: null },
];

export function MetricsView() {
  const toast = useToast();
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoursPerTicket, setHoursPerTicket] = useState(4);
  const [days, setDays] = useState<number | null>(30);

  const load = useCallback(async (d: number | null) => {
    setLoading(true);
    try {
      setMetrics(await fetchMetrics(d ?? undefined));
    } catch (e) {
      toast.error("Failed to load metrics: " + (e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(days); }, [load, days]);

  const timeSavedMs = metrics ? metrics.successfulRuns * hoursPerTicket * 3_600_000 : 0;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-base font-semibold text-[var(--color-base-content)]">Metrics & ROI</h2>
        <div className="flex items-center gap-2">
          <div className="flex bg-[var(--color-base-300)] rounded-[var(--rounded-box)] p-0.5 gap-0.5">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                onClick={() => setDays(opt.days)}
                className={`text-[10px] px-2 py-1 rounded transition-colors ${
                  days === opt.days
                    ? "bg-[var(--color-base-100)] text-[var(--color-base-content)] font-semibold"
                    : "text-[var(--fg2)] hover:text-[var(--color-base-content)]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => load(days)}
            className="text-xs text-[var(--fg2)] hover:text-[var(--color-base-content)] transition-colors"
          >
            Refresh
          </button>
          <button
            onClick={() => downloadRunsCsv([])}
            className="text-xs text-[var(--fg2)] hover:text-[var(--color-base-content)] transition-colors"
            title="Export all runs as CSV"
          >
            Export CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-xs text-[var(--fg2)]">Loading…</div>
      ) : metrics ? (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <KpiCard
              label="Runs completed"
              value={`${metrics.successfulRuns} / ${metrics.totalRuns}`}
              sub={`${metrics.successRate}% success rate`}
              accent="text-[#3fb950]"
            />
            <KpiCard
              label="Total LLM cost"
              value={formatUsd(metrics.totalCostUsd)}
              sub={`avg ${formatUsd(metrics.avgCostUsd)} / run`}
              accent="text-[#39d2c0]"
            />
            <KpiCard
              label="Avg run duration"
              value={formatMs(metrics.avgDurationMs)}
              sub={`${(metrics.totalPromptTokens + metrics.totalCompletionTokens).toLocaleString()} tokens total`}
            />
            <div className="bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] p-4 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-[var(--fg3)]">Time saved (est.)</span>
              <span className="text-2xl font-bold leading-none text-[#58a6ff]">
                {formatHours(timeSavedMs)}
              </span>
              <div className="flex items-center gap-1 mt-1">
                <label htmlFor="hours-per-ticket" className="text-[10px] text-[var(--fg3)]">@ </label>
                <input
                  id="hours-per-ticket"
                  type="number"
                  name="hours-per-ticket"
                  min={1}
                  max={40}
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label="Hours saved per completed ticket"
                  value={hoursPerTicket}
                  onChange={(e) => setHoursPerTicket(Math.max(1, Number(e.target.value)))}
                  className="w-10 text-[10px] text-center tabular-nums bg-[var(--color-base-100)] border border-[var(--border-color)] rounded px-1 py-0.5 text-[var(--color-base-content)]"
                />
                <span className="text-[10px] text-[var(--fg3)]">h / ticket</span>
              </div>
            </div>
          </div>

          {/* Per-repo breakdown */}
          <div className="bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] p-4">
            <h3 className="text-xs font-semibold text-[var(--fg2)] mb-3 uppercase tracking-wide">By repository</h3>
            <RepoTable repos={metrics.byRepo} />
          </div>
        </>
      ) : null}
    </div>
  );
}
