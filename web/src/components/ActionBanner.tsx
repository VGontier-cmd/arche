import { useEffect, useState } from "react";
import {
  Diamond,
  FlaskConical,
  MessageCircleQuestion,
  Scale,
  ShieldCheck,
  ThumbsUp,
  type LucideIcon,
} from "lucide-react";
import type { CostEstimate, DashboardRun, PlanProposal } from "../types";
import { fetchCostEstimate } from "../api/client";

type BannerConfig = {
  bg: string;
  border: string;
  text: string;
  Icon: LucideIcon;
  headline: string;
};

const BANNER_CONFIG: Partial<Record<string, BannerConfig>> = {
  awaiting_plan_approval: {
    bg: "bg-[#3b250815]",
    border: "border-[#d2992240]",
    text: "text-[#d29922]",
    Icon: ThumbsUp,
    headline: "Plan ready — review and approve to start execution",
  },
  awaiting_publish_approval: {
    bg: "bg-[#58a6ff10]",
    border: "border-[#58a6ff40]",
    text: "text-[#58a6ff]",
    Icon: ShieldCheck,
    headline: "Ready to ship — approve to push the branch",
  },
  needs_human_input: {
    bg: "bg-[#3b250815]",
    border: "border-[#d2992240]",
    text: "text-[#d29922]",
    Icon: MessageCircleQuestion,
    headline: "Agent is waiting for your input",
  },
};

