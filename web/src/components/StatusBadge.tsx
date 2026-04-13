const statusColors: Record<string, string> = {
  pending: "bg-[#1f2937] text-[var(--fg2)]",
  running: "bg-[#0c2d6b] text-[#58a6ff]",
  executing: "bg-[#0c2d6b] text-[#58a6ff]",
  planning: "bg-[#0c2d6b] text-[#58a6ff]",
  reviewing: "bg-[#0c2d6b] text-[#58a6ff]",
  awaiting_plan_approval: "bg-[#3b2508] text-[#d29922]",
  awaiting_publish_approval: "bg-[#3b2508] text-[#d29922]",
  needs_human_input: "bg-[#3b2508] text-[#d29922]",
  pushed: "bg-[#0d2818] text-[#3fb950]",
  success: "bg-[#0d2818] text-[#3fb950]",
  failed: "bg-[#3c1116] text-[#f85149]",
  cancelled: "bg-[#3c1116] text-[#f85149]",
  publish_rejected: "bg-[#3c1116] text-[#f85149]",
};

const ACTIVE_STATUSES = new Set(["executing", "planning", "reviewing", "running"]);

export function StatusBadge({ status }: { status: string }) {
  const colors = statusColors[status] ?? statusColors.pending;
  const isActive = ACTIVE_STATUSES.has(status);
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[10px] text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap ${colors}`}
    >
      {isActive && (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse shrink-0" />
      )}
      {status}
    </span>
  );
}
