import { memo, useEffect, useRef, useState } from "react";
import {
  Check,
  CircleDashed,
  Eye,
  Hammer,
  PartyPopper,
  Search,
  Upload,
  type LucideIcon,
} from "lucide-react";
import type { DashboardRun } from "../types";

/**
 * Big "what's happening" headline + live cost ticker. Sits above the meta
 * grid in the detail pane so audience members watching a demo can instantly
 * see (a) which of the 5 pipeline phases the run is in, (b) what the
 * cumulative LLM bill looks like in real time.
 *
 * The cost is animated with a smooth count-up between snapshots so each
 * SSE-driven refresh feels like a live odometer rather than a value jump.
 */

type PhaseConfig = {
  key: string;
  label: string;
  Icon: LucideIcon;
  /** statuses that map to this phase (excluding terminal) */
  statuses: string[];
};

const PHASES: PhaseConfig[] = [
  { key: "research", label: "Researching", Icon: Search,       statuses: ["researching"] },
  { key: "plan",     label: "Planning",    Icon: CircleDashed, statuses: ["planning", "awaiting_plan_approval"] },
  { key: "execute",  label: "Executing",   Icon: Hammer,       statuses: ["executing"] },
  { key: "review",   label: "Reviewing",   Icon: Eye,          statuses: ["reviewing", "awaiting_publish_approval"] },
  { key: "publish",  label: "Publishing",  Icon: Upload,       statuses: ["publishing", "publish_approved", "pushed", "success"] },
];

const TERMINAL = new Set(["success", "pushed"]);
const HUMAN_GATES = new Set(["awaiting_plan_approval", "awaiting_publish_approval", "needs_human_input"]);

function activePhaseIndex(status: string): number {
  for (let i = 0; i < PHASES.length; i++) {
    if (PHASES[i].statuses.includes(status)) return i;
  }
  return -1;
}

function statusHeadline(status: string, role: string | null): { text: string; tone: "active" | "wait" | "done" | "fail" } {
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

const TONE_STYLES: Record<string, string> = {
  active: "text-[#58a6ff]",
  wait:   "text-[#d29922]",
  done:   "text-[#3fb950]",
  fail:   "text-[#f85149]",
};

export const RunHeadline = memo(function RunHeadline({ run }: { run: DashboardRun }) {
  const phaseIdx = activePhaseIndex(run.status);
  const isTerminalSuccess = TERMINAL.has(run.status);
  const isHumanGate = HUMAN_GATES.has(run.status);
  const headline = statusHeadline(run.status, run.currentRole);

  return (
    <div className="mb-4 flex items-start justify-between gap-4 px-4 py-3 bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)]">
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-semibold leading-snug flex items-center gap-1.5 ${TONE_STYLES[headline.tone] ?? ""}`}>
          {headline.tone === "done" && <PartyPopper size={16} strokeWidth={2} aria-hidden="true" />}
          <span>{headline.text}</span>
          {headline.tone === "active" && (
            <span className="inline-block w-1 h-3 ml-0.5 align-middle bg-current animate-pulse" />
          )}
        </div>
        <div className="mt-2.5">
          <PhaseDiagram activeIdx={phaseIdx} terminalSuccess={isTerminalSuccess} humanGate={isHumanGate} />
        </div>
      </div>
      <CostTicker value={run.estimatedCostUsd} />
    </div>
  );
});

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
    <div className="flex items-center gap-1">
      {PHASES.map((phase, i) => {
        const isActive = i === activeIdx;
        const isComplete = terminalSuccess || (activeIdx >= 0 && i < activeIdx);
        const dotClass = isComplete
          ? "bg-[#3fb950] text-white"
          : isActive
            ? humanGate
              ? "bg-[#d29922] text-white"
              : "bg-[#58a6ff] text-white animate-pulse"
            : "bg-[var(--color-base-300)] text-[var(--fg3)]";
        const lineClass = isComplete ? "bg-[#3fb950]" : "bg-[var(--border-color)]";
        return (
          <div key={phase.key} className="flex items-center gap-1 flex-1">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${dotClass}`}
              title={phase.label}
            >
              {isComplete ? (
                <Check size={12} strokeWidth={3} aria-hidden="true" />
              ) : (
                <phase.Icon size={12} strokeWidth={2.25} aria-hidden="true" />
              )}
            </div>
            <span
              className={`text-[10px] truncate ${
                isActive ? "text-[var(--color-base-content)] font-semibold" : "text-[var(--fg3)]"
              }`}
            >
              {phase.label}
            </span>
            {i < PHASES.length - 1 && <div className={`flex-1 h-px ${lineClass}`} />}
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
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      const next = fromRef.current + (targetRef.current - fromRef.current) * eased;
      setDisplayed(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numeric]);

  if (numeric === null) {
    return (
      <div className="text-right shrink-0">
        <div className="text-[10px] uppercase tracking-wide text-[var(--fg3)]">cost</div>
        <div className="text-2xl font-bold text-[var(--fg3)] tabular-nums leading-none">$0.0000</div>
      </div>
    );
  }
  return (
    <div className="text-right shrink-0" title={`Cumulative LLM cost: $${numeric.toFixed(6)}`}>
      <div className="text-[10px] uppercase tracking-wide text-[var(--fg3)]">cost</div>
      <div className="text-2xl font-bold text-[#39d2c0] tabular-nums leading-none">
        ${displayed.toFixed(4)}
      </div>
    </div>
  );
}
