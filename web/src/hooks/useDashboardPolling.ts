import { useCallback, useEffect, useState } from "react";
import { fetchSnapshot } from "../api/client";
import type { DashboardSnapshot } from "../types";

export function useDashboardPolling() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchSnapshot(selectedRunId);
      if (!selectedRunId && data.selectedRunId) {
        setSelectedRunId(data.selectedRunId);
      }
      setSnapshot(data);
    } catch (e) {
      console.error("refresh failed", e);
    }
  }, [selectedRunId]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  const selectRun = useCallback((id: string) => {
    setSelectedRunId(id);
  }, []);

  return { snapshot, selectedRunId, selectRun, refresh };
}
