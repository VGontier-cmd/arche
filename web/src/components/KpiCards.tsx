import type { DashboardSummary } from "../types";

export function KpiCards({ summary }: { summary: DashboardSummary }) {
  const cards = [
    { label: "Inbox", value: summary.inboxCount, color: "text-[#d29922]" },
    { label: "Active", value: summary.activeCount, color: "text-[#58a6ff]" },
    { label: "Failed", value: summary.failedCount, color: "text-[#f85149]" },
    {
      label: "Workers",
      value: `${summary.onlineWorkerCount}/${summary.workerCount}`,
      color: "text-[#3fb950]",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-5 py-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] px-4 py-3"
        >
          <div className="text-[11px] text-[var(--fg2)] uppercase tracking-wide">
            {card.label}
          </div>
          <div className={`text-2xl font-bold mt-1 ${card.color}`}>
            {card.value}
          </div>
        </div>
      ))}
    </div>
  );
}
