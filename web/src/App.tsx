import { useCallback, useState } from "react";
import { useDashboardPolling } from "./hooks/useDashboardPolling";
import { postRespond, postRunAction } from "./api/client";
import { Header } from "./components/Header";
import { KpiCards } from "./components/KpiCards";
import { Sidebar } from "./components/Sidebar";
import { DetailPane } from "./components/DetailPane";
import { RespondModal } from "./components/RespondModal";

export default function App() {
  const { snapshot, selectedRunId, selectRun, refresh } =
    useDashboardPolling();

  const [modal, setModal] = useState<{
    runId: string;
    title: string;
  } | null>(null);

  const handleAction = useCallback(
    async (runId: string, action: string) => {
      try {
        await postRunAction(runId, action);
        await refresh();
      } catch (e) {
        alert("Action failed: " + (e instanceof Error ? e.message : e));
      }
    },
    [refresh],
  );

  const handleOpenRespond = useCallback((runId: string, title: string) => {
    setModal({ runId, title });
  }, []);

  const handleSubmitRespond = useCallback(
    async (message: string) => {
      if (!modal) return;
      setModal(null);
      try {
        await postRespond(modal.runId, message);
        await refresh();
      } catch (e) {
        alert("Respond failed: " + (e instanceof Error ? e.message : e));
      }
    },
    [modal, refresh],
  );

  if (!snapshot) {
    return (
      <div className="flex items-center justify-center h-screen text-[var(--fg2)]">
        Loading...
      </div>
    );
  }

  return (
    <>
      <Header workers={snapshot.workers} refreshedAt={snapshot.refreshedAt} />
      <KpiCards summary={snapshot.summary} />
      <div className="flex" style={{ height: "calc(100vh - 130px)" }}>
        <Sidebar
          inboxRuns={snapshot.inboxRuns}
          activeRuns={snapshot.activeRuns}
          recentRuns={snapshot.recentRuns}
          selectedRunId={selectedRunId}
          onSelectRun={selectRun}
        />
        <DetailPane
          snapshot={snapshot}
          onAction={handleAction}
          onOpenRespond={handleOpenRespond}
        />
      </div>
      <RespondModal
        isOpen={modal !== null}
        title={modal?.title || "Respond"}
        onSubmit={handleSubmitRespond}
        onClose={() => setModal(null)}
      />
    </>
  );
}
