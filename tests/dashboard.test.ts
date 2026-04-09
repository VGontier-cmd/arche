import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DashboardSnapshot } from "../src/lib/arche/dashboard";
import {
  createDashboardControllerState,
  handleDashboardInput,
  reconcileDashboardControllerState,
} from "../src/lib/arche/dashboard-controller";
import { renderDashboardLayout } from "../src/lib/arche/dashboard-ui";

describe("dashboard read model", () => {
  let workspace: string;
  let runtimeRoot: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "arche-dashboard-"));
    runtimeRoot = join(workspace, "runtime");
    const configPath = join(workspace, "orchestrator.yml");

    process.env.DATABASE_URL = join(runtimeRoot, "arche.db");
    process.env.ARCHE_CONFIG_PATH = configPath;
    process.env.ARCHE_RUNTIME_ROOT = runtimeRoot;
    process.env.ARCHE_LOG_LEVEL = "error";
    process.env.ARCHE_DEFAULT_API_KEY = "provider-token";

    await writeFile(
      configPath,
      [
        "runtime:",
        `  root_dir: ${runtimeRoot}`,
        `  repos_dir: ${runtimeRoot}/repos`,
        `  runs_dir: ${runtimeRoot}/runs`,
        `  logs_dir: ${runtimeRoot}/logs`,
        "worker:",
        "  poll_interval_seconds: 1",
        "  lease_ttl_seconds: 60",
        "  max_agent_steps: 4",
        "  max_run_seconds: 60",
        "policy:",
        "  assignee: agent-dev",
        "  required_status: In Progress",
        "  required_label: agent-ready",
        "  allowed_issue_types:",
        "    - Bug",
        "  max_changed_files: 20",
        "  max_changed_lines: 500",
        "  description_min_length: 20",
        "sandbox:",
        "  image: arche-test:latest",
        "  network: bridge",
        "  shell: /bin/bash",
        "defaults:",
        "  allowed_commands: []",
        "  validation_commands: []",
        "workflow:",
        "  mode: plan_execute_review",
        "  max_review_cycles: 3",
        "  require_plan_approval: true",
        "  require_publish_approval: true",
        "executors:",
        "  defaults:",
        "    planner: qwen",
        "    executor: kimi",
        "    reviewer: openai",
        "  profiles:",
        "    qwen:",
        "      driver: openai_compatible_api",
        "      base_url: https://qwen.example.com/v1",
        "      model: qwen-plus",
        "      api_key_env: ARCHE_DEFAULT_API_KEY",
        "      timeout_seconds: 60",
        "      max_actions: 8",
        "      temperature: 0.1",
        "    kimi:",
        "      driver: openai_compatible_api",
        "      base_url: https://kimi.example.com/v1",
        "      model: kimi-k2",
        "      api_key_env: ARCHE_DEFAULT_API_KEY",
        "      timeout_seconds: 60",
        "      max_actions: 8",
        "      temperature: 0.1",
        "    openai:",
        "      driver: openai_compatible_api",
        "      base_url: https://api.openai.com/v1",
        "      model: gpt-5.4-mini",
        "      api_key_env: ARCHE_DEFAULT_API_KEY",
        "      timeout_seconds: 60",
        "      max_actions: 8",
        "      temperature: 0.1",
        "bootstrap:",
        "  repositories: []",
        "  repo_rules: []",
        "",
      ].join("\n"),
      "utf8",
    );

    const sqlite = (globalThis as { __archeSqlite?: { close: () => void } }).__archeSqlite;
    sqlite?.close();
    delete (globalThis as { __archeSqlite?: unknown }).__archeSqlite;
    delete (globalThis as { __archeEnv?: unknown }).__archeEnv;
    vi.resetModules();
  });

  afterEach(async () => {
    const sqlite = (globalThis as { __archeSqlite?: { close: () => void } }).__archeSqlite;
    sqlite?.close();
    delete (globalThis as { __archeSqlite?: unknown }).__archeSqlite;
    delete (globalThis as { __archeEnv?: unknown }).__archeEnv;
    await rm(workspace, { recursive: true, force: true });
  });

  it("buckets inbox, active, and recent runs and builds a unified timeline", async () => {
    const [{ ensureArcheReady }, runsModule, workersModule, dashboardModule, { db }, schema] =
      await Promise.all([
        import("../src/lib/bootstrap"),
        import("../src/lib/arche/runs"),
        import("../src/lib/arche/workers"),
        import("../src/lib/arche/dashboard"),
        import("../src/lib/db/client"),
        import("../src/lib/db/schema"),
      ]);

    await ensureArcheReady();

    const issue = {
      key: "PROJ-500",
      title: "Dashboard test",
      description: "Exercise the dashboard read model and operator views.",
      status: "In Progress",
      issueType: "Bug",
      labels: ["agent-ready"],
      assignee: "agent-dev",
      projectKey: "PROJ",
      raw: {},
    };

    const inboxRun = await runsModule.createRun({ issue, source: "manual", repository: null });
    const activeRun = await runsModule.createRun({
      issue: { ...issue, key: "PROJ-501", title: "Active run" },
      source: "manual",
      repository: null,
    });
    const failedRun = await runsModule.createRun({
      issue: { ...issue, key: "PROJ-502", title: "Failed run" },
      source: "manual",
      repository: null,
    });
    const successRun = await runsModule.createRun({
      issue: { ...issue, key: "PROJ-503", title: "Success run" },
      source: "manual",
      repository: null,
    });

    const primaryWorker = await workersModule.registerWorker({
      hostname: "builder-a",
      pid: 1234,
      metadata: { pollIntervalSeconds: 1 },
    });
    const secondaryWorker = await workersModule.registerWorker({
      hostname: "builder-b",
      pid: 5678,
      metadata: { pollIntervalSeconds: 1 },
    });

    const now = Date.now();

    await workersModule.updateWorkerState(primaryWorker.id, {
      status: "waiting",
      activity: "waiting_provider",
      currentRunId: inboxRun.id,
      currentTicketKey: inboxRun.ticketKey,
      currentStep: 2,
    });

    await db
      .update(schema.workers)
      .set({
        lastHeartbeatAt: new Date(now - 10_000),
        status: "idle",
        activity: "polling",
      })
      .where(eq(schema.workers.id, secondaryWorker.id));

    await db
      .update(schema.runs)
      .set({
        workerId: primaryWorker.id,
        status: "awaiting_publish_approval",
        currentRole: "reviewer",
        currentCycle: 2,
        sandboxId: "sandbox-1",
        modelName: "kimi-k2",
        plannerProfile: "qwen",
        executorProfile: "kimi",
        reviewerProfile: "openai",
        plannerDriver: "openai_compatible_api",
        executorDriver: "openai_compatible_api",
        reviewerDriver: "openai_compatible_api",
        branchName: "jira/PROJ-500-dashboard-test",
        worktreePath: "/tmp/arche/worktrees/PROJ-500",
        mrUrl: "https://gitlab.example.com/mr/500",
        summary: "Ready to publish.",
        latestReviewSummary: "Review passed after validation.",
        planMarkdown: "1. Inspect popup styles\n2. Ship bounded fix",
        planRisks: ["Potential layout regression on small screens"],
        planOpenQuestions: ["Need design confirmation?"],
        pendingQuestion: null,
        latestHumanResponse: null,
        updatedAt: new Date(now),
      })
      .where(eq(schema.runs.id, inboxRun.id));

    await db
      .update(schema.runs)
      .set({
        workerId: primaryWorker.id,
        status: "executing",
        currentRole: "executor",
        currentCycle: 1,
        plannerProfile: "qwen",
        executorProfile: "kimi",
        reviewerProfile: "openai",
        plannerDriver: "openai_compatible_api",
        executorDriver: "openai_compatible_api",
        reviewerDriver: "openai_compatible_api",
        updatedAt: new Date(now - 1_000),
      })
      .where(eq(schema.runs.id, activeRun.id));

    await db
      .update(schema.runs)
      .set({
        status: "failed",
        failureReason: "Validation failed",
        finishedAt: new Date(now - 2_000),
        updatedAt: new Date(now - 2_000),
      })
      .where(eq(schema.runs.id, failedRun.id));

    await db
      .update(schema.runs)
      .set({
        status: "success",
        summary: "Completed an earlier change.",
        finishedAt: new Date(now - 3_000),
        updatedAt: new Date(now - 3_000),
      })
      .where(eq(schema.runs.id, successRun.id));

    await db.insert(schema.runMessages).values({
      runId: inboxRun.id,
      timestamp: new Date(now - 500),
      sequence: 1,
      role: "assistant",
      kind: "action",
      contentExcerpt: "Requested a patch application.",
    });
    await db.insert(schema.runEvents).values({
      runId: inboxRun.id,
      timestamp: new Date(now - 400),
      type: "provider.request_started",
      payload: { role: "reviewer", cycle: 2 },
    });
    await db.insert(schema.runCommands).values({
      runId: inboxRun.id,
      timestamp: new Date(now - 300),
      phase: "validation",
      command: "pnpm test",
      returncode: 0,
      durationMs: 120,
      stdoutExcerpt: "ok",
      stderrExcerpt: null,
      stdoutArtifactPath: null,
      stderrArtifactPath: null,
    });
    await db.insert(schema.runLogs).values({
      runId: inboxRun.id,
      timestamp: new Date(now - 200),
      stream: "system",
      message: "waiting for publish approval",
    });
    await db.insert(schema.runTasks).values({
      runId: inboxRun.id,
      role: "reviewer",
      cycle: 2,
      status: "completed",
      modelName: "gpt-5.4-mini",
      profileName: "openai",
      strategy: "direct",
      summary: "Review approved with no remaining findings.",
      outputJson: {
        decision: "approve",
        summary: "Review approved with no remaining findings.",
        findings: [],
      },
      startedAt: new Date(now - 100),
      finishedAt: new Date(now - 50),
    });

    const snapshot = await dashboardModule.getDashboardSnapshot({ nowMs: now });

    expect(snapshot.summary).toEqual({
      inboxCount: 1,
      activeCount: 1,
      failedCount: 1,
      workerCount: 2,
      offlineWorkerCount: 1,
    });
    expect(snapshot.selectedRunId).toBe(inboxRun.id);
    expect(snapshot.selectedRun?.id).toBe(inboxRun.id);
    expect(snapshot.selectedRun?.status).toBe("awaiting_publish_approval");
    expect(snapshot.selectedRun?.currentRole).toBe("reviewer");
    expect(snapshot.selectedRun?.currentCycle).toBe(2);
    expect(snapshot.selectedWorker?.id).toBe(primaryWorker.id);
    expect(snapshot.selectedWorker?.currentRunId).toBe(inboxRun.id);
    expect(snapshot.inboxRuns.map((run) => run.id)).toEqual([inboxRun.id]);
    expect(snapshot.activeRuns.map((run) => run.id)).toEqual([activeRun.id]);
    expect(snapshot.recentRuns.map((run) => run.id)).toEqual([failedRun.id, successRun.id]);
    expect(snapshot.timeline.map((item) => item.source)).toEqual([
      "message",
      "event",
      "command",
      "log",
      "task",
      "event",
      "log",
    ]);
    expect(snapshot.timeline[0]).toMatchObject({
      source: "message",
      title: "assistant/action",
    });
    expect(snapshot.timeline.at(-2)).toMatchObject({
      source: "event",
      title: "run.created",
    });
    expect(snapshot.timeline.at(-1)).toMatchObject({
      source: "log",
      title: "[system] run created from manual for PROJ-500",
    });

    const offlineWorker = snapshot.workers.find((worker) => worker.id === secondaryWorker.id);
    expect(offlineWorker?.offline).toBe(true);
    expect(offlineWorker?.status).toBe("idle");
  });
});

