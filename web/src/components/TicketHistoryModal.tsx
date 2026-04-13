import { useEffect, useState } from "react";
import type { DashboardRun } from "../types";
import { fetchTicketRuns } from "../api/client";
import { Modal } from "./Modal";
import { StatusBadge } from "./StatusBadge";
import { formatRelativeTime } from "../lib/format";

export function TicketHistoryModal({
  ticketKey,
  onClose,
  onSelectRun,
}: {
  ticketKey: string | null;
  onClose: () => void;
  onSelectRun: (runId: string) => void;
}) {
  const [runs, setRuns] = useState<DashboardRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticketKey) return;
    setRuns(null);
    setError(null);
    fetchTicketRuns(ticketKey)
      .then(setRuns)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [ticketKey]);

  return (
    <Modal isOpen={ticketKey !== null} onClose={onClose} labelledBy="ticket-history-title">
      <div className="flex items-center justify-between mb-4">
        <h3 id="ticket-history-title" className="font-semibold text-sm">
          History — {ticketKey}
        </h3>
        <button onClick={onClose} className="text-[var(--fg3)] hover:text-[var(--fg2)] text-xs">
          close
        </button>
      </div>

      {error && (
        <p className="text-[#f85149] text-xs">{error}</p>
      )}

      {!error && runs === null && (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 rounded bg-[var(--color-base-300)] animate-pulse" />
          ))}
        </div>
      )}

      {runs !== null && runs.length === 0 && (
        <p className="text-[var(--fg3)] text-xs text-center py-4">No runs found for {ticketKey}</p>
      )}

      {runs !== null && runs.length > 0 && (
        <div className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto">
          {runs.map((run) => (
            <button
              key={run.id}
              className="flex items-center gap-3 px-3 py-2 rounded-[var(--rounded-box)] text-left hover:bg-[var(--color-base-300)] transition-colors w-full"
              onClick={() => { onSelectRun(run.id); onClose(); }}
            >
              <StatusBadge status={run.status} />
              <span className="flex-1 min-w-0">
                <span className="text-xs text-[var(--color-base-content)] truncate block">
                  {run.repoName || "-"}
                </span>
              </span>
              <span className="text-[11px] text-[var(--fg3)] shrink-0">
                {formatRelativeTime(run.createdAt)}
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
