import { memo, useEffect, useRef, useState } from "react";
import {
  Check,
  CircleDashed,
  Eye,
  Hammer,
  Search,
  Upload,
  type LucideIcon,
} from "lucide-react";
import type { DashboardRun } from "../types";
import { Card } from "./ui/Card";

/**
 * Big "what's happening" headline + live cost ticker.
 *
 * Visual identity contract:
 * - Headline runs in the display face (the only display-face moment in the
 *   pane), tone-driven via the same status palette as StatusPill.
 * - Phase diagram swaps the round dots for keystone-shaped wedges so the
 *   architecture metaphor recurs at the run level.
 * - Cost ticker promoted to display-lg gold for prominence; it's the
 *   "odometer" of the demo.
 */

type PhaseConfig = {
  key: string;
  label: string;
  Icon: LucideIcon;
  statuses: string[];
};

const PHASES: PhaseConfig[] = [
  { key: "research", label: "Research",   Icon: Search,       statuses: ["researching"] },
  { key: "plan",     label: "Plan",       Icon: CircleDashed, statuses: ["planning", "awaiting_plan_approval"] },
  { key: "execute",  label: "Execute",    Icon: Hammer,       statuses: ["executing"] },
  { key: "review",   label: "Review",     Icon: Eye,          statuses: ["reviewing", "awaiting_publish_approval"] },
  { key: "publish",  label: "Publish",    Icon: Upload,       statuses: ["publishing", "publish_approved", "pushed", "success"] },
];

const TERMINAL = new Set(["success", "pushed"]);
const HUMAN_GATES = new Set(["awaiting_plan_approval", "awaiting_publish_approval", "needs_human_input"]);

function activePhaseIndex(status: string): number {
  for (let i = 0; i < PHASES.length; i++) {
    if (PHASES[i].statuses.includes(status)) return i;
  }
  return -1;
}

type Tone = "active" | "wait" | "done" | "fail";

function statusHeadline(
  status: string,
  role: string | null,
): { text: string; tone: Tone } {
  switch (status) {
    case "pending":                   return { text: "Queued — waiting for a worker", tone: "wait" };
    case "researching":               return { text: "Reading the codebase…", tone: "active" };
    case "planning":                  return { text: "Drafting an implementation plan…", tone: "active" };
    case "awaiting_plan_approval":    return { text: "Plan ready — your approval needed", tone: "wait" };
    case "executing":                 return { text: "Implementing the changes…", tone: "active" };
    case "reviewing":                 return { text: "Reviewing the diff…", tone: "active" };
    case "awaiting_publish_approval": return { text: "Diff approved — ready to ship", tone: "wait" };
    case "needs_human_input":         return { text: `Needs your input${role ? ` (${role})` : ""}`, tone: "wait" };
    case "publishing":                return { text: "Pushing to remote…", tone: "active" };
    case "publish_approved":          return { text: "Publish approved — pushing…", tone: "active" };
    case "pushed":                    return { text: "Pushed — opening MR/PR", tone: "active" };
    case "success":                   return { text: "Shipped", tone: "done" };
    case "failed":                    return { text: "Run failed", tone: "fail" };
    case "cancelled":                 return { text: "Cancelled", tone: "fail" };
    case "publish_rejected":          return { text: "Publish rejected", tone: "fail" };
    default:                          return { text: status, tone: "wait" };
  }
}

function toneColor(tone: Tone): string {
  switch (tone) {
    case "active": return "var(--c-blue-200)";
    case "wait":   return "var(--c-gold-300)";
    case "done":   return "var(--c-success-fg)";
    case "fail":   return "var(--c-error-fg)";
  }
}

function toneAccent(tone: Tone): "primary" | "accent" | "success" | "error" {
  switch (tone) {
    case "active": return "primary";
    case "wait":   return "accent";
    case "done":   return "success";
    case "fail":   return "error";
  }
}

export const RunHeadline = memo(function RunHeadline({ run }: { run: DashboardRun }) {
  const phaseIdx = activePhaseIndex(run.status);
  const isTerminalSuccess = TERMINAL.has(run.status);
  const isHumanGate = HUMAN_GATES.has(run.status);
  const headline = statusHeadline(run.status, run.currentRole);
  const headlineColor = toneColor(headline.tone);

  return (
    <Card
      tone="default"
      accent={toneAccent(headline.tone)}
      padding={4}
      glow={headline.tone === "active" ? "blue" : headline.tone === "wait" ? "gold" : undefined}
      className="mb-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div
            aria-live="polite"
            className="flex items-center"
            style={{
              gap: 8,
              fontFamily: "var(--font-display)",
              fontSize: "var(--text-display-md)",
              fontWeight: 700,
              letterSpacing: "-0.015em",
              lineHeight: 1.2,
              color: headlineColor,
            }}
          >
            <span>{headline.text}</span>
            {headline.tone === "active" && (
              <span
                aria-hidden="true"
                style={{
                  display: "inline-block",
                  width: 3,
                  height: 18,
                  background: "currentColor",
                  animation: "pulse 1.4s var(--ease-in-out) infinite",
                }}
              />
            )}
          </div>
          <div style={{ marginTop: 14 }}>
            <PhaseDiagram
              activeIdx={phaseIdx}
              terminalSuccess={isTerminalSuccess}
              humanGate={isHumanGate}
            />
          </div>
        </div>
        <CostTicker value={run.estimatedCostUsd} />
      </div>
    </Card>
  );
});

