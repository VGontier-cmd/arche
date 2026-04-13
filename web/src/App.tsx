import { useCallback, useMemo, useRef, useState } from "react";
import { useDashboard } from "./hooks/useDashboard";
import { useHashRouter } from "./hooks/useHashRouter";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { postRespond, postRunAction, triggerManualRun, stopWorkerApi, restartWorkerApi, purgeOfflineWorkersApi } from "./api/client";
import { useToast } from "./context/ToastContext";
import { Header } from "./components/Header";
import { KpiCards } from "./components/KpiCards";
import { NavSidebar } from "./components/NavSidebar";
import { Sidebar } from "./components/Sidebar";
import { DetailPane } from "./components/DetailPane";
import { RepositoriesView } from "./components/RepositoriesView";
import { RulesView } from "./components/RulesView";
import { SettingsView } from "./components/SettingsView";
import { RespondModal } from "./components/RespondModal";
import { ConfirmModal } from "./components/ConfirmModal";
import { TriggerRunModal } from "./components/TriggerRunModal";
import { DoctorBanner } from "./components/DoctorBanner";
import { QuickReferenceOverlay } from "./components/QuickReferenceOverlay";
import { SetupWizard } from "./components/SetupWizard";
import { SkeletonLoader } from "./components/SkeletonLoader";
import { TicketHistoryModal } from "./components/TicketHistoryModal";
import { SchedulesView } from "./components/SchedulesView";

const DESTRUCTIVE_ACTIONS: Record<string, { title: string; body: string; label: string }> = {
  cancel: {
    title: "Cancel this run?",
    body: "This will stop the current run or mark it for cancellation. This cannot be undone.",
    label: "Cancel run",
  },
  archive: {
    title: "Archive this run?",
    body: "The run will be hidden from the dashboard. You can still find it in the database.",
    label: "Archive",
  },
  "reject-publish": {
    title: "Reject publish?",
    body: "The changes will not be pushed. The worktree is retained for manual inspection.",
    label: "Reject",
  },
};