describe("dashboard controller", () => {
  it("navigates runs, tabs, panes, and confirmation flows predictably", () => {
    const snapshot = makeSnapshot();
    let state = reconcileDashboardControllerState(createDashboardControllerState(), snapshot);

    expect(state.selectedRunId).toBe("run-1");
    expect(state.highlightedRunId).toBe("run-1");
    expect(state.focusedPane).toBe("lists");

    ({ state } = handleDashboardInput(state, snapshot, "down"));
    expect(state.highlightedRunId).toBe("run-2");

    ({ state } = handleDashboardInput(state, snapshot, "enter"));
    expect(state.selectedRunId).toBe("run-2");

    ({ state } = handleDashboardInput(state, snapshot, "tab"));
    expect(state.focusedPane).toBe("detail");

    ({ state } = handleDashboardInput(state, snapshot, "2"));
    expect(state.detailTab).toBe("plan");

    ({ state } = handleDashboardInput(state, snapshot, "down"));
    expect(state.scrollByPane.detail).toBe(1);

    ({ state } = handleDashboardInput(state, snapshot, "tab"));
    expect(state.focusedPane).toBe("timeline");

    ({ state } = handleDashboardInput(state, snapshot, "down"));
    expect(state.scrollByPane.timeline).toBe(1);

    const refreshResult = handleDashboardInput(state, snapshot, "r");
    expect(refreshResult.effect).toEqual({ type: "refresh" });

    const quitResult = handleDashboardInput(state, snapshot, "q");
    expect(quitResult.effect).toEqual({ type: "quit" });

    const approveSnapshot = makeSnapshot({ selectedRunId: "run-1" });
    state = reconcileDashboardControllerState(createDashboardControllerState(), approveSnapshot);
    let result = handleDashboardInput(state, approveSnapshot, "a");
    expect(result.state.modal).toMatchObject({
      kind: "confirm",
      actionKind: "approve_plan",
      runId: "run-1",
    });

    result = handleDashboardInput(result.state, approveSnapshot, "enter");
    expect(result.effect).toEqual({
      type: "execute_action",
      action: {
        kind: "approve_plan",
        runId: "run-1",
      },
    });
  });

  it("opens the human reply modal and submits a response", () => {
    const snapshot = makeSnapshot({ selectedRunId: "run-2" });
    let state = reconcileDashboardControllerState(createDashboardControllerState(), snapshot);

    const openResult = handleDashboardInput(state, snapshot, "h");
    state = openResult.state;
    expect(state.modal).toMatchObject({
      kind: "human_reply",
      runId: "run-2",
      ticketKey: "PROJ-2",
    });

    ({ state } = handleDashboardInput(state, snapshot, "x", "x"));
    ({ state } = handleDashboardInput(state, snapshot, "y", "y"));
    ({ state } = handleDashboardInput(state, snapshot, "backspace"));
    const submitResult = handleDashboardInput(state, snapshot, "C-s");

    expect(submitResult.effect).toEqual({
      type: "execute_action",
      action: {
        kind: "respond",
        runId: "run-2",
        message: "x",
      },
    });
  });
});

