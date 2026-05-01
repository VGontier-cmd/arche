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
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";

type Tone = "accent" | "primary";

type BannerConfig = {
  tone: Tone;
  Icon: LucideIcon;
  headline: string;
};

const BANNER_CONFIG: Partial<Record<string, BannerConfig>> = {
  awaiting_plan_approval: {
    tone: "accent",
    Icon: ThumbsUp,
    headline: "Plan ready — review and approve to start execution",
  },
  awaiting_publish_approval: {
    tone: "primary",
    Icon: ShieldCheck,
    headline: "Ready to ship — approve to push the branch",
  },
  needs_human_input: {
    tone: "accent",
    Icon: MessageCircleQuestion,
    headline: "Agent is waiting for your input",
  },
};

const TONE_COLOR: Record<Tone, string> = {
  accent: "var(--c-gold-300)",
  primary: "var(--c-blue-200)",
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
    fetchCostEstimate(run.id).then(setCostEstimate).catch(() => setCostError(true));
  }, [run.id, run.status]);

  if (!cfg) return null;

  const disabled = pendingAction != null;
  const toneColor = TONE_COLOR[cfg.tone];

  return (
    <div className="mx-5 mt-4">
      <Card
        tone="default"
        accent={cfg.tone}
        glow={cfg.tone === "accent" ? "gold" : "blue"}
        padding={4}
      >
        <div
          className="flex items-start"
          style={{ gap: 10, marginBottom: 12 }}
        >
          <cfg.Icon
            size={18}
            strokeWidth={2}
            aria-hidden="true"
            style={{ color: toneColor, marginTop: 2, flexShrink: 0 }}
          />
          <div className="min-w-0 flex-1">
            <p
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-heading-lg)",
                fontWeight: 700,
                color: "var(--c-bone)",
                letterSpacing: "-0.005em",
                lineHeight: 1.25,
              }}
            >
              <span style={{ color: toneColor }}>{run.ticketKey}</span>
              <span style={{ color: "var(--c-steel-300)", margin: "0 8px" }}>·</span>
              <span>{cfg.headline}</span>
            </p>
            {run.status === "needs_human_input" && run.pendingQuestion && (
              <p
                style={{
                  fontSize: "var(--text-body-sm)",
                  color: "var(--c-fog-100)",
                  marginTop: 6,
                  lineHeight: 1.5,
                }}
              >
                {run.pendingQuestion}
              </p>
            )}
            {run.status === "awaiting_plan_approval" &&
              costEstimate &&
              costEstimate.estimatedCostUsd !== null &&
              costEstimate.basedOnRuns > 0 && (
                <p
                  style={{
                    fontSize: "var(--text-label-sm)",
                    color: "var(--c-fog-300)",
                    marginTop: 4,
                  }}
                >
                  Est. cost: ~${costEstimate.estimatedCostUsd.toFixed(4)} based on{" "}
                  {costEstimate.basedOnRuns} past run
                  {costEstimate.basedOnRuns > 1 ? "s" : ""} on {costEstimate.repoName}
                </p>
              )}
            {run.status === "awaiting_plan_approval" &&
              costEstimate &&
              costEstimate.basedOnRuns === 0 && (
                <p
                  style={{
                    fontSize: "var(--text-label-sm)",
                    color: "var(--c-fog-300)",
                    marginTop: 4,
                  }}
                >
                  Est. cost: — (no historical data yet for this repository)
                </p>
              )}
            {run.status === "awaiting_plan_approval" && costError && (
              <p
                style={{
                  fontSize: "var(--text-label-sm)",
                  color: "var(--c-fog-300)",
                  marginTop: 4,
                }}
              >
                Est. cost: unavailable
              </p>
            )}
          </div>
        </div>

        {run.status === "awaiting_plan_approval" &&
          run.planProposals &&
          run.planProposals.length > 1 && (
            <PlanProposalCards
              proposals={run.planProposals}
              runId={run.id}
              disabled={disabled}
              onApprove={(idx) => onAction(run.id, `approve-plan:${idx}`)}
              onRequestChanges={() =>
                onOpenRespond(run.id, "Request changes to the plan")
              }
              onCancel={() => onAction(run.id, "cancel")}
            />
          )}

        <div className="flex flex-wrap" style={{ gap: 8 }}>
          {run.status === "awaiting_plan_approval" &&
            (!run.planProposals || run.planProposals.length <= 1) && (
              <>
                <Button
                  variant="accent"
                  disabled={disabled}
                  onClick={() => onAction(run.id, "approve-plan")}
                >
                  Approve Plan
                </Button>
                <Button
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => onOpenRespond(run.id, "Request changes to the plan")}
                >
                  Request Changes
                </Button>
                <Button
                  variant="danger"
                  disabled={disabled}
                  onClick={() => onAction(run.id, "cancel")}
                >
                  Cancel
                </Button>
              </>
            )}

          {run.status === "awaiting_publish_approval" && (
            <>
              <Button
                variant="primary"
                disabled={disabled}
                onClick={() => onAction(run.id, "approve-publish")}
              >
                Approve & Ship
              </Button>
              <Button
                variant="danger"
                disabled={disabled}
                onClick={() => onAction(run.id, "reject-publish")}
              >
                Reject
              </Button>
            </>
          )}

          {run.status === "needs_human_input" && (
            <>
              <Button
                variant="accent"
                disabled={disabled}
                onClick={() => onOpenRespond(run.id, "Respond to the agent")}
              >
                Respond
              </Button>
              <Button
                variant="secondary"
                disabled={disabled}
                onClick={() => onAction(run.id, "force-approve")}
              >
                Force Approve
              </Button>
              <Button
                variant="danger"
                disabled={disabled}
                onClick={() => onAction(run.id, "cancel")}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

const APPROACH_LABEL: Record<
  string,
  { label: string; Icon: LucideIcon; desc: string; badge?: "Recommended" | "Lowest risk" | "Highest coverage" }
> = {
  conservative: { label: "Conservative", Icon: ShieldCheck,  desc: "Minimal changes, lowest risk",   badge: "Lowest risk" },
  balanced:     { label: "Balanced",     Icon: Scale,        desc: "Complete implementation",        badge: "Recommended" },
  thorough:     { label: "Thorough",     Icon: FlaskConical, desc: "Comprehensive + tests",          badge: "Highest coverage" },
};

const APPROACH_FALLBACK = { label: "", Icon: Diamond, desc: "" } as const;

function PlanProposalCards({
  proposals,
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
  return (
    <div style={{ marginTop: 4, marginBottom: 12 }}>
      <p
        style={{
          fontSize: "var(--text-label-sm)",
          color: "var(--c-fog-300)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 600,
          marginBottom: 8,
        }}
      >
        Choose an approach
      </p>
      <div
        className="grid grid-cols-1 sm:grid-cols-3"
        style={{ gap: 8, marginBottom: 12 }}
      >
        {proposals.map((p, i) => {
          const meta = APPROACH_LABEL[p.approach] ?? {
            ...APPROACH_FALLBACK,
            label: p.approach,
          };
          const badgeTone: Record<string, "success" | "primary" | "accent"> = {
            "Recommended": "success",
            "Lowest risk": "primary",
            "Highest coverage": "accent",
          };
          return (
            <button
              key={p.approach}
              disabled={disabled}
              onClick={() => onApprove(i)}
              style={{
                textAlign: "left",
                padding: 12,
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--hairline)",
                background: "var(--surface-2)",
                color: "var(--c-fog-100)",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.4 : 1,
                transition:
                  "border-color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)",
              }}
              onMouseEnter={(e) => {
                if (disabled) return;
                e.currentTarget.style.borderColor = "var(--c-blue-400)";
                e.currentTarget.style.boxShadow = "var(--glow-blue)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--hairline)";
                e.currentTarget.style.boxShadow = "";
              }}
            >
              <div className="flex items-center" style={{ gap: 6, marginBottom: 4 }}>
                <meta.Icon
                  size={14}
                  strokeWidth={2}
                  aria-hidden="true"
                  style={{ color: "var(--c-blue-200)" }}
                />
                <span
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 13,
                    fontWeight: 700,
                    letterSpacing: "-0.005em",
                    color: "var(--c-bone)",
                  }}
                >
                  {meta.label}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 9,
                    color: "var(--c-steel-300)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  ~{p.estimatedSteps} steps
                </span>
              </div>
              {meta.badge && (
                <Badge tone={badgeTone[meta.badge] ?? "neutral"} size="sm">
                  {meta.badge}
                </Badge>
              )}
              <p
                style={{
                  fontSize: 11,
                  color: "var(--c-fog-300)",
                  marginTop: meta.badge ? 6 : 0,
                  lineHeight: 1.45,
                }}
              >
                {meta.desc}
              </p>
              {p.risks.length > 0 && (
                <p
                  style={{
                    fontSize: 10,
                    color: "var(--c-gold-300)",
                    marginTop: 4,
                  }}
                >
                  {p.risks.length} risk{p.risks.length > 1 ? "s" : ""}
                </p>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex" style={{ gap: 8 }}>
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled}
          onClick={onRequestChanges}
        >
          Request Changes
        </Button>
        <Button size="sm" variant="danger" disabled={disabled} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
