/**
 * Single source of truth for status presentation across the dashboard.
 * Replaces the duplicated maps that lived inline in StatusBadge / RunHeadline /
 * RunItem / Timeline. The CSS provides --status-{tone}-fg/-bg/-glow tokens;
 * this module maps every concrete run status to a tone slug and supplies
 * label + icon — the React components compose from there.
 */

import {
  ArrowUpRight,
  Ban,
  Check,
  CircleDashed,
  CircleHelp,
  Clock,
  Eye,
  Hammer,
  Pause,
  Play,
  Search,
  ShieldCheck,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";

export type StatusTone = "pending" | "running" | "wait" | "done" | "fail";

export interface StatusMeta {
  label: string;
  tone: StatusTone;
  Icon: LucideIcon;
  /** Live tones pulse / glow; static tones do not. */
  live: boolean;
}

const PENDING: StatusMeta  = { label: "Queued",          tone: "pending", Icon: Clock,        live: false };
const FALLBACK: StatusMeta = { label: "Unknown",         tone: "pending", Icon: CircleHelp,   live: false };

/**
 * Stable, ordered list of every status the dashboard knows about.
 * Consumers (filters, legends, etc.) should iterate this — not rebuild
 * their own — so adding a status here automatically surfaces it everywhere.
 */
export const ALL_STATUS_KEYS = [
  "pending",
  "researching",
  "planning",
  "executing",
  "reviewing",
  "publishing",
  "running",
  "awaiting_plan_approval",
  "awaiting_publish_approval",
  "needs_human_input",
  "pushed",
  "success",
  "failed",
  "cancelled",
  "publish_rejected",
] as const;
export type StatusKey = (typeof ALL_STATUS_KEYS)[number];

const STATUS: Record<string, StatusMeta> = {
  pending:                   PENDING,
  researching:               { label: "Researching",      tone: "running", Icon: Search,       live: true  },
  planning:                  { label: "Planning",         tone: "running", Icon: CircleDashed, live: true  },
  executing:                 { label: "Executing",        tone: "running", Icon: Hammer,       live: true  },
  reviewing:                 { label: "Reviewing",        tone: "running", Icon: Eye,          live: true  },
  publishing:                { label: "Publishing",       tone: "running", Icon: Upload,       live: true  },
  running:                   { label: "Running",          tone: "running", Icon: Play,         live: true  },
  awaiting_plan_approval:    { label: "Plan ready",       tone: "wait",    Icon: Pause,        live: false },
  awaiting_publish_approval: { label: "Ready to ship",    tone: "wait",    Icon: ShieldCheck,  live: false },
  needs_human_input:         { label: "Waiting for you",  tone: "wait",    Icon: Pause,        live: false },
  pushed:                    { label: "Shipped",          tone: "done",    Icon: Check,        live: false },
  success:                   { label: "Success",          tone: "done",    Icon: Check,        live: false },
  failed:                    { label: "Failed",           tone: "fail",    Icon: X,            live: false },
  cancelled:                 { label: "Cancelled",        tone: "fail",    Icon: Ban,          live: false },
  publish_rejected:          { label: "Rejected",         tone: "fail",    Icon: X,            live: false },
};

export function statusMeta(status: string): StatusMeta {
  return STATUS[status] ?? FALLBACK;
}

export function statusLabel(status: string): string {
  return statusMeta(status).label;
}

/** A status is "terminal" when no further automatic transition will happen. */
export function isTerminalStatus(status: string): boolean {
  const tone = statusMeta(status).tone;
  return tone === "done" || tone === "fail";
}

/** CSS custom properties exposed by index.css for a given tone. */
export function toneVars(tone: StatusTone): { fg: string; bg: string; glow?: string } {
  switch (tone) {
    case "running":
      return { fg: "var(--status-running-fg)", bg: "var(--status-running-bg)", glow: "var(--status-running-glow)" };
    case "wait":
      return { fg: "var(--status-wait-fg)",    bg: "var(--status-wait-bg)",    glow: "var(--status-wait-glow)" };
    case "done":
      return { fg: "var(--status-done-fg)",    bg: "var(--status-done-bg)" };
    case "fail":
      return { fg: "var(--status-fail-fg)",    bg: "var(--status-fail-bg)" };
    case "pending":
    default:
      return { fg: "var(--status-pending-fg)", bg: "var(--status-pending-bg)" };
  }
}

export const ARROW_OUT_ICON = ArrowUpRight;
