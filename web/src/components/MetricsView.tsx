import { useCallback, useEffect, useState } from "react";
import type { MetricsSummary, RepoMetrics } from "../types";
import { downloadRunsCsv, fetchMetrics } from "../api/client";
import { useToast } from "../context/ToastContext";
import { formatMs, formatUsd, formatHours } from "../lib/format";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { SectionHeading } from "./ui/SectionHeading";

type Tone = "primary" | "success" | "info" | "warning" | "error";

const TONE_COLOR: Record<Tone, string> = {
  primary: "var(--c-blue-200)",
  success: "var(--c-success-fg)",
  info:    "var(--c-info-fg)",
  warning: "var(--c-warning-fg)",
  error:   "var(--c-error-fg)",
};

function KpiCard({
  label,
  value,
  sub,
  tone = "primary",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
}) {
  return (
    <Card tone="default" padding={4}>
      <span
        style={{
          fontSize: "var(--text-label-sm)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--c-steel-300)",
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <div
        className="tabular"
        style={{
          fontSize: "var(--text-display-md)",
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
          color: TONE_COLOR[tone],
          marginTop: 4,
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontSize: "var(--text-body-sm)",
            color: "var(--c-fog-300)",
            marginTop: 4,
          }}
        >
          {sub}
        </div>
      )}
    </Card>
  );
}