describe("dashboard ui render", () => {
  it("renders run-centric sections, overview actions, plan, and findings", () => {
    const snapshot = makeSnapshot();
    const overviewState = reconcileDashboardControllerState(createDashboardControllerState(), snapshot);
    const overview = renderDashboardLayout(snapshot, overviewState, "Connected", {
      screenWidth: 120,
      leftHeight: 40,
      leftWidth: 46,
      detailHeight: 40,
      detailWidth: 72,
      timelineHeight: 20,
      timelineWidth: 72,
    });

    expect(overview.header).toContain("______");
    expect(overview.header).toContain("Inbox");
    expect(overview.header).toContain("Projects");
    expect(overview.header).toContain("PROJ");
    expect(overview.header).toContain("Selected");
    expect(overview.header).toContain("PROJ-1");
    expect(overview.header).toContain("awaiting_plan_approval");
    expect(overview.left).toContain("Flow Mix");
    expect(overview.left).toContain("Projects (1)");
    expect(overview.left).toContain("Inbox (2)");
    expect(overview.left).toContain("Active (1)");
    expect(overview.left).toContain("Recent (1)");
    expect(overview.left).toContain("Workers (1)");
    expect(overview.detail).toContain("Workflow Lane");
    expect(overview.detail).toContain("Planner");
    expect(overview.detail).toContain("qwen");
    expect(overview.detail).toContain("Available actions:");
    expect(overview.detail).toContain("Approve plan");
    expect(overview.footer).toContain("Tab");
    expect(overview.footer).toContain("Inbox");

    const planState = {
      ...overviewState,
      detailTab: "plan" as const,
      focusedPane: "detail" as const,
    };
    const plan = renderDashboardLayout(snapshot, planState, "Connected", {
      screenWidth: 120,
      leftHeight: 40,
      leftWidth: 46,
      detailHeight: 40,
      detailWidth: 72,
      timelineHeight: 20,
      timelineWidth: 72,
    });
    expect(plan.detail).toContain("Approved plan:");
    expect(plan.detail).toContain("Plan radar:");
    expect(plan.detail).toContain("Inspect popup");
    expect(plan.detail).toContain("Potential regression on mobile");
    expect(plan.detail).toContain("Confirm spacing with design");

    const findingsState = {
      ...overviewState,
      detailTab: "findings" as const,
    };
    const findings = renderDashboardLayout(snapshot, findingsState, "Connected", {
      screenWidth: 120,
      leftHeight: 40,
      leftWidth: 46,
      detailHeight: 40,
      detailWidth: 72,
      timelineHeight: 20,
      timelineWidth: 72,
    });
    expect(findings.detail).toContain("Review summary:");
    expect(findings.detail).toContain("Needs one more patch.");
    expect(findings.detail).toContain("Findings radar:");
    expect(findings.detail).toContain("Guard null branch");
    expect(findings.detail).toContain("/repo/src/popup.ts");
    expect(findings.timeline).toContain("assistant/action");
    expect(findings.timeline).toContain("[log]");
    expect(findings.timeline).toContain("[system]");
    expect(findings.timeline).toContain("[planner#0] completed");
  });
});

