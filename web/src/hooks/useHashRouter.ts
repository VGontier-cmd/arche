import { useCallback, useEffect, useState } from "react";
import type { AppView } from "../types";

const VALID_VIEWS = new Set<AppView>(["runs", "repositories", "rules", "settings"]);

function parseHash(): { view: AppView; runId: string | null } {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (!hash) return { view: "runs", runId: null };

  const segments = hash.split("/");
  const view = (VALID_VIEWS.has(segments[0] as AppView) ? segments[0] : "runs") as AppView;
  const runId = view === "runs" && segments[1] ? segments[1] : null;
  return { view, runId };
}

function buildHash(view: AppView, runId?: string | null): string {
  if (view === "runs" && runId) return `#/runs/${runId}`;
  if (view === "runs") return "#/runs";
  return `#/${view}`;
}

export function useHashRouter() {
  const [state, setState] = useState(parseHash);

  useEffect(() => {
    const onHashChange = () => setState(parseHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const setRoute = useCallback((view: AppView, runId?: string | null) => {
    const newHash = buildHash(view, runId);
    if (window.location.hash !== newHash) {
      window.location.hash = newHash;
    }
    setState({ view, runId: runId ?? null });
  }, []);

  return {
    activeView: state.view,
    initialRunId: state.runId,
    setRoute,
  };
}
