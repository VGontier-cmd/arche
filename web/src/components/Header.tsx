import type { ConnectionState } from "../hooks/useDashboard";
import type { DashboardServiceStatus, DashboardSystemStats, DashboardWorker } from "../types";
import { formatTime } from "../lib/format";

const LOGO = ` ______     ______     ______     __  __     ______
/\\  __ \\   /\\  == \\   /\\  ___\\   /\\ \\_\\ \\   /\\  ___\\
\\ \\  __ \\  \\ \\  __<   \\ \\ \\____  \\ \\  __ \\  \\ \\  __\\
 \\ \\_\\ \\_\\  \\ \\_\\ \\_\\  \\ \\_____\\  \\ \\_\\ \\_\\  \\ \\_____\\
  \\/_/\\/_/   \\/_/ /_/   \\/_____/   \\/_/\\/_/   \\/_____/`;

const CONNECTION_STYLES: Record<ConnectionState, { color: string; label: string }> = {
  connected: { color: "bg-[#3fb950]", label: "Live" },
  connecting: { color: "bg-[#d29922]", label: "Connecting" },
  disconnected: { color: "bg-[#f85149]", label: "Disconnected" },
};

export function Header({
  workers,
  services,
  systemStats,
  refreshedAt,
  connectionState,
}: {
  workers: DashboardWorker[];
  services: DashboardServiceStatus;
  systemStats: DashboardSystemStats;
  refreshedAt: string;
  connectionState: ConnectionState;
}) {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-5 py-3 gap-2 bg-[var(--color-base-200)] border-b border-[var(--border-color)]">
      <pre className="hidden md:block text-[7px] leading-[1.1] text-[#58a6ff] select-none m-0">
        {LOGO}
      </pre>
      <span className="md:hidden text-base font-semibold text-[var(--color-base-content)]">
        Arche
      </span>
      <div className="flex items-center gap-4 text-[11px] text-[var(--fg2)] flex-wrap">
        <span className="flex items-center gap-1">
          <span
            className={`inline-block w-2 h-2 rounded-full ${services.serverRunning ? "bg-[#3fb950]" : "bg-[#f85149]"}`}
          />
          Server
        </span>
        <span className="flex items-center gap-1">
          <span className={`inline-block w-2 h-2 rounded-full ${CONNECTION_STYLES[connectionState].color}`} />
          {CONNECTION_STYLES[connectionState].label}
        </span>
        <span className="flex items-center gap-2 flex-wrap">
          {workers.length > 0 ? (
            workers.map((w) => (
              <span key={w.id} className="flex items-center gap-1">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${w.offline ? "bg-[#f85149]" : "bg-[#3fb950]"}`}
                />
                {w.name}
              </span>
            ))
          ) : (
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-[#f85149]" />
              No workers
            </span>
          )}
        </span>
        <span>RAM {systemStats.ramMb}M / {systemStats.ramTotalMb}M</span>
        <span>CPU {systemStats.loadAvg1.toFixed(2)} / {systemStats.cpuCount}</span>
        <span>{formatTime(refreshedAt)}</span>
      </div>
    </div>
  );
}
