import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSnapshot, sseUrl } from "../api/client";
import type { DashboardRun, DashboardSnapshot } from "../types";

export type ConnectionState = "connecting" | "connected" | "disconnected";

export function useDashboard() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");

  const selectedRunIdRef = useRef(selectedRunId);
  selectedRunIdRef.current = selectedRunId;

  useEffect(() => {
    setConnectionState("connecting");
    const es = new EventSource(sseUrl(selectedRunId));
    let disconnectTimer: ReturnType<typeof setTimeout> | null = null;

    es.onmessage = (event) => {
      if (disconnectTimer) {
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
      }
      setConnectionState("connected");
      const data: DashboardSnapshot = JSON.parse(event.data);
      if (!selectedRunIdRef.current && data.selectedRunId) {
        setSelectedRunId(data.selectedRunId);
      }
      setSnapshot(data);
    };

    es.onerror = () => {
      // Give EventSource 3s to auto-reconnect before showing disconnected
      if (!disconnectTimer) {
        disconnectTimer = setTimeout(() => setConnectionState("disconnected"), 3000);
      }
    };

    return () => {
      if (disconnectTimer) clearTimeout(disconnectTimer);
      es.close();
    };
  }, [selectedRunId]);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchSnapshot(selectedRunId);
      setSnapshot(data);
    } catch (e) {
      console.error("refresh failed", e);
    }
  }, [selectedRunId]);

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

  return { snapshot, selectedRunId, selectRun, refresh, connectionState, applyOptimisticUpdate };
}
