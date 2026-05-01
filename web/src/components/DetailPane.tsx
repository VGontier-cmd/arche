import { useEffect, useRef, useState } from "react";
import {
  Copy,
  Download,
  ExternalLink,
  MousePointerClick,
  Plus,
} from "lucide-react";
import type { DashboardRun, DashboardSnapshot } from "../types";
import { downloadRunExport, fetchRunMarkdown } from "../api/client";
import { useToast } from "../context/ToastContext";
import { StatusPill } from "./ui/StatusPill";
import { DetailMeta } from "./DetailMeta";
import { DetailActions } from "./DetailActions";
import { DetailPlan } from "./DetailPlan";
import { DiffViewer } from "./DiffViewer";
import { DetailPendingQuestion } from "./DetailPendingQuestion";
import { LiveLogs } from "./LiveLogs";
import { TasksList } from "./TasksList";
import { Timeline } from "./Timeline";
import { ActionBanner } from "./ActionBanner";
import { AgentStreamPanel } from "./AgentStreamPanel";
import { RunHeadline } from "./RunHeadline";
import { Button } from "./ui/Button";
import { Kbd } from "./ui/Kbd";
import { Logo } from "./ui/Logo";

type Tab = "plan" | "diff" | "activity";

const ACTION_STATUSES = new Set([
  "awaiting_plan_approval",
  "awaiting_publish_approval",
  "needs_human_input",
]);

function defaultTab(run: DashboardRun): Tab {
  if (run.status === "awaiting_plan_approval") return "plan";
  if (run.status === "awaiting_publish_approval") return "diff";
  if (
    ["executing", "planning", "reviewing", "running", "needs_human_input", "failed"].includes(
      run.status,
    )
  )
    return "activity";
  if (run.planMarkdown) return "plan";
  return "activity";
}

