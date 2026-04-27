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

const STATUS_CONFIG: Record<
  string,
  { label: string; Icon: LucideIcon; colors: string; pulse?: boolean }
> = {
  pending:                   { label: "Queued",           Icon: Clock,        colors: "bg-[#1f2937] text-[var(--fg2)]" },
  researching:               { label: "Researching…",     Icon: Search,       colors: "bg-[#0c2d6b] text-[#58a6ff]", pulse: true },
  planning:                  { label: "Planning…",        Icon: CircleDashed, colors: "bg-[#0c2d6b] text-[#58a6ff]", pulse: true },
  executing:                 { label: "Executing…",       Icon: Hammer,       colors: "bg-[#0c2d6b] text-[#58a6ff]", pulse: true },
  reviewing:                 { label: "Reviewing…",       Icon: Eye,          colors: "bg-[#0c2d6b] text-[#58a6ff]", pulse: true },
  publishing:                { label: "Publishing…",      Icon: Upload,       colors: "bg-[#0c2d6b] text-[#58a6ff]", pulse: true },
  running:                   { label: "Running…",         Icon: Play,         colors: "bg-[#0c2d6b] text-[#58a6ff]", pulse: true },
  awaiting_plan_approval:    { label: "Plan ready",       Icon: Pause,        colors: "bg-[#3b2508] text-[#d29922]" },
  awaiting_publish_approval: { label: "Ready to ship",    Icon: ShieldCheck,  colors: "bg-[#3b2508] text-[#d29922]" },
  needs_human_input:         { label: "Waiting for you",  Icon: Pause,        colors: "bg-[#3b2508] text-[#d29922]" },
  pushed:                    { label: "Shipped",          Icon: Check,        colors: "bg-[#0d2818] text-[#3fb950]" },
  success:                   { label: "Success",          Icon: Check,        colors: "bg-[#0d2818] text-[#3fb950]" },
  failed:                    { label: "Failed",           Icon: X,            colors: "bg-[#3c1116] text-[#f85149]" },
  cancelled:                 { label: "Cancelled",        Icon: Ban,          colors: "bg-[#3c1116] text-[#f85149]" },
  publish_rejected:          { label: "Rejected",         Icon: X,            colors: "bg-[#3c1116] text-[#f85149]" },
};

const FALLBACK = { label: "Unknown", Icon: CircleHelp, colors: "bg-[#1f2937] text-[var(--fg2)]" };

export function StatusBadge({ status, mrUrl }: { status: string; mrUrl?: string | null }) {
  const cfg = STATUS_CONFIG[status] ?? FALLBACK;
  // When the run has shipped and we know the MR/PR, the badge becomes a
  // direct link to GitHub/GitLab so the audience can click straight through
  // during a demo without scrolling around for the URL.
  const isLinked = mrUrl && (status === "success" || status === "pushed");
  const className = `inline-flex items-center gap-1 px-2 py-0.5 rounded-[10px] text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap ${cfg.colors} ${
    isLinked ? "hover:brightness-125 transition-[filter] cursor-pointer underline-offset-2 hover:underline" : ""
  }`;
  const inner = (
    <>
      {cfg.pulse && (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse shrink-0" aria-hidden="true" />
      )}
      <cfg.Icon size={11} strokeWidth={2.5} aria-hidden="true" />
      {cfg.label}
      {isLinked && <ArrowUpRight size={10} strokeWidth={2.5} aria-hidden="true" className="ml-0.5" />}
    </>
  );
  if (isLinked) {
    return (
      <a
        href={mrUrl ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        title={`Open MR/PR: ${mrUrl}`}
        onClick={(e) => e.stopPropagation()}
      >
        {inner}
      </a>
    );
  }
  return <span className={className}>{inner}</span>;
}

/** Raw status slug → human-readable label (for use outside StatusBadge) */
export function statusLabel(status: string): string {
  return (STATUS_CONFIG[status] ?? FALLBACK).label;
}