function makeSnapshot(
  options: {
    selectedRunId?: string;
  } = {},
): DashboardSnapshot {
  const run1 = makeRun({
    id: "run-1",
    ticketKey: "PROJ-1",
    status: "awaiting_plan_approval",
    currentRole: "planner",
    currentCycle: 0,
    summary: "Plan ready.",
  });
  const run2 = makeRun({
    id: "run-2",
    ticketKey: "PROJ-2",
    status: "needs_human_input",
    currentRole: "executor",
    currentCycle: 1,
    pendingQuestion: "Current question?",
    latestHumanResponse: "",
    summary: "Blocked on a product decision.",
  });
  const run3 = makeRun({
    id: "run-3",
    ticketKey: "PROJ-3",
    status: "reviewing",
    currentRole: "reviewer",
    currentCycle: 1,
  });
  const run4 = makeRun({
    id: "run-4",
    ticketKey: "PROJ-4",
    status: "failed",
    currentRole: "reviewer",
    currentCycle: 2,
    failureReason: "Validation failed",
  });

  const runById = new Map([
    [run1.id, run1],
    [run2.id, run2],
    [run3.id, run3],
    [run4.id, run4],
  ]);
  const selectedRun = runById.get(options.selectedRunId ?? run1.id) ?? run1;

  return {
    refreshedAt: "2026-04-07T09:00:00.000Z",
    offlineThresholdMs: 5_000,
    summary: {
      inboxCount: 2,
      activeCount: 1,
      failedCount: 1,
      workerCount: 1,
      offlineWorkerCount: 0,
    },
    workers: [
      {
        id: "worker-a",
        name: "worker-a:1234",
        hostname: "worker-a",
        pid: 1234,
        status: "waiting",
        activity: "waiting_provider",
        currentRunId: selectedRun.id,
        currentTicketKey: selectedRun.ticketKey,
        currentStep: 1,
        lastError: null,
        metadata: {},
        startedAt: null,
        lastHeartbeatAt: "2026-04-07T09:00:00.000Z",
        heartbeatAgeMs: 200,
        offline: false,
      },
    ],
    selectedWorkerId: "worker-a",
    selectedWorker: {
      id: "worker-a",
      name: "worker-a:1234",
      hostname: "worker-a",
      pid: 1234,
      status: "waiting",
      activity: "waiting_provider",
      currentRunId: selectedRun.id,
      currentTicketKey: selectedRun.ticketKey,
      currentStep: 1,
      lastError: null,
      metadata: {},
      startedAt: null,
      lastHeartbeatAt: "2026-04-07T09:00:00.000Z",
      heartbeatAgeMs: 200,
      offline: false,
    },
    selectedRunId: selectedRun.id,
    selectedRun,
    currentRun: selectedRun,
    inboxRuns: [run1, run2],
    activeRuns: [run3],
    recentRuns: [run4],
    logs: [
      {
        id: 1,
        runId: selectedRun.id,
        timestamp: "2026-04-07T09:00:02.000Z",
        stream: "system",
        message: "waiting for provider response",
      },
    ],
    events: [
      {
        id: 1,
        runId: selectedRun.id,
        timestamp: "2026-04-07T09:00:01.000Z",
        type: "provider.request_started",
        payload: { role: selectedRun.currentRole },
      },
    ],
    commands: [
      {
        id: 1,
        runId: selectedRun.id,
        timestamp: "2026-04-07T09:00:01.500Z",
        phase: "validation",
        command: "pnpm test",
        returncode: 0,
        durationMs: 150,
        stdoutExcerpt: "ok",
        stderrExcerpt: null,
        stdoutArtifactPath: null,
        stderrArtifactPath: null,
      },
    ],
    messages: [
      {
        id: 1,
        runId: selectedRun.id,
        timestamp: "2026-04-07T09:00:00.500Z",
        sequence: 1,
        role: "assistant",
        kind: "action",
        contentExcerpt: "Requested a patch application.",
      },
    ],
    tasks: [
      {
        id: 1,
        runId: selectedRun.id,
        role: "planner",
        cycle: 0,
        status: "completed",
        modelName: "qwen-plus",
        profileName: "qwen",
        strategy: "direct",
        summary: "Plan produced.",
        outputJson: {
          planMarkdown: "1. Inspect popup\n2. Ship bounded fix",
          risks: ["Potential regression on mobile"],
          openQuestions: ["Confirm spacing with design"],
        },
        artifactsPath: null,
        startedAt: "2026-04-07T09:00:03.000Z",
        finishedAt: "2026-04-07T09:00:04.000Z",
      },
    ],
    timeline: [
      {
        id: "message-1",
        source: "message",
        timestamp: "2026-04-07T09:00:00.500Z",
        title: "assistant/action",
        detail: "Requested a patch application.",
      },
      {
        id: "event-1",
        source: "event",
        timestamp: "2026-04-07T09:00:01.000Z",
        title: "provider.request_started",
        detail: JSON.stringify({ role: selectedRun.currentRole }),
      },
      {
        id: "command-1",
        source: "command",
        timestamp: "2026-04-07T09:00:01.500Z",
        title: "[validation] exit=0 pnpm test",
        detail: "ok",
      },
      {
        id: "log-1",
        source: "log",
        timestamp: "2026-04-07T09:00:02.000Z",
        title: "[system] waiting for provider response",
        detail: null,
      },
      {
        id: "task-1",
        source: "task",
        timestamp: "2026-04-07T09:00:04.000Z",
        title: "[planner#0] completed",
        detail: "qwen direct qwen-plus Plan produced.",
      },
    ],
  };
}

