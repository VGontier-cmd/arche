import { useCallback, useMemo, useRef, useState } from "react";
import { useDashboard } from "./hooks/useDashboard";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { postRespond, postRunAction } from "./api/client";
import { useToast } from "./context/ToastContext";
import { Header } from "./components/Header";
import { KpiCards } from "./components/KpiCards";
import { Sidebar } from "./components/Sidebar";
import { DetailPane } from "./components/DetailPane";
import { RespondModal } from "./components/RespondModal";
import { ConfirmModal } from "./components/ConfirmModal";
import { SkeletonLoader } from "./components/SkeletonLoader";

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
  const { snapshot, selectedRunId, selectRun, refresh, connectionState, applyOptimisticUpdate } =
    useDashboard();
  const toast = useToast();
  const searchRef = useRef<HTMLInputElement>(null);

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

  const executeAction = useCallback(
    async (runId: string, action: string) => {
      // Optimistic status mapping
      const optimisticStatus: Record<string, string> = {
        "approve-plan": "executing",
        "approve-publish": "pushed",
        "reject-publish": "publish_rejected",
        cancel: "cancelled",
        retry: "pending",
      };
      const newStatus = optimisticStatus[action];
      if (newStatus) {
        applyOptimisticUpdate(runId, { status: newStatus });
      }

      try {
        await postRunAction(runId, action);
        if (action === "archive") {
          selectRun(null);
        }
        await refresh();
        toast.success("Done");
      } catch (e) {
        // Revert optimistic update on error
        await refresh();
        toast.error("Action failed: " + (e instanceof Error ? e.message : e));
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

  // Flat list of all run IDs for j/k navigation
  const allRunIds = useMemo(() => {
    if (!snapshot) return [];
    return [...snapshot.inboxRuns, ...snapshot.activeRuns, ...snapshot.recentRuns].map((r) => r.id);
  }, [snapshot]);

  const modalOpen = modal !== null || confirmModal !== null;

  const shortcuts = useMemo(() => {
    const run = snapshot?.selectedRun;
    const bindings: Record<string, () => void> = {};

    // Run navigation
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

    // Focus search
    bindings["/"] = () => searchRef.current?.focus();

    // Escape closes modals (already handled by modals themselves, but useful as fallback)
    bindings["Escape"] = () => {
      if (modal) setModal(null);
      else if (confirmModal) setConfirmModal(null);
    };

    if (!run) return bindings;

    // Contextual approve
    if (run.status === "awaiting_plan_approval") {
      bindings["a"] = () => handleAction(run.id, "approve-plan");
    } else if (run.status === "awaiting_publish_approval") {
      bindings["a"] = () => handleAction(run.id, "approve-publish");
    }

    // Respond
    if (run.status === "needs_human_input") {
      bindings["h"] = () => handleOpenRespond(run.id, "Respond to the run");
    }

    // Reject publish
    if (run.status === "awaiting_publish_approval") {
      bindings["x"] = () => handleAction(run.id, "reject-publish");
    }

    // Cancel (non-terminal)
    const terminalStatuses = ["success", "pushed", "failed", "cancelled", "publish_rejected"];
    if (!terminalStatuses.includes(run.status)) {
      bindings["c"] = () => handleAction(run.id, "cancel");
    }

    // Retry
    if (run.status === "failed") {
      bindings["t"] = () => handleAction(run.id, "retry");
    }

    return bindings;
  }, [snapshot, selectedRunId, allRunIds, selectRun, handleAction, handleOpenRespond, modal, confirmModal]);

  useKeyboardShortcuts(shortcuts, modalOpen);

  if (!snapshot) {
    return <SkeletonLoader />;
  }

  return (
    <>
      <Header workers={snapshot.workers} services={snapshot.services} systemStats={snapshot.systemStats} refreshedAt={snapshot.refreshedAt} connectionState={connectionState} />
      <KpiCards summary={snapshot.summary} />
      <div className="flex flex-col lg:flex-row lg:h-[calc(100vh-130px)]">
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
      <ConfirmModal
        isOpen={confirmModal !== null}
        title={confirmModal?.title || ""}
        body={confirmModal?.body || ""}
        confirmLabel={confirmModal?.label}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmModal(null)}
      />
    </>
  );
}
