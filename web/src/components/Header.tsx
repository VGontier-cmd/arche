import type { ConnectionInfo } from "../hooks/useDashboard";
import type { DashboardServiceStatus, DashboardSystemStats, DashboardWorker } from "../types";
import { formatTime } from "../lib/format";

const LOGO = ` ______     ______     ______     __  __     ______
/\\  __ \\   /\\  == \\   /\\  ___\\   /\\ \\_\\ \\   /\\  ___\\
\\ \\  __ \\  \\ \\  __<   \\ \\ \\____  \\ \\  __ \\  \\ \\  __\\
 \\ \\_\\ \\_\\  \\ \\_\\ \\_\\  \\ \\_____\\  \\ \\_\\ \\_\\  \\ \\_____\\
  \\/_/\\/_/   \\/_/ /_/   \\/_____/   \\/_/\\/_/   \\/_____/`;

export function Header({
  workers,
  services,
  systemStats,
  refreshedAt,
  connectionInfo,
  onStopWorker,
  onRestartWorker,
  onPurgeOffline,
}: {
  workers: DashboardWorker[];
  services: DashboardServiceStatus;
  systemStats: DashboardSystemStats;
  refreshedAt: string;
  connectionInfo: ConnectionInfo;
  onStopWorker?: (workerId: string) => void;
  onRestartWorker?: (workerId: string) => void;
  onPurgeOffline?: () => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-5 py-3 gap-2 bg-[var(--color-base-200)] border-b border-[var(--border-color)]">
      <pre className="hidden md:block text-[7px] leading-[1.1] text-[#58a6ff] select-none m-0">
        {LOGO}
      </pre>
      <span className="md:hidden text-base font-semibold text-[var(--color-base-content)]">
        Arche
      </span>
      <div className="flex items-center gap-6 text-[11px] text-[var(--fg2)] flex-wrap">
        {/* Service statuses */}
        <StatusDot active={services.serverRunning} label="Server" />
        <StatusDot active={services.dockerRunning} label="Docker" />
        <ConnectionIndicator info={connectionInfo} />

        {/* Workers */}
        <span className="flex items-center gap-3 flex-wrap">
          {workers.length > 0 ? (
            workers.map((w) => (
              <span key={w.id} className="group relative flex items-center gap-1.5">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${w.offline ? "bg-[#f85149]" : "bg-[#3fb950]"}`}
                />
                {w.name}
                <span className="hidden group-hover:inline-flex items-center gap-1 ml-1">
                  {onRestartWorker && (
                    <button
                      className="px-1.5 py-0.5 text-[9px] rounded bg-[#58a6ff20] text-[#58a6ff] hover:bg-[#58a6ff30] transition-colors"
                      onClick={() => onRestartWorker(w.id)}
                      title="Restart worker"
                    >
                      Restart
                    </button>
                  )}
                  {onStopWorker && !w.offline && (
                    <button
                      className="px-1.5 py-0.5 text-[9px] rounded bg-[#f8514920] text-[#f85149] hover:bg-[#f8514930] transition-colors"
                      onClick={() => onStopWorker(w.id)}
                      title="Stop worker"
                    >
                      Stop
                    </button>
                  )}
                </span>
              </span>
            ))
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-[#f85149]" />
              No workers
            </span>
          )}
          {onPurgeOffline && workers.some((w) => w.offline) && (
            <button
              className="px-1.5 py-0.5 text-[9px] rounded bg-[#d2992220] text-[#d29922] hover:bg-[#d2992230] transition-colors"
              onClick={onPurgeOffline}
              title="Remove offline workers"
            >
              Purge offline
            </button>
          )}
        </span>

        {/* System stats — collapsed under timestamp hover */}
        <span
          className="group relative cursor-default"
          title={`RAM ${systemStats.ramMb}M / ${systemStats.ramTotalMb}M · CPU ${systemStats.loadAvg1.toFixed(2)} / ${systemStats.cpuCount}`}
        >
          {formatTime(refreshedAt)}
          <span className="hidden group-hover:inline ml-1.5 text-[var(--fg3)] text-[10px]">
            · {systemStats.ramMb}M RAM · {systemStats.loadAvg1.toFixed(1)} CPU
          </span>
        </span>
      </div>
    </div>
  );
}

function StatusDot({ active, label }: { active: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`inline-block w-2 h-2 rounded-full ${active ? "bg-[#3fb950]" : "bg-[#f85149]"}`}
      />
      {label}
    </span>
  );
}

const MAX_RECONNECT_DISPLAY = 10;

function ConnectionIndicator({ info }: { info: ConnectionInfo }) {
  if (info.state === "connected") {
    return (
      <span className="flex items-center gap-1.5" title="Live updates connected">
        <span className="inline-block w-2 h-2 rounded-full bg-[#3fb950]" />
        Live
      </span>
    );
  }
  if (info.state === "connecting") {
    return (
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-2 h-2 rounded-full bg-[#d29922]" />
        Connecting
      </span>
    );
  }
  // Disconnected
  if (info.reconnectAttempt > MAX_RECONNECT_DISPLAY) {
    return (
      <span className="flex items-center gap-1.5 text-[#f85149]" title={`${info.reconnectAttempt} reconnect attempts`}>
        <span className="inline-block w-2 h-2 rounded-full bg-[#f85149]" />
        Offline — refresh to retry
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block w-2 h-2 rounded-full bg-[#f85149] animate-pulse" />
      Reconnecting{info.reconnectAttempt > 0 ? ` (${info.reconnectAttempt}/${MAX_RECONNECT_DISPLAY})` : ""}
    </span>
  );
}