function makeRun(
  overrides: Partial<NonNullable<DashboardSnapshot["selectedRun"]>> = {},
): NonNullable<DashboardSnapshot["selectedRun"]> {
  return {
    id: "run-1",
    source: "manual",
    status: "awaiting_plan_approval",
    ticketKey: "PROJ-1",
    ticketTitle: "Fix popup alignment",
    ticketProjectKey: "PROJ",
    ticketPayload: { key: "PROJ-1" },
    repoName: "web-app",
    repositoryId: "repo-1",
    inferenceServerId: null,
    providerType: null,
    workflowMode: "plan_execute_review",
    plannerProfile: "qwen",
    executorProfile: "kimi",
    reviewerProfile: "openai",
    plannerDriver: "openai_compatible_api",
    executorDriver: "openai_compatible_api",
    reviewerDriver: "openai_compatible_api",
    executorType: "openai_compatible_api",
    modelName: "kimi-k2",
    currentRole: "planner",
    currentCycle: 0,
    planMarkdown: "1. Inspect popup\n2. Ship bounded fix",
    planRisks: ["Potential regression on mobile"],
    planOpenQuestions: ["Confirm spacing with design"],
    latestReviewSummary: "Needs one more patch.",
    latestFindings: [
      {
        title: "Guard null branch",
        body: "Handle the null branch before reading popup bounds.",
        file: "/repo/src/popup.ts",
      },
    ],
    pendingQuestion: null,
    latestHumanResponse: null,
    branchName: "jira/PROJ-1-fix-popup-alignment",
    worktreePath: "/tmp/arche/worktrees/PROJ-1",
    worktreeRetained: false,
    sandboxId: "sandbox-1",
    mrUrl: "https://gitlab.example.com/mr/1",
    summary: "Ready for the next step.",
    failureReason: null,
    diffExcerpt: "diff --git a/src/popup.ts b/src/popup.ts",
    artifactsPath: "/tmp/arche/runs/run-1",
    commandHistory: [],
    manualOverride: {},
    cancelRequested: false,
    workerId: "worker-a",
    leaseOwner: null,
    leaseExpiresAt: null,
    startedAt: "2026-04-07T08:59:00.000Z",
    finishedAt: null,
    createdAt: "2026-04-07T08:58:00.000Z",
    updatedAt: "2026-04-07T09:00:00.000Z",
    ...overrides,
  };
}
