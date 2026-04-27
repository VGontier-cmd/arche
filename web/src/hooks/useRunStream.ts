import { useEffect, useRef } from "react";

/**
 * Subscribes to the per-run activity SSE stream while the run is executing.
 * Calls `onActivity` each time a new event arrives so the caller can trigger
 * an immediate detail re-fetch instead of waiting for the 3 s REST poll.
 *
 * Stores the EventSource in a ref so React StrictMode (double-mount) and
 * rapid runId switches don't leak overlapping connections.
 */
export function useRunStream(
  runId: string | null,
  runStatus: string | null,
  onActivity: () => void,
) {
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Tear down any previous connection before opening a new one.
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    // Only subscribe while the run is actively executing.
    if (!runId || runStatus !== "executing") return;

    const es = new EventSource(`/v1/runs/${runId}/stream`);
    esRef.current = es;

    es.onmessage = () => {
      onActivityRef.current();
    };

    es.onerror = () => {
      // The browser will auto-reconnect; the REST poll keeps data fresh in the
      // meantime. Log so dev consoles surface persistent failures, but never
      // throw or interrupt the parent render cycle.
      if (es.readyState === EventSource.CLOSED) {
        console.warn("[useRunStream] connection closed for run", runId);
      }
    };

    return () => {
      es.close();
      if (esRef.current === es) {
        esRef.current = null;
      }
    };
  }, [runId, runStatus]);
}
