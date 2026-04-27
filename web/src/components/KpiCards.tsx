import { useEffect, useRef, useState } from "react";
import type { DashboardSummary } from "../types";

function useCountUp(target: number, duration = 400): number {
  const [value, setValue] = useState(target);
  const prevRef = useRef(target);

  useEffect(() => {
    // Skip animation if user prefers reduced motion
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    const from = prevRef.current;
    prevRef.current = target;
    if (from === target) return;

    const start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

function CountCard({ label, target, color }: { label: string; target: number; color: string }) {
  const value = useCountUp(target);
  return (
    <div className="bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] px-4 py-3">
      <div className="text-[11px] text-[var(--fg2)] uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

export function KpiCards({ summary }: { summary: DashboardSummary }) {
  const creditsDisplay = summary.availableCredits !== null
    ? new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(summary.availableCredits)
    : "—";

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 px-5 py-4">
      <CountCard label="Inbox"  target={summary.inboxCount}  color="text-[#d29922]" />
      <CountCard label="Active" target={summary.activeCount} color="text-[#58a6ff]" />
      <CountCard label="Failed" target={summary.failedCount} color="text-[#f85149]" />

      {/* Workers — fraction, no count-up */}
      <div className="bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] px-4 py-3">
        <div className="text-[11px] text-[var(--fg2)] uppercase tracking-wide">Workers</div>
        <div className="text-2xl font-bold mt-1 tabular-nums text-[#3fb950]">
          {summary.onlineWorkerCount}/{summary.workerCount}
        </div>
      </div>

      {/* Credits */}
      <div className="bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] px-4 py-3">
        <div className="text-[11px] text-[var(--fg2)] uppercase tracking-wide">Credits</div>
        <div className={`text-2xl font-bold mt-1 tabular-nums ${summary.availableCredits !== null ? "text-[#a5d6ff]" : "text-[var(--fg3)]"}`}>
          {creditsDisplay}
        </div>
      </div>
    </div>
  );
}