export default function App() {
  const { activeView, initialRunId, setRoute } = useHashRouter();
  const toast = useToast();
  const { snapshot, selectedRunId, selectRun: selectRunInner, refresh, connectionInfo, applyOptimisticUpdate } =
    useDashboard(initialRunId, (msg) => toast.error(msg));
  const searchRef = useRef<HTMLInputElement>(null);

  const selectRun = useCallback((id: string | null) => {
    selectRunInner(id);
    setRoute("runs", id);
  }, [selectRunInner, setRoute]);
  const setActiveView = useCallback((view: typeof activeView) => setRoute(view), [setRoute]);
  const [triggerRunOpen, setTriggerRunOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [wizardDismissed, setWizardDismissed] = useState(false);
  const [ticketHistoryKey, setTicketHistoryKey] = useState<string | null>(null);

  const [modal, setModal] = useState<{
    runId: string;
    title: string;
  } | null>(null);

  const [checkedRunIds, setCheckedRunIds] = useState<Set<string>>(new Set());

  const handleToggleCheck = useCallback((id: string) => {
    setCheckedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleCheckAllInbox = useCallback((checked: boolean) => {
    if (!snapshot) return;
    setCheckedRunIds((prev) => {
      const next = new Set(prev);
      for (const run of snapshot.inboxRuns) {
        if (checked) next.add(run.id);
        else next.delete(run.id);
      }
      return next;
    });
  }, [snapshot]);

  const handleBulkAction = useCallback(
    async (action: string) => {
      const ids = [...checkedRunIds];
      if (ids.length === 0) return;
      setConfirmModal({
        runId: "",
        action: `bulk:${action}`,
        title: `${action === "approve-plan" ? "Approve" : "Cancel"} ${ids.length} runs?`,
        body: `This will ${action === "approve-plan" ? "approve the plan for" : "cancel"} ${ids.length} selected runs.`,
        label: action === "approve-plan" ? "Approve all" : "Cancel all",
      });
    },
    [checkedRunIds],
  );

  const [confirmModal, setConfirmModal] = useState<{
    runId: string;
    action: string;
    title: string;
    body: string;
    label: string;
  } | null>(null);

  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const executeAction = useCallback(
    async (runId: string, action: string) => {
      const optimisticStatus: Record<string, string> = {
        "approve-plan": "executing",
        "approve-publish": "pushed",
        "reject-publish": "publish_rejected",
        cancel: "cancelled",
        retry: "pending",
        "retry-executor": "pending",
      };
      const newStatus = optimisticStatus[action];
      if (newStatus) {
        applyOptimisticUpdate(runId, { status: newStatus });
      }

      setPendingAction(action);
      try {
        await postRunAction(runId, action);
        if (action === "archive") {
          selectRun(null);
        }
        await refresh();
        toast.success("Done");
      } catch (e) {
        await refresh();
        toast.error("Action failed: " + (e instanceof Error ? e.message : e));
      } finally {
        setPendingAction(null);
      }
    },
    [refresh, selectRun, toast, applyOptimisticUpdate],
  );

  const handleAction = useCallback(
    (runId: string, action: string) => {
      const destructive = DESTRUCTIVE_ACTIONS[action];
      if (destructive) {
        setConfirmModal({ runId, action, ...destructive });
      } else {
        executeAction(runId, action);
      }
    },
    [executeAction],
  );

  const handleConfirm = useCallback(async () => {
    if (!confirmModal) return;
    setConfirmModal(null);

    if (confirmModal.action.startsWith("bulk:")) {
      const action = confirmModal.action.replace("bulk:", "");
      const ids = [...checkedRunIds];
      let successCount = 0;
      for (const id of ids) {
        try {
          await postRunAction(id, action);
          successCount++;
        } catch {
          // continue with remaining
        }
      }
      setCheckedRunIds(new Set());
      await refresh();
      toast.success(`${successCount}/${ids.length} runs processed`);
    } else {
      executeAction(confirmModal.runId, confirmModal.action);
    }
  }, [confirmModal, executeAction, checkedRunIds, refresh, toast]);

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
        toast.success("Response sent");
      } catch (e) {
        toast.error("Respond failed: " + (e instanceof Error ? e.message : e));
      }
    },
    [modal, refresh, toast],
  );

  const handleTriggerRun = useCallback(
    async (ticketKey: string, force: boolean) => {
      setTriggerRunOpen(false);
      try {
        await triggerManualRun(ticketKey, force);
        setActiveView("runs");
        await refresh();
        toast.success(`Run triggered for ${ticketKey}`);
      } catch (e) {
        toast.error("Trigger failed: " + (e instanceof Error ? e.message : e));
      }
    },
    [refresh, toast],
  );

  const handleStopWorker = useCallback(
    async (workerId: string) => {
      try {
        await stopWorkerApi(workerId);
        toast.success("Worker stop signal sent");
      } catch (e) {
        toast.error("Failed to stop worker: " + (e instanceof Error ? e.message : e));
      }
    },
    [toast],
  );

  const handleRestartWorker = useCallback(
    async (workerId: string) => {
      try {
        await restartWorkerApi(workerId);
        toast.success("Worker restart initiated");
      } catch (e) {
        toast.error("Failed to restart worker: " + (e instanceof Error ? e.message : e));
      }
    },
    [toast],
  );

  const handlePurgeOffline = useCallback(async () => {
    try {
      const result = await purgeOfflineWorkersApi();
      toast.success(`${result.purged.length} offline worker(s) removed`);
    } catch (e) {
      toast.error("Purge failed: " + (e instanceof Error ? e.message : e));
    }
  }, [toast]);

  // Flat list of all run IDs for j/k navigation
  const allRunIds = useMemo(() => {
    if (!snapshot) return [];
    return [...snapshot.inboxRuns, ...snapshot.activeRuns, ...snapshot.recentRuns].map((r) => r.id);
  }, [snapshot]);

  const modalOpen = modal !== null || confirmModal !== null || triggerRunOpen || helpOpen;

  const shortcuts = useMemo(() => {
    const run = snapshot?.selectedRun;
    const bindings: Record<string, () => void> = {};

    // Only enable run shortcuts when on runs view
    if (activeView === "runs") {
      bindings["j"] = bindings["ArrowDown"] = () => {
        if (!allRunIds.length) return;
        const idx = selectedRunId ? allRunIds.indexOf(selectedRunId) : -1;
        const next = allRunIds[Math.min(idx + 1, allRunIds.length - 1)];
        if (next) selectRun(next);
      };
      bindings["k"] = bindings["ArrowUp"] = () => {
        if (!allRunIds.length) return;
        const idx = selectedRunId ? allRunIds.indexOf(selectedRunId) : allRunIds.length;
        const prev = allRunIds[Math.max(idx - 1, 0)];
        if (prev) selectRun(prev);
      };
      bindings["/"] = () => searchRef.current?.focus();
    }

    bindings["Escape"] = () => {
      if (helpOpen) setHelpOpen(false);
      else if (triggerRunOpen) setTriggerRunOpen(false);
      else if (modal) setModal(null);
      else if (confirmModal) setConfirmModal(null);
    };

    // Help overlay shortcut
    bindings["?"] = () => setHelpOpen((prev) => !prev);

    // Trigger run shortcut
    bindings["n"] = () => {
      if (!modalOpen) setTriggerRunOpen(true);
    };

    // Refresh shortcut
    bindings["r"] = () => {
      if (!modalOpen) refresh();
    };

    if (!run || activeView !== "runs") return bindings;

    if (run.status === "awaiting_plan_approval") {
      bindings["a"] = () => handleAction(run.id, "approve-plan");
    } else if (run.status === "awaiting_publish_approval") {
      bindings["a"] = () => handleAction(run.id, "approve-publish");
    }

    if (run.status === "needs_human_input") {
      bindings["h"] = () => handleOpenRespond(run.id, "Respond to the run");
    }

    if (run.status === "awaiting_publish_approval") {
      bindings["x"] = () => handleAction(run.id, "reject-publish");
    }

    const terminalStatuses = ["success", "pushed", "failed", "cancelled", "publish_rejected"];
    if (!terminalStatuses.includes(run.status)) {
      bindings["c"] = () => handleAction(run.id, "cancel");
    }

    if (run.status === "failed") {
      bindings["t"] = () => handleAction(run.id, "retry");
    }

    return bindings;
  }, [snapshot, selectedRunId, allRunIds, selectRun, handleAction, handleOpenRespond, modal, confirmModal, activeView, modalOpen, triggerRunOpen]);

  useKeyboardShortcuts(shortcuts, modalOpen);

  if (!snapshot) {
    return <SkeletonLoader />;
  }

  return (
    <div className="flex h-screen">
      <NavSidebar
        activeView={activeView}
        onChangeView={setActiveView}
        onTriggerRun={() => setTriggerRunOpen(true)}
        onHelp={() => setHelpOpen(true)}
        summary={snapshot.summary}
      />
      <div className="flex flex-col flex-1 min-w-0">
        <Header workers={snapshot.workers} services={snapshot.services} systemStats={snapshot.systemStats} refreshedAt={snapshot.refreshedAt} connectionInfo={connectionInfo} onStopWorker={handleStopWorker} onRestartWorker={handleRestartWorker} onPurgeOffline={handlePurgeOffline} />
        <DoctorBanner snapshot={snapshot} />
        <KpiCards summary={snapshot.summary} />
        <div className="flex flex-1 min-h-0">
          {activeView === "runs" && snapshot.repositoryCount === 0 && !wizardDismissed ? (
            <SetupWizard snapshot={snapshot} onComplete={() => { setWizardDismissed(true); refresh(); }} />
          ) : activeView === "runs" && (
            <div className="flex flex-col lg:flex-row flex-1 min-w-0">
              <Sidebar
                ref={searchRef}
                inboxRuns={snapshot.inboxRuns}
                activeRuns={snapshot.activeRuns}
                recentRuns={snapshot.recentRuns}
                selectedRunId={selectedRunId}
                onSelectRun={selectRun}
                jiraBaseUrl={snapshot.jiraBaseUrl}
                checkedRunIds={checkedRunIds}
                onToggleCheck={handleToggleCheck}
                onCheckAllInbox={handleCheckAllInbox}
                onBulkAction={handleBulkAction}
                workers={snapshot.workers}
              />
              <DetailPane
                snapshot={snapshot}
                onAction={handleAction}
                onOpenRespond={handleOpenRespond}
                pendingAction={pendingAction}
                onViewTicketHistory={setTicketHistoryKey}
              />
            </div>
          )}
          {activeView === "repositories" && (
            <div className="flex-1 overflow-y-auto">
              <RepositoriesView />
            </div>
          )}
          {activeView === "rules" && (
            <div className="flex-1 overflow-y-auto">
              <RulesView />
            </div>
          )}
          {activeView === "settings" && (
            <div className="flex-1 overflow-y-auto">
              <SettingsView />
            </div>
          )}
          {activeView === "schedules" && (
            <div className="flex-1 overflow-y-auto">
              <SchedulesView />
            </div>
          )}
        </div>
      </div>
      <RespondModal
        isOpen={modal !== null}
        title={modal?.title || "Respond"}
        onSubmit={handleSubmitRespond}
        onClose={() => setModal(null)}
      />
      <ConfirmModal
        isOpen={confirmModal !== null}
        title={confirmModal?.title || ""}
        body={confirmModal?.body || ""}
        confirmLabel={confirmModal?.label}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmModal(null)}
      />
      <TriggerRunModal
        isOpen={triggerRunOpen}
        onSubmit={handleTriggerRun}
        onClose={() => setTriggerRunOpen(false)}
      />
      {helpOpen && <QuickReferenceOverlay onClose={() => setHelpOpen(false)} />}
      <TicketHistoryModal
        ticketKey={ticketHistoryKey}
        onClose={() => setTicketHistoryKey(null)}
        onSelectRun={(id) => { selectRun(id); setActiveView("runs"); }}
      />
    </div>
  );
}