export function ActionBanner({
  run,
  onAction,
  onOpenRespond,
  pendingAction,
}: {
  run: DashboardRun;
  onAction: (runId: string, action: string) => void;
  onOpenRespond: (runId: string, title: string) => void;
  pendingAction?: string | null;
}) {
  const cfg = BANNER_CONFIG[run.status];
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  const [costError, setCostError] = useState(false);

  useEffect(() => {
    if (run.status !== "awaiting_plan_approval") return;
    setCostError(false);
    fetchCostEstimate(run.id)
      .then(setCostEstimate)
      .catch(() => setCostError(true));
  }, [run.id, run.status]);

  if (!cfg) return null;

  const disabled = pendingAction != null;

  return (
    <div className={`mx-5 mt-4 rounded-[var(--rounded-box)] border ${cfg.bg} ${cfg.border} px-4 py-3`}>
      <div className={`flex items-start gap-2 mb-2.5 ${cfg.text}`}>
        <cfg.Icon size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">{run.ticketKey} — {cfg.headline}</p>
          {run.status === "needs_human_input" && run.pendingQuestion && (
            <p className="text-[11px] mt-1 opacity-80 leading-snug">{run.pendingQuestion}</p>
          )}
          {run.status === "awaiting_plan_approval" && costEstimate && costEstimate.estimatedCostUsd !== null && costEstimate.basedOnRuns > 0 && (
            <p className="text-[10px] mt-1 opacity-60">
              Est. cost: ~${costEstimate.estimatedCostUsd.toFixed(4)} based on {costEstimate.basedOnRuns} past run{costEstimate.basedOnRuns > 1 ? "s" : ""} on {costEstimate.repoName}
            </p>
          )}
          {run.status === "awaiting_plan_approval" && costEstimate && costEstimate.basedOnRuns === 0 && (
            <p className="text-[10px] mt-1 opacity-60">
              Est. cost: — (no historical data yet for this repository)
            </p>
          )}
          {run.status === "awaiting_plan_approval" && costError && (
            <p className="text-[10px] mt-1 opacity-60">
              Est. cost: unavailable
            </p>
          )}
        </div>
      </div>

      {run.status === "awaiting_plan_approval" && run.planProposals && run.planProposals.length > 1 && (
        <PlanProposalCards
          proposals={run.planProposals}
          runId={run.id}
          disabled={disabled}
          onApprove={(idx) => onAction(run.id, `approve-plan:${idx}`)}
          onRequestChanges={() => onOpenRespond(run.id, "Request changes to the plan")}
          onCancel={() => onAction(run.id, "cancel")}
        />
      )}

      <div className="flex gap-2 flex-wrap">
        {run.status === "awaiting_plan_approval" && (!run.planProposals || run.planProposals.length <= 1) && (
          <>
            <button className="btn-primary" disabled={disabled} onClick={() => onAction(run.id, "approve-plan")}>
              Approve Plan
            </button>
            <button className="btn-default" disabled={disabled} onClick={() => onOpenRespond(run.id, "Request changes to the plan")}>
              Request Changes
            </button>
            <button className="btn-danger" disabled={disabled} onClick={() => onAction(run.id, "cancel")}>
              Cancel
            </button>
          </>
        )}

        {run.status === "awaiting_publish_approval" && (
          <>
            <button className="btn-primary" disabled={disabled} onClick={() => onAction(run.id, "approve-publish")}>
              Approve & Ship
            </button>
            <button className="btn-danger" disabled={disabled} onClick={() => onAction(run.id, "reject-publish")}>
              Reject
            </button>
          </>
        )}

        {run.status === "needs_human_input" && (
          <>
            <button className="btn-primary" disabled={disabled} onClick={() => onOpenRespond(run.id, "Respond to the agent")}>
              Respond
            </button>
            <button className="btn-default" disabled={disabled} onClick={() => onAction(run.id, "force-approve")}>
              Force Approve
            </button>
            <button className="btn-danger" disabled={disabled} onClick={() => onAction(run.id, "cancel")}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const APPROACH_LABEL: Record<
  string,
  { label: string; Icon: LucideIcon; desc: string; badge?: string }
> = {
  conservative: { label: "Conservative", Icon: ShieldCheck,  desc: "Minimal changes, lowest risk",   badge: "Lowest risk" },
  balanced:     { label: "Balanced",     Icon: Scale,        desc: "Complete implementation",        badge: "Recommended" },
  thorough:     { label: "Thorough",     Icon: FlaskConical, desc: "Comprehensive + tests",          badge: "Highest coverage" },
};

const APPROACH_FALLBACK = { label: "", Icon: Diamond, desc: "" } as const;

const BADGE_STYLES: Record<string, string> = {
  "Recommended": "bg-[#3fb95020] text-[#3fb950] border-[#3fb95040]",
  "Lowest risk": "bg-[#58a6ff20] text-[#58a6ff] border-[#58a6ff40]",
  "Highest coverage": "bg-[#bc8cff20] text-[#bc8cff] border-[#bc8cff40]",
};

function PlanProposalCards({
  proposals,
  runId,
  disabled,
  onApprove,
  onRequestChanges,
  onCancel,
}: {
  proposals: PlanProposal[];
  runId: string;
  disabled: boolean;
  onApprove: (idx: number) => void;
  onRequestChanges: () => void;
  onCancel: () => void;
}) {
  void runId;
  return (
    <div className="mt-1 mb-2">
      <p className="text-[10px] text-[var(--fg3)] uppercase tracking-wide mb-2">Choose an approach</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
        {proposals.map((p, i) => {
          const meta = APPROACH_LABEL[p.approach] ?? { ...APPROACH_FALLBACK, label: p.approach };
          const badgeClass = "badge" in meta && meta.badge ? BADGE_STYLES[meta.badge] ?? "bg-[var(--color-base-200)] text-[var(--fg2)] border-[var(--border-color)]" : "";
          return (
            <button
              key={p.approach}
              disabled={disabled}
              onClick={() => onApprove(i)}
              className="text-left p-3 rounded-[var(--rounded-box)] border border-[var(--border-color)] bg-[var(--color-base-300)] hover:border-[#58a6ff] hover:bg-[#58a6ff10] transition-colors group"
            >
              <div className="flex items-center gap-1.5 mb-1">
                <meta.Icon size={14} strokeWidth={2} className="text-[#58a6ff]" aria-hidden="true" />
                <span className="text-xs font-semibold text-[var(--color-base-content)] group-hover:text-[#58a6ff]">
                  {meta.label}
                </span>
                <span className="ml-auto text-[9px] text-[var(--fg3)]">~{p.estimatedSteps} steps</span>
              </div>
              {"badge" in meta && meta.badge && (
                <span className={`inline-block px-1.5 py-0.5 mb-1 text-[9px] font-semibold uppercase tracking-wide rounded border ${badgeClass}`}>
                  {meta.badge}
                </span>
              )}
              <p className="text-[10px] text-[var(--fg2)]">{meta.desc}</p>
              {p.risks.length > 0 && (
                <p className="text-[10px] text-[#d29922] mt-1">{p.risks.length} risk{p.risks.length > 1 ? "s" : ""}</p>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <button className="btn-default" style={{ fontSize: "11px" }} disabled={disabled} onClick={onRequestChanges}>
          Request Changes
        </button>
        <button className="btn-danger" style={{ fontSize: "11px" }} disabled={disabled} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
