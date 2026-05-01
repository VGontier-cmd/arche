import { useEffect, useState } from "react";
import type { DashboardRun } from "../types";
import { fetchTicketRuns } from "../api/client";
import { Modal, ModalTitle } from "./Modal";
import { StatusPill } from "./ui/StatusPill";
import { Button } from "./ui/Button";
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
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      );
  }, [ticketKey]);

  return (
    <Modal
      isOpen={ticketKey !== null}
      onClose={onClose}
      labelledBy="ticket-history-title"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
          gap: 12,
        }}
      >
        <ModalTitle id="ticket-history-title">
          History — <span style={{ color: "var(--c-blue-200)" }}>{ticketKey}</span>
        </ModalTitle>
        <Button size="xs" variant="ghost" onClick={onClose} aria-label="Close">
          Close
        </Button>
      </div>

      {error && (
        <p style={{ fontSize: "var(--text-body-sm)", color: "var(--c-error-fg)" }}>
          {error}
        </p>
      )}

      {!error && runs === null && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="animate-pulse"
              aria-hidden="true"
              style={{
                height: 40,
                background: "var(--surface-2)",
                borderRadius: "var(--radius-sm)",
              }}
            />
          ))}
        </div>
      )}

      {runs !== null && runs.length === 0 && (
        <p
          style={{
            fontSize: "var(--text-body-sm)",
            color: "var(--c-steel-300)",
            textAlign: "center",
            padding: "16px 0",
          }}
        >
          No runs found for {ticketKey}
        </p>
      )}

      {runs !== null && runs.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            maxHeight: "60vh",
            overflowY: "auto",
            margin: "0 -6px",
            padding: "0 6px",
          }}
        >
          {runs.map((run) => (
            <button
              key={run.id}
              onClick={() => {
                onSelectRun(run.id);
                onClose();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 12px",
                borderRadius: "var(--radius-sm)",
                background: "transparent",
                border: "1px solid transparent",
                color: "var(--c-fog-100)",
                textAlign: "left",
                width: "100%",
                cursor: "pointer",
                transition:
                  "background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--surface-2)";
                e.currentTarget.style.borderColor = "var(--hairline)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = "transparent";
              }}
            >
              <StatusPill status={run.status} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    fontSize: "var(--text-body-sm)",
                    color: "var(--c-fog-100)",
                  }}
                  className="truncate block"
                >
                  {run.repoName || "—"}
                </span>
              </span>
              <span
                style={{
                  fontSize: "var(--text-label-md)",
                  color: "var(--c-steel-300)",
                  whiteSpace: "nowrap",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatRelativeTime(run.createdAt)}
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
