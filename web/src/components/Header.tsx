import type { ConnectionInfo } from "../hooks/useDashboard";
import type { DashboardServiceStatus, DashboardSystemStats, DashboardWorker } from "../types";
import { formatTime } from "../lib/format";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Power, RotateCcw, Trash2 } from "lucide-react";

// Slant figlet — leaning ASCII banner that nods to engineering blueprints
// while keeping the CLI-first identity. The monogram in NavSidebar stays
// the compact mark for tighter contexts.
const LOGO = `    ___    ____  ________  ________
   /   |  / __ \\/ ____/ / / / ____/
  / /| | / /_/ / /   / /_/ / __/
 / ___ |/ _, _/ /___/ __  / /___
/_/  |_/_/ |_|\\____/_/ /_/_____/`;

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
    <div
      className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-5 py-3 gap-3"
      style={{
        background: "var(--surface-1)",
        borderBottom: "1px solid var(--c-blue-900)",
      }}
    >
      {/* ASCII banner on md+; compact wordmark on small screens. */}
      <pre
        translate="no"
        aria-label="Arche"
        className="hidden md:block select-none"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 7,
          lineHeight: 1.1,
          color: "var(--c-bone)",
          margin: 0,
          letterSpacing: 0,
        }}
      >
        {LOGO}
      </pre>
      <span
        translate="no"
        aria-hidden="true"
        className="md:hidden"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          color: "var(--c-bone)",
        }}
      >
        ARCHE
      </span>

      <div
        className="flex items-center flex-wrap"
        style={{
          gap: 18,
          fontSize: 11,
          color: "var(--c-fog-300)",
        }}
      >
        {/* Service statuses */}
        <StatusDot active={services.serverRunning} label="Server" />
        <StatusDot active={services.dockerRunning} label="Docker" />
        <ConnectionIndicator info={connectionInfo} />

        {/* Workers */}
        <span className="flex items-center gap-2 flex-wrap">
          {workers.length > 0 ? (
            workers.map((w) => (
              <span
                key={w.id}
                className="reveal-host relative flex items-center"
                style={{ gap: 6 }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: w.offline
                      ? "var(--c-error-fg)"
                      : "var(--c-success-fg)",
                    boxShadow: w.offline
                      ? undefined
                      : "0 0 8px rgba(95, 209, 122, 0.5)",
                  }}
                />
                <span style={{ color: "var(--c-fog-100)" }}>{w.name}</span>
                <span
                  className="reveal-target inline-flex items-center"
                  style={{ gap: 4, marginLeft: 2 }}
                >
                  {onRestartWorker && (
                    <Button
                      size="xs"
                      variant="ghost"
                      leftIcon={<RotateCcw size={10} strokeWidth={2.5} />}
                      onClick={() => onRestartWorker(w.id)}
                      title="Restart worker"
                      aria-label={`Restart worker ${w.name}`}
                    >
                      Restart
                    </Button>
                  )}
                  {onStopWorker && !w.offline && (
                    <Button
                      size="xs"
                      variant="danger"
                      leftIcon={<Power size={10} strokeWidth={2.5} />}
                      onClick={() => onStopWorker(w.id)}
                      title="Stop worker"
                      aria-label={`Stop worker ${w.name}`}
                    >
                      Stop
                    </Button>
                  )}
                </span>
              </span>
            ))
          ) : (
            <span className="flex items-center" style={{ gap: 6 }}>
              <span
                aria-hidden="true"
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--c-error-fg)",
                }}
              />
              No workers
            </span>
          )}
          {onPurgeOffline && workers.some((w) => w.offline) && (
            <Button
              size="xs"
              variant="accent"
              leftIcon={<Trash2 size={10} strokeWidth={2.5} />}
              onClick={onPurgeOffline}
              title="Remove offline workers"
              aria-label="Remove offline workers"
            >
              Purge offline
            </Button>
          )}
        </span>

        {/* System stats — always visible. Timestamp + RAM + CPU on the
            same line. Keyboard-accessible via the surrounding span. */}
        <span
          className="tabular"
          title={`RAM ${systemStats.ramMb}M / ${systemStats.ramTotalMb}M · CPU ${systemStats.loadAvg1.toFixed(2)} / ${systemStats.cpuCount}`}
          style={{ color: "var(--c-fog-300)" }}
          aria-label={`Last refresh ${formatTime(refreshedAt)}, RAM ${systemStats.ramMb} of ${systemStats.ramTotalMb} megabytes, CPU load ${systemStats.loadAvg1.toFixed(2)} of ${systemStats.cpuCount}`}
        >
          {formatTime(refreshedAt)}
          <span style={{ marginLeft: 8, color: "var(--c-steel-300)" }}>
            · {systemStats.ramMb}M / {systemStats.ramTotalMb}M RAM
          </span>
          <span style={{ marginLeft: 8, color: "var(--c-steel-300)" }}>
            · {systemStats.loadAvg1.toFixed(2)} / {systemStats.cpuCount} CPU
          </span>
        </span>
      </div>
    </div>
  );
}

function StatusDot({ active, label }: { active: boolean; label: string }) {
  return (
    <span className="flex items-center" style={{ gap: 6 }}>
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: active ? "var(--c-success-fg)" : "var(--c-error-fg)",
          boxShadow: active ? "0 0 8px rgba(95, 209, 122, 0.5)" : undefined,
        }}
      />
      {label}
    </span>
  );
}

const MAX_RECONNECT_DISPLAY = 10;

function ConnectionIndicator({ info }: { info: ConnectionInfo }) {
  if (info.state === "connected") {
    return (
      <Badge tone="success" pulse title="Live updates connected">
        Live
      </Badge>
    );
  }
  if (info.state === "connecting") {
    return <Badge tone="warning">Connecting</Badge>;
  }
  // Disconnected
  if (info.reconnectAttempt > MAX_RECONNECT_DISPLAY) {
    return (
      <Badge tone="danger" title={`${info.reconnectAttempt} reconnect attempts`}>
        Offline — refresh to retry
      </Badge>
    );
  }
  return (
    <Badge tone="danger" pulse>
      Reconnecting{info.reconnectAttempt > 0 ? ` (${info.reconnectAttempt}/${MAX_RECONNECT_DISPLAY})` : ""}
    </Badge>
  );
}
