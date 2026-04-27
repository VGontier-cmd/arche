import type { AppView, DashboardSummary } from "../types";

const NAV_ITEMS: Array<{ view: AppView; label: string; icon: string }> = [
  { view: "runs", label: "Runs", icon: "\u25B6" },
  { view: "repositories", label: "Repos", icon: "\u2630" },
  { view: "rules", label: "Rules", icon: "\u2699" },
  { view: "schedules", label: "Cron", icon: "\u23F1" },
  { view: "metrics", label: "Metrics", icon: "\u25A0" },
  { view: "settings", label: "Settings", icon: "\u2638" },
];

export function NavSidebar({
  activeView,
  onChangeView,
  onTriggerRun,
  onHelp,
  summary,
}: {
  activeView: AppView;
  onChangeView: (view: AppView) => void;
  onTriggerRun: () => void;
  onHelp?: () => void;
  summary: DashboardSummary | null;
}) {
  return (
    <div className="w-14 lg:w-[60px] shrink-0 bg-[var(--color-base-200)] border-r border-[var(--border-color)] flex flex-col items-center py-3 gap-1">
      {NAV_ITEMS.map((item) => {
        const isActive = activeView === item.view;
        const badge = item.view === "runs" && summary ? summary.inboxCount : null;
        return (
          <button
            key={item.view}
            onClick={() => onChangeView(item.view)}
            aria-label={badge !== null && badge > 0 ? `${item.label} (${badge} pending)` : item.label}
            aria-current={isActive ? "page" : undefined}
            className={`relative w-10 h-10 flex flex-col items-center justify-center rounded-[var(--rounded-box)] text-[10px] transition-colors ${
              isActive
                ? "bg-[#58a6ff20] text-[#58a6ff]"
                : "text-[var(--fg2)] hover:bg-[var(--color-base-300)] hover:text-[var(--color-base-content)]"
            }`}
          >
            <span className="text-sm leading-none" aria-hidden="true">{item.icon}</span>
            <span className="leading-none mt-0.5" aria-hidden="true">{item.label}</span>
            {badge !== null && badge > 0 && (
              <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-[#d29922] text-white text-[8px] font-bold px-1">
                {badge}
              </span>
            )}
          </button>
        );
      })}

      <div className="flex-1" />

      {onHelp && (
        <button
          onClick={onHelp}
          aria-label="Help & keyboard shortcuts"
          className="w-10 h-10 flex items-center justify-center rounded-[var(--rounded-box)] text-[var(--fg2)] hover:bg-[var(--color-base-300)] hover:text-[var(--color-base-content)] transition-colors"
        >
          <span className="text-sm font-bold leading-none" aria-hidden="true">?</span>
        </button>
      )}
      <button
        onClick={onTriggerRun}
        aria-label="Trigger new run"
        className="w-10 h-10 flex items-center justify-center rounded-[var(--rounded-box)] text-[#3fb950] hover:bg-[#3fb95020] transition-colors"
      >
        <span className="text-lg font-bold leading-none" aria-hidden="true">+</span>
      </button>
    </div>
  );
}