function RepoTable({ repos }: { repos: RepoMetrics[] }) {
  if (repos.length === 0) {
    return (
      <p
        style={{
          fontSize: "var(--text-body-sm)",
          color: "var(--c-fog-300)",
          padding: "16px 0",
          textAlign: "center",
        }}
      >
        No completed runs yet.
      </p>
    );
  }

  return (
    <table
      style={{
        width: "100%",
        fontSize: "var(--text-body-sm)",
        borderCollapse: "collapse",
      }}
    >
      <thead>
        <tr
          style={{
            color: "var(--c-steel-300)",
            borderBottom: "1px solid var(--hairline)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            fontSize: "var(--text-label-sm)",
          }}
        >
          <th scope="col" style={{ textAlign: "left", padding: "10px 16px 10px 0", fontWeight: 600 }}>Repository</th>
          <th scope="col" className="tabular" style={{ textAlign: "right", padding: "10px 8px", fontWeight: 600 }}>Runs</th>
          <th scope="col" className="tabular" style={{ textAlign: "right", padding: "10px 8px", fontWeight: 600 }}>Succeeded</th>
          <th scope="col" className="tabular" style={{ textAlign: "right", padding: "10px 8px", fontWeight: 600 }}>Success rate</th>
          <th scope="col" className="tabular" style={{ textAlign: "right", padding: "10px 8px", fontWeight: 600 }}>Total cost</th>
          <th scope="col" className="tabular" style={{ textAlign: "right", padding: "10px 0 10px 8px", fontWeight: 600 }}>Avg duration</th>
        </tr>
      </thead>
      <tbody>
        {repos.map((r) => {
          const successColor =
            r.successRate >= 70
              ? "var(--c-success-fg)"
              : r.successRate >= 40
              ? "var(--c-warning-fg)"
              : "var(--c-error-fg)";
          return (
            <tr
              key={r.repoName}
              style={{
                borderBottom: "1px solid var(--hairline)",
                transition: "background var(--dur-fast) var(--ease-out)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--surface-2)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <td
                style={{
                  padding: "10px 16px 10px 0",
                  fontFamily: "var(--font-mono)",
                  color: "var(--c-fog-100)",
                }}
              >
                {r.repoName}
              </td>
              <td className="tabular" style={{ textAlign: "right", padding: "10px 8px", color: "var(--c-fog-300)" }}>
                {r.totalRuns}
              </td>
              <td className="tabular" style={{ textAlign: "right", padding: "10px 8px", color: "var(--c-success-fg)" }}>
                {r.successfulRuns}
              </td>
              <td className="tabular" style={{ textAlign: "right", padding: "10px 8px", color: successColor }}>
                {r.successRate}%
              </td>
              <td className="tabular" style={{ textAlign: "right", padding: "10px 8px", color: "var(--c-gold-300)" }}>
                {formatUsd(r.totalCostUsd)}
              </td>
              <td className="tabular" style={{ textAlign: "right", padding: "10px 0 10px 8px", color: "var(--c-fog-300)" }}>
                {formatMs(r.avgDurationMs)}
              </td>
            </tr>
          );
        })}
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

  const load = useCallback(
    async (d: number | null) => {
      setLoading(true);
      try {
        setMetrics(await fetchMetrics(d ?? undefined));
      } catch (e) {
        toast.error(
          "Failed to load metrics: " + (e instanceof Error ? e.message : e),
        );
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    load(days);
  }, [load, days]);

  const timeSavedMs = metrics
    ? metrics.successfulRuns * hoursPerTicket * 3_600_000
    : 0;

  return (
    <div style={{ padding: 28, maxWidth: 960, margin: "0 auto" }}>
      <div
        className="flex items-center justify-between flex-wrap"
        style={{ marginBottom: 24, gap: 12 }}
      >
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-display-md)",
            fontWeight: 700,
            letterSpacing: "-0.015em",
            color: "var(--c-bone)",
          }}
        >
          Metrics &amp; ROI
        </h2>
        <div className="flex items-center" style={{ gap: 8 }}>
          <div
            role="radiogroup"
            aria-label="Time period"
            className="flex"
            style={{
              background: "var(--surface-2)",
              borderRadius: "var(--radius-sm)",
              padding: 2,
              gap: 2,
            }}
          >
            {PERIOD_OPTIONS.map((opt) => {
              const active = days === opt.days;
              return (
                <button
                  key={opt.label}
                  onClick={() => setDays(opt.days)}
                  role="radio"
                  aria-checked={active}
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: "4px 10px",
                    borderRadius: "var(--radius-xs)",
                    background: active ? "var(--surface-0)" : "transparent",
                    color: active ? "var(--c-bone)" : "var(--c-fog-300)",
                    border: "none",
                    cursor: "pointer",
                    transition:
                      "background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.color = "var(--c-fog-100)";
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.color = "var(--c-fog-300)";
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <Button size="sm" variant="ghost" onClick={() => load(days)}>
            Refresh
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => downloadRunsCsv([])}
            title="Export all runs as CSV"
          >
            Export CSV
          </Button>
        </div>
      </div>

      {loading ? (
        <div
          style={{ fontSize: "var(--text-body-sm)", color: "var(--c-fog-300)" }}
        >
          Loading…
        </div>
      ) : metrics ? (
        <>
          {/* KPI cards */}
          <div
            className="grid grid-cols-2 lg:grid-cols-4"
            style={{ gap: 12, marginBottom: 24 }}
          >
            <KpiCard
              label="Runs completed"
              value={`${metrics.successfulRuns} / ${metrics.totalRuns}`}
              sub={`${metrics.successRate}% success rate`}
              tone="success"
            />
            <KpiCard
              label="Total LLM cost"
              value={formatUsd(metrics.totalCostUsd)}
              sub={`avg ${formatUsd(metrics.avgCostUsd)} / run`}
              tone="info"
            />
            <KpiCard
              label="Avg run duration"
              value={formatMs(metrics.avgDurationMs)}
              sub={`${(
                metrics.totalPromptTokens + metrics.totalCompletionTokens
              ).toLocaleString()} tokens total`}
            />
            <Card tone="default" padding={4}>
              <span
                style={{
                  fontSize: "var(--text-label-sm)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--c-steel-300)",
                  fontWeight: 600,
                }}
              >
                Time saved (est.)
              </span>
              <div
                className="tabular"
                style={{
                  fontSize: "var(--text-display-md)",
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  lineHeight: 1.1,
                  color: "var(--c-blue-200)",
                  marginTop: 4,
                }}
              >
                {formatHours(timeSavedMs)}
              </div>
              <div
                className="flex items-center"
                style={{ gap: 4, marginTop: 6 }}
              >
                <label
                  htmlFor="hours-per-ticket"
                  style={{
                    fontSize: "var(--text-label-sm)",
                    color: "var(--c-steel-300)",
                  }}
                >
                  @
                </label>
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
                  onChange={(e) =>
                    setHoursPerTicket(Math.max(1, Number(e.target.value)))
                  }
                  className="tabular"
                  style={{
                    width: 38,
                    fontSize: 10,
                    textAlign: "center",
                    background: "var(--surface-0)",
                    border: "1px solid var(--hairline)",
                    borderRadius: "var(--radius-xs)",
                    padding: "2px 4px",
                    color: "var(--c-fog-100)",
                    fontFamily: "inherit",
                    outline: "none",
                  }}
                />
                <span
                  style={{
                    fontSize: "var(--text-label-sm)",
                    color: "var(--c-steel-300)",
                  }}
                >
                  h / ticket
                </span>
              </div>
            </Card>
          </div>

          {/* Per-repo breakdown */}
          <Card tone="default" padding={4}>
            <SectionHeading>By repository</SectionHeading>
            <RepoTable repos={metrics.byRepo} />
          </Card>
        </>
      ) : null}
    </div>
  );
}
