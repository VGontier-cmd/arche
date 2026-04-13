import { useCallback, useEffect, useRef, useState } from "react";
import { fetchRunDetail, fetchSnapshot } from "../api/client";
import type { DashboardRun, DashboardSnapshot } from "../types";

export type ConnectionState = "connecting" | "connected" | "disconnected";
export type ConnectionInfo = { state: ConnectionState; reconnectAttempt: number };

const NOTIFY_STATUSES = new Set([
  "awaiting_plan_approval",
  "awaiting_publish_approval",
  "needs_human_input",
]);

const NOTIFY_LABELS: Record<string, string> = {
  awaiting_plan_approval: "Plan needs approval",
  awaiting_publish_approval: "Ready to publish",
  needs_human_input: "Needs your input",
};

function playNotificationSound() {
  const muted = localStorage.getItem("arche-mute") === "1";
  if (muted) return;
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
    setTimeout(() => ctx.close(), 500);
  } catch { /* audio not available */ }
}

export function useDashboard(initialRunId?: string | null) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialRunId ?? null);
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo>({ state: "connecting", reconnectAttempt: 0 });

  const selectedRunIdRef = useRef(selectedRunId);
  selectedRunIdRef.current = selectedRunId;

  const prevRunStatusesRef = useRef<Map<string, string> | null>(null);
  const isInitialLoadRef = useRef(true);
  const reconnectAttemptRef = useRef(0);

  // Request notification permission on mount
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // SSE for list data — stable connection, never depends on selectedRunId
  useEffect(() => {
    reconnectAttemptRef.current = 0;
    setConnectionInfo({ state: "connecting", reconnectAttempt: 0 });
    const es = new EventSource("/v1/dashboard/sse");
    let disconnectTimer: ReturnType<typeof setTimeout> | null = null;

    es.onmessage = (event) => {
      if (disconnectTimer) {
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
      }
      reconnectAttemptRef.current = 0;
      setConnectionInfo({ state: "connected", reconnectAttempt: 0 });
      const listData = JSON.parse(event.data);

      // Merge list data from SSE with existing run details from REST
      setSnapshot((prev) => {
        if (!prev) {
          // First load — no run details yet, will be fetched by the detail effect
          return {
            ...listData,
            selectedWorkerId: null,
            selectedWorker: null,
            selectedRunId: null,
            selectedRun: null,
            currentRun: null,
            logs: [],
            events: [],
            commands: [],
            messages: [],
            tasks: [],
            timeline: [],
            timelineTotal: 0,
          } as DashboardSnapshot;
        }
        // Keep existing run details, update lists and metadata
        return {
          ...prev,
          ...listData,
          // Preserve detail fields from REST
          selectedWorkerId: prev.selectedWorkerId,
          selectedWorker: prev.selectedWorker,
          selectedRunId: prev.selectedRunId,
          selectedRun: prev.selectedRun,
          currentRun: prev.currentRun,
          logs: prev.logs,
          events: prev.events,
          commands: prev.commands,
          messages: prev.messages,
          tasks: prev.tasks,
          timeline: prev.timeline,
          timelineTotal: prev.timelineTotal,
        };
      });

      // Browser notifications + sound for status transitions
      const allRuns = [...listData.inboxRuns, ...listData.activeRuns, ...listData.recentRuns];
      if ("Notification" in window && Notification.permission === "granted") {
        const currentStatuses = new Map(allRuns.map((r: DashboardRun) => [r.id, r.status]));

        if (isInitialLoadRef.current) {
          isInitialLoadRef.current = false;
        } else if (prevRunStatusesRef.current) {
          let notified = false;
          for (const run of allRuns) {
            if (
              NOTIFY_STATUSES.has(run.status) &&
              prevRunStatusesRef.current.get(run.id) !== run.status
            ) {
              new Notification(`Arche: ${NOTIFY_LABELS[run.status] || run.status}`, {
                body: `${run.ticketKey}: ${run.ticketTitle || run.id}`,
                tag: `arche-${run.id}-${run.status}`,
              });
              notified = true;
            }
          }
          if (notified) {
            playNotificationSound();
          }
        }
        prevRunStatusesRef.current = currentStatuses;
      }
    };

    es.onerror = () => {
      reconnectAttemptRef.current++;
      const attempt = reconnectAttemptRef.current;
      if (!disconnectTimer) {
        disconnectTimer = setTimeout(() => {
          setConnectionInfo({ state: "disconnected", reconnectAttempt: attempt });
        }, 3000);
      }
    };

    return () => {
      if (disconnectTimer) clearTimeout(disconnectTimer);
      es.close();
    };
  }, []); // Stable — no dependency on selectedRunId

  // Fetch run details when selectedRunId changes, then poll every 3s
  useEffect(() => {
    if (!selectedRunId) {
      setSnapshot((prev) =>
        prev
          ? {
              ...prev,
              selectedWorkerId: null,
              selectedWorker: null,
              selectedRunId: null,
              selectedRun: null,
              currentRun: null,
              logs: [],
              events: [],
              commands: [],
              messages: [],
              tasks: [],
              timeline: [],
              timelineTotal: 0,
            }
          : prev,
      );
      return;
    }

    let cancelled = false;
    let fetching = false;

    const fetchDetails = async () => {
      if (fetching) return; // prevent overlapping fetches
      fetching = true;
      try {
        const detail = await fetchRunDetail(selectedRunId);
        if (cancelled) return;
        setSnapshot((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            selectedWorkerId: null,
            selectedWorker: null,
            selectedRunId: detail.selectedRunId,
            selectedRun: detail.selectedRun,
            currentRun: detail.currentRun,
            logs: detail.logs,
            events: detail.events,
            commands: detail.commands,
            messages: detail.messages,
            tasks: detail.tasks,
            timeline: detail.timeline,
            timelineTotal: detail.timelineTotal,
          };
        });
      } catch (e) {
        console.error("detail fetch failed", e);
      } finally {
        fetching = false;
      }
    };

    fetchDetails();
    const pollTimer = setInterval(fetchDetails, 3_000);

    return () => {
      cancelled = true;
      clearInterval(pollTimer);
    };
  }, [selectedRunId]);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchSnapshot(selectedRunIdRef.current);
      setSnapshot(data);
    } catch (e) {
      console.error("refresh failed", e);
    }
  }, []);

  const selectRun = useCallback((id: string | null) => {
    setSelectedRunId(id);
  }, []);

  const applyOptimisticUpdate = useCallback(
    (runId: string, changes: Partial<DashboardRun>) => {
      setSnapshot((prev) => {
        if (!prev) return prev;
        const patchRun = (run: DashboardRun) =>
          run.id === runId ? { ...run, ...changes } : run;
        const patchList = (list: DashboardRun[]) => list.map(patchRun);
        return {
          ...prev,
          selectedRun: prev.selectedRun?.id === runId
            ? { ...prev.selectedRun, ...changes }
            : prev.selectedRun,
          currentRun: prev.currentRun?.id === runId
            ? { ...prev.currentRun, ...changes }
            : prev.currentRun,
          inboxRuns: patchList(prev.inboxRuns),
          activeRuns: patchList(prev.activeRuns),
          recentRuns: patchList(prev.recentRuns),
        };
      });
    },
    [],
  );

  return { snapshot, selectedRunId, selectRun, refresh, connectionInfo, applyOptimisticUpdate };
}