function PhaseDot({
  state,
  Icon,
}: {
  state: "complete" | "active" | "wait" | "future";
  Icon: LucideIcon;
}) {
  const fg =
    state === "complete"
      ? "var(--c-success-fg)"
      : state === "active"
      ? "var(--c-blue-200)"
      : state === "wait"
      ? "var(--c-gold-300)"
      : "var(--c-steel-300)";
  const bg =
    state === "complete"
      ? "var(--c-success-bg)"
      : state === "active"
      ? "var(--c-blue-950)"
      : state === "wait"
      ? "var(--c-gold-900)"
      : "var(--surface-2)";
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        flexShrink: 0,
        background: bg,
        color: fg,
        borderRadius: "50%",
      }}
    >
      {state === "complete" ? (
        <Check size={12} strokeWidth={3} />
      ) : (
        <Icon size={12} strokeWidth={2.25} />
      )}
    </span>
  );
}

function PhaseDiagram({
  activeIdx,
  terminalSuccess,
  humanGate,
}: {
  activeIdx: number;
  terminalSuccess: boolean;
  humanGate: boolean;
}) {
  return (
    <div className="flex items-center" style={{ gap: 4 }}>
      {PHASES.map((phase, i) => {
        const isActive = i === activeIdx;
        const isComplete = terminalSuccess || (activeIdx >= 0 && i < activeIdx);
        const state: "complete" | "active" | "wait" | "future" = isComplete
          ? "complete"
          : isActive
          ? humanGate
            ? "wait"
            : "active"
          : "future";
        const lineColor = isComplete
          ? "var(--c-success-fg)"
          : "var(--hairline)";
        return (
          <div key={phase.key} className="flex items-center" style={{ gap: 6, flex: 1 }}>
            <PhaseDot state={state} Icon={phase.Icon} />
            <span
              style={{
                fontSize: 10,
                fontWeight: isActive ? 700 : 500,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: isActive
                  ? "var(--c-fog-100)"
                  : isComplete
                  ? "var(--c-success-fg)"
                  : "var(--c-steel-300)",
                whiteSpace: "nowrap",
              }}
            >
              {phase.label}
            </span>
            {i < PHASES.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 1,
                  background: lineColor,
                  minWidth: 8,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Animates from the previous cost value to the new one over ~600 ms so the
 * dollar figure ticks up smoothly during a demo instead of jumping.
 */
function CostTicker({ value }: { value: number | string | null | undefined }) {
  const numeric = value === null || value === undefined ? null : Number(value);
  const [displayed, setDisplayed] = useState<number>(numeric ?? 0);
  const fromRef = useRef<number>(numeric ?? 0);
  const targetRef = useRef<number>(numeric ?? 0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (numeric === null) return;
    if (numeric === targetRef.current) return;
    fromRef.current = displayed;
    targetRef.current = numeric;
    const startTime = performance.now();
    const durationMs = 600;
    const tick = () => {
      const t = Math.min(1, (performance.now() - startTime) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = fromRef.current + (targetRef.current - fromRef.current) * eased;
      setDisplayed(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // `displayed` is intentionally omitted: it's the animation source value
    // captured into fromRef on each new target, and including it would cause
    // the tween to restart every frame.
  }, [numeric]);

  const labelStyle: React.CSSProperties = {
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--c-fog-300)",
    fontWeight: 600,
  };
  const valueStyle = (color: string): React.CSSProperties => ({
    fontFamily: "var(--font-display)",
    fontSize: "var(--text-display-lg)",
    fontWeight: 700,
    letterSpacing: "-0.02em",
    lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
    color,
    marginTop: 4,
  });

  if (numeric === null) {
    return (
      <div className="text-right shrink-0">
        <div style={labelStyle}>Cost</div>
        <div style={valueStyle("var(--c-steel-300)")}>$0.0000</div>
      </div>
    );
  }
  return (
    <div
      className="text-right shrink-0"
      title={`Cumulative LLM cost: $${numeric.toFixed(6)}`}
    >
      <div style={labelStyle}>Cost</div>
      <div style={valueStyle("var(--c-gold-300)")}>${displayed.toFixed(4)}</div>
    </div>
  );
}
