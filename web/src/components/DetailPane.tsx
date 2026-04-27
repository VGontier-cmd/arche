import { useEffect, useRef, useState } from "react";
import { MousePointerClick, Plus, Rocket } from "lucide-react";
import type { DashboardRun, DashboardSnapshot } from "../types";
import { downloadRunExport, fetchRunMarkdown } from "../api/client";
import { useToast } from "../context/ToastContext";
import { StatusBadge } from "./StatusBadge";
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
import { EmptyState } from "./EmptyState";
import { RunHeadline } from "./RunHeadline";

type Tab = "plan" | "diff" | "activity";

const ACTION_STATUSES = new Set(["awaiting_plan_approval", "awaiting_publish_approval", "needs_human_input"]);

function defaultTab(run: DashboardRun): Tab {
  if (run.status === "awaiting_plan_approval") return "plan";
  if (run.status === "awaiting_publish_approval") return "diff";
  if (["executing", "planning", "reviewing", "running", "needs_human_input", "failed"].includes(run.status)) return "activity";
  if (run.planMarkdown) return "plan";
  return "activity";
}

export function DetailPane({
  snapshot,
  onAction,
  onOpenRespond,
  pendingAction,
  onViewTicketHistory,
}: {
  snapshot: DashboardSnapshot;
  onAction: (runId: string, action: string) => void;
  onOpenRespond: (runId: string, title: string) => void;
  pendingAction?: string | null;
  onViewTicketHistory?: (ticketKey: string) => void;
}) {
  const run: DashboardRun | null = snapshot.selectedRun;
  const [activeTab, setActiveTab] = useState<Tab>(run ? defaultTab(run) : "activity");
  const [copying, setCopying] = useState(false);
  const toast = useToast();

  // Reset the active tab whenever the user picks a different run, otherwise
  // the previous run's tab choice (e.g. "plan") leaks into a new run that may
  // not even have that tab visible.
  useEffect(() => {
    if (run) setActiveTab(defaultTab(run));
  }, [run?.id]);

  // Auto-switch to Activity when the run goes live (researcher / planner /
  // executor / reviewer phase). The audience watches a single panel — the
  // agent stream + timeline — without the presenter hunting for the right
  // tab. Manual tab clicks override this in the next render cycle so the
  // user can still poke around at will.
  const liveStatusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!run) return;
    const wasLive = liveStatusRef.current && ["researching", "planning", "executing", "reviewing"].includes(liveStatusRef.current);
    const isLive = ["researching", "planning", "executing", "reviewing"].includes(run.status);
    // Only auto-jump on the leading edge of a live phase to avoid clobbering
    // an explicit user tab choice mid-stream.
    if (isLive && !wasLive) {
      setActiveTab("activity");
    }
    liveStatusRef.current = run.status;
  }, [run?.status, run?.id]);

  if (!run) {
    const hasAnyRun = snapshot.inboxRuns.length + snapshot.activeRuns.length + snapshot.recentRuns.length > 0;
    return (
      <div className="flex-1 flex items-center justify-center">
        {hasAnyRun ? (
          <EmptyState
            icon={<MousePointerClick size={36} strokeWidth={1.5} aria-hidden="true" />}
            title="No run selected"
            description="Pick a run from the sidebar, or trigger one with n or the + button."
          />
        ) : (
          // First-time experience: no runs in the system yet. Drop a clear
          // primary CTA instead of a passive "no run selected" so a fresh
          // operator immediately knows what to do next.
          <div className="text-center max-w-md px-6">
            <div className="mb-4 opacity-60 flex justify-center">
              <Rocket size={48} strokeWidth={1.5} className="text-[#58a6ff]" aria-hidden="true" />
            </div>
            <h2 className="text-base font-semibold text-[var(--color-base-content)] mb-2">
              Ready when you are
            </h2>
            <p className="text-xs text-[var(--fg2)] mb-5 leading-relaxed">
              Arche autonomously plans, implements, reviews and ships code changes from a ticket
              description. Trigger your first run to see the agent in action.
            </p>
            <button
              className="btn-primary"
              onClick={() => {
                // Synthesise the same keyboard shortcut the user would press
                // (`n`) to open the trigger modal, without needing to drill
                // a callback prop down. Cheap and matches existing UX.
                window.dispatchEvent(new KeyboardEvent("keydown", { key: "n" }));
              }}
              style={{ fontSize: "13px", padding: "8px 18px" }}
            >
              <Plus size={14} strokeWidth={2.5} className="inline-block -mt-0.5 mr-1" aria-hidden="true" />
              Trigger your first run
            </button>
            <p className="text-[10px] text-[var(--fg3)] mt-4">
              Or press <kbd className="px-1 py-0.5 rounded bg-[var(--color-base-300)] text-[var(--fg2)] font-mono">n</kbd>
            </p>
          </div>
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
    <div key={run.id} className="flex-1 flex flex-col min-h-0 animate-[fadeSlideIn_0.15s_ease-out]">
      {/* Action banner — shown above everything when human input needed */}
      {showBanner && (
        <ActionBanner
          run={run}
          onAction={onAction}
          onOpenRespond={onOpenRespond}
          pendingAction={pendingAction}
        />
      )}

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <h2 className="text-sm font-semibold text-[var(--color-base-content)] leading-snug">
            <StatusBadge status={run.status} mrUrl={run.mrUrl} />{" "}
            <span className="ml-1">{run.ticketKey}: {run.ticketTitle || ""}</span>
          </h2>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              className="btn-default"
              style={{ fontSize: "11px", padding: "3px 8px" }}
              disabled={copying}
              onClick={async () => {
                setCopying(true);
                try {
                  const markdown = await fetchRunMarkdown(run.id);
                  await navigator.clipboard.writeText(markdown);
                  toast.success("Run copied as prompt");
                } catch (err) {
                  toast.error(`Copy failed: ${err instanceof Error ? err.message : String(err)}`);
                } finally {
                  setCopying(false);
                }
              }}
              aria-label="Copy full run report to clipboard"
              title="Copy ticket, plan, diff, and findings as Markdown"
            >
              {copying ? "Copying…" : "Copy"}
            </button>
            <button
              className="btn-default"
              style={{ fontSize: "11px", padding: "3px 8px" }}
              onClick={() => downloadRunExport(run.id)}
              aria-label="Export run report as Markdown"
            >
              Export
            </button>
          </div>
        </div>

        {/* Big "what's happening" headline + animated phase diagram + live
            cost ticker. Designed for demo readability — visible from across
            the room — and to anchor the audience's attention without making
            the presenter narrate every state transition. */}
        <RunHeadline run={run} />

        {/* Compact meta row */}
        <DetailMeta run={run} jiraBaseUrl={snapshot.jiraBaseUrl} onViewTicketHistory={onViewTicketHistory} />

        {/* MR link */}
        {run.mrUrl && (
          <div className="mb-4">
            <a
              href={run.mrUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--rounded-box)] bg-[#238636] text-white hover:bg-[#2ea043] transition-colors"
            >
              View Merge Request &#8599;
            </a>
          </div>
        )}

        {/* Secondary actions (retry, archive, cancel active, create-mr) */}
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
        <div className="flex gap-0 border-b border-[var(--border-color)] mb-4">
          {tabs.filter((t) => t.show).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                currentTab === tab.id
                  ? "border-[#58a6ff] text-[#58a6ff]"
                  : "border-transparent text-[var(--fg2)] hover:text-[var(--color-base-content)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {currentTab === "plan" && (
          <DetailPlan planMarkdown={run.planMarkdown} />
        )}

        {currentTab === "diff" && (
          <DiffViewer diffExcerpt={run.diffExcerpt} />
        )}

        {currentTab === "activity" && (
          <>
            <DetailPendingQuestion
              pendingQuestion={run.pendingQuestion}
              currentRole={run.currentRole}
              latestFindings={run.latestFindings}
            />
            {/* Live SDK stream — text deltas, reasoning, partial tool args, and
                preliminary tool results (e.g. stdout from npm test). Shows the
                agent typing in real time during planner / executor / reviewer
                turns and disappears when the run goes quiet. */}
            <AgentStreamPanel runId={run.id} runStatus={run.status} />
            <LiveLogs runId={run.id} runStatus={run.status} />
            <TasksList tasks={snapshot.tasks} />
            <Timeline
              timeline={snapshot.timeline}
              timelineTotal={snapshot.timelineTotal}
              runId={snapshot.selectedRunId}
            />
          </>
        )}
      </div>
    </div>
  );
}