export function DetailPane({
  snapshot,
  onAction,
  onOpenRespond,
  onTriggerRun,
  pendingAction,
  onViewTicketHistory,
}: {
  snapshot: DashboardSnapshot;
  onAction: (runId: string, action: string) => void;
  onOpenRespond: (runId: string, title: string) => void;
  onTriggerRun?: () => void;
  pendingAction?: string | null;
  onViewTicketHistory?: (ticketKey: string) => void;
}) {
  const run: DashboardRun | null = snapshot.selectedRun;
  const [activeTab, setActiveTab] = useState<Tab>(
    run ? defaultTab(run) : "activity",
  );
  const [copying, setCopying] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (run) setActiveTab(defaultTab(run));
  }, [run?.id]);

  const liveStatusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!run) return;
    const wasLive =
      liveStatusRef.current &&
      ["researching", "planning", "executing", "reviewing"].includes(
        liveStatusRef.current,
      );
    const isLive = ["researching", "planning", "executing", "reviewing"].includes(
      run.status,
    );
    if (isLive && !wasLive) {
      setActiveTab("activity");
    }
    liveStatusRef.current = run.status;
  }, [run?.status, run?.id]);

  if (!run) {
    const hasAnyRun =
      snapshot.inboxRuns.length +
        snapshot.activeRuns.length +
        snapshot.recentRuns.length >
      0;
    return (
      <div className="flex-1 flex items-center justify-center" style={{ padding: 24 }}>
        {hasAnyRun ? (
          <NoRunSelected />
        ) : (
          // First-time experience.
          <FirstRunInvitation onTriggerRun={onTriggerRun} />
        )}
      </div>
    );
  }

  const showBanner = ACTION_STATUSES.has(run.status);
  const currentTab: Tab = activeTab;

  const tabs: Array<{ id: Tab; label: string; show: boolean }> = [
    { id: "plan", label: "Plan", show: !!run.planMarkdown },
    { id: "diff", label: "Diff", show: !!run.diffExcerpt },
    { id: "activity", label: "Activity", show: true },
  ];

  return (
    <div
      key={run.id}
      className="flex-1 flex flex-col min-h-0"
      style={{
        animation: "fadeSlideIn 150ms var(--ease-out)",
      }}
    >
      {showBanner && (
        <ActionBanner
          run={run}
          onAction={onAction}
          onOpenRespond={onOpenRespond}
          pendingAction={pendingAction}
        />
      )}

      <div className="flex-1 overflow-y-auto" style={{ padding: "16px 20px" }}>
        {/* Header row — status pill + title + toolbar */}
        <div
          className="flex items-start justify-between"
          style={{ gap: 10, marginBottom: 12 }}
        >
          <h2
            style={{
              fontSize: "var(--text-heading-md)",
              fontWeight: 600,
              color: "var(--c-bone)",
              lineHeight: 1.4,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
            }}
          >
            <StatusPill status={run.status} mrUrl={run.mrUrl} />
            <span
              className="truncate"
              style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
            >
              {run.ticketKey}
            </span>
            <span
              className="truncate"
              style={{
                color: "var(--c-fog-300)",
                fontFamily: "var(--font-mono)",
                fontWeight: 400,
              }}
            >
              {run.ticketTitle || ""}
            </span>
          </h2>
          <div className="flex items-center shrink-0" style={{ gap: 6 }}>
            <Button
              size="xs"
              variant="ghost"
              leftIcon={<Copy size={11} strokeWidth={2} />}
              isLoading={copying}
              onClick={async () => {
                setCopying(true);
                try {
                  const markdown = await fetchRunMarkdown(run.id);
                  await navigator.clipboard.writeText(markdown);
                  toast.success("Run copied as prompt");
                } catch (err) {
                  toast.error(
                    `Copy failed: ${err instanceof Error ? err.message : String(err)}`,
                  );
                } finally {
                  setCopying(false);
                }
              }}
              aria-label="Copy full run report to clipboard"
              title="Copy ticket, plan, diff, and findings as Markdown"
            >
              {copying ? "Copying" : "Copy"}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              leftIcon={<Download size={11} strokeWidth={2} />}
              onClick={() => downloadRunExport(run.id)}
              aria-label="Export run report as Markdown"
            >
              Export
            </Button>
          </div>
        </div>

        <RunHeadline run={run} />

        <DetailMeta
          run={run}
          jiraBaseUrl={snapshot.jiraBaseUrl}
          onViewTicketHistory={onViewTicketHistory}
        />

        {run.mrUrl && (
          <div style={{ marginBottom: 16 }}>
            <a
              href={run.mrUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: "var(--radius-sm)",
                background: "var(--c-success-bg)",
                color: "var(--c-success-fg)",
                border: "1px solid var(--c-success-fg)",
                fontSize: "var(--text-body-sm)",
                fontWeight: 600,
                textDecoration: "none",
                transition:
                  "box-shadow var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = "var(--glow-success)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = "";
              }}
            >
              View Merge Request
              <ExternalLink size={12} strokeWidth={2} aria-hidden="true" />
            </a>
          </div>
        )}

        {!showBanner && (
          <DetailActions
            run={run}
            onAction={onAction}
            onOpenRespond={onOpenRespond}
            gitlabConfigured={snapshot.credentialEnv.gitlab}
            githubConfigured={snapshot.credentialEnv.github}
            pendingAction={pendingAction}
            autoCreateMr={snapshot.autoCreateMr}
          />
        )}

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Run views"
          style={{
            display: "flex",
            gap: 0,
            borderBottom: "1px solid var(--hairline)",
            marginBottom: 16,
          }}
        >
          {tabs
            .filter((t) => t.show)
            .map((tab) => {
              const isActive = currentTab === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`tabpanel-${tab.id}`}
                  id={`tab-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    padding: "10px 16px",
                    fontSize: "var(--text-body-sm)",
                    fontFamily: "var(--font-display)",
                    fontWeight: isActive ? 700 : 500,
                    letterSpacing: "-0.005em",
                    background: "transparent",
                    border: "none",
                    borderBottom: `2px solid ${
                      isActive ? "var(--c-blue-400)" : "transparent"
                    }`,
                    marginBottom: -1,
                    color: isActive ? "var(--c-blue-200)" : "var(--c-fog-300)",
                    cursor: "pointer",
                    transition:
                      "color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out)",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.color = "var(--c-fog-100)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.color = "var(--c-fog-300)";
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
        </div>

        {/* Tab content */}
        {currentTab === "plan" && (
          <div role="tabpanel" id="tabpanel-plan" aria-labelledby="tab-plan">
            <DetailPlan planMarkdown={run.planMarkdown} />
          </div>
        )}

        {currentTab === "diff" && (
          <div role="tabpanel" id="tabpanel-diff" aria-labelledby="tab-diff">
            <DiffViewer diffExcerpt={run.diffExcerpt} />
          </div>
        )}

        {currentTab === "activity" && (
          <div
            role="tabpanel"
            id="tabpanel-activity"
            aria-labelledby="tab-activity"
          >
            <DetailPendingQuestion
              pendingQuestion={run.pendingQuestion}
              currentRole={run.currentRole}
              latestFindings={run.latestFindings}
            />
            <AgentStreamPanel runId={run.id} runStatus={run.status} />
            <LiveLogs runId={run.id} runStatus={run.status} />
            <TasksList tasks={snapshot.tasks} />
            <Timeline
              timeline={snapshot.timeline}
              timelineTotal={snapshot.timelineTotal}
              runId={snapshot.selectedRunId}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function NoRunSelected() {
  return (
    <div
      style={{
        textAlign: "center",
        maxWidth: 420,
        padding: "0 16px",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          marginBottom: 16,
          display: "flex",
          justifyContent: "center",
          color: "var(--c-steel-300)",
        }}
      >
        <MousePointerClick size={36} strokeWidth={1.5} />
      </div>
      <h2
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-display-md)",
          fontWeight: 700,
          letterSpacing: "-0.015em",
          color: "var(--c-bone)",
          marginBottom: 6,
        }}
      >
        No run selected
      </h2>
      <p
        style={{
          fontSize: "var(--text-body-sm)",
          color: "var(--c-fog-300)",
          lineHeight: 1.55,
        }}
      >
        Pick a run from the sidebar, or trigger one with{" "}
        <Kbd>n</Kbd> or the <Kbd>+</Kbd> button.
      </p>
    </div>
  );
}

function FirstRunInvitation({ onTriggerRun }: { onTriggerRun?: () => void }) {
  return (
    <div
      style={{
        textAlign: "center",
        maxWidth: 460,
        padding: "0 24px",
      }}
    >
      <div
        style={{
          margin: "0 auto 16px",
          display: "flex",
          justifyContent: "center",
        }}
        aria-hidden="true"
      >
        <Logo variant="mark" size={48} ariaLabel="Arche" />
      </div>
      <h2
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-display-lg)",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          color: "var(--c-bone)",
          marginBottom: 8,
        }}
      >
        Ready when you are.
      </h2>
      <p
        style={{
          fontSize: "var(--text-body-sm)",
          color: "var(--c-fog-300)",
          lineHeight: 1.55,
          marginBottom: 22,
        }}
      >
        Arche autonomously plans, implements, reviews and ships code changes
        from a Jira ticket. Trigger your first run to see the agent in
        action.
      </p>
      <Button
        size="md"
        variant="primary"
        leftIcon={<Plus size={14} strokeWidth={2.5} />}
        onClick={onTriggerRun}
        disabled={!onTriggerRun}
      >
        Trigger your first run
      </Button>
      <p
        style={{
          fontSize: 10,
          color: "var(--c-steel-300)",
          marginTop: 16,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        Or press <Kbd>n</Kbd>
      </p>
    </div>
  );
}
