import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("dashboard actions", () => {
  let workspace: string;
  let runtimeRoot: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "arche-dashboard-actions-"));
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
        "    planner: default",
        "    executor: default",
        "    reviewer: default",
        "  profiles:",
        "    default:",
        "      driver: openai_compatible_api",
        "      base_url: https://llm.example.com/v1",
        "      model: test-model",
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

  it("approves the plan and seeds the approved plan fields on the run", async () => {
    const [{ ensureArcheReady }, runsModule, actionsModule, { db }, schema] = await Promise.all([
      import("../src/lib/bootstrap"),
      import("../src/lib/arche/runs"),
      import("../src/lib/arche/dashboard-actions"),
      import("../src/lib/db/client"),
      import("../src/lib/db/schema"),
    ]);

    await ensureArcheReady();
    const run = await createRun(runsModule, "PROJ-600");

    await db
      .update(schema.runs)
      .set({
        status: "awaiting_plan_approval",
        currentRole: "planner",
        currentCycle: 0,
      })
      .where(eq(schema.runs.id, run.id));
    await db.insert(schema.runTasks).values({
      runId: run.id,
      role: "planner",
      cycle: 0,
      status: "completed",
      modelName: "test-model",
      profileName: "default",
      strategy: "direct",
      summary: "Plan produced.",
      outputJson: {
        planMarkdown: "1. Inspect popup\n2. Ship bounded fix",
        risks: ["Regression on small screens"],
        openQuestions: ["Need QA sign-off?"],
        needsHumanInput: false,
      },
      startedAt: new Date(),
      finishedAt: new Date(),
    });

    const result = await actionsModule.executeDashboardAction({
      kind: "approve_plan",
      runId: run.id,
    });
    const updated = await runsModule.getRunById(run.id);

    expect(result).toEqual({
      selectedRunId: run.id,
      message: `Plan approved for ${run.ticketKey}.`,
    });
    expect(updated.status).toBe("pending");
    expect(updated.currentRole).toBe("executor");
    expect(updated.currentCycle).toBe(1);
    expect(updated.planMarkdown).toBe("1. Inspect popup\n2. Ship bounded fix");
    expect(updated.planRisks).toEqual(["Regression on small screens"]);
    expect(updated.planOpenQuestions).toEqual(["Need QA sign-off?"]);
  });

  it("stores a human response and requeues the run", async () => {
    const [{ ensureArcheReady }, runsModule, actionsModule, { db }, schema] = await Promise.all([
      import("../src/lib/bootstrap"),
      import("../src/lib/arche/runs"),
      import("../src/lib/arche/dashboard-actions"),
      import("../src/lib/db/client"),
      import("../src/lib/db/schema"),
    ]);

    await ensureArcheReady();
    const run = await createRun(runsModule, "PROJ-601");

    await db
      .update(schema.runs)
      .set({
        status: "needs_human_input",
        currentRole: "executor",
        pendingQuestion: "Should we gate this on a feature flag?",
      })
      .where(eq(schema.runs.id, run.id));

    const result = await actionsModule.executeDashboardAction({
      kind: "respond",
      runId: run.id,
      message: "Yes, use the feature flag.",
    });
    const updated = await runsModule.getRunById(run.id);

    expect(result.message).toBe(`Human response saved for ${run.ticketKey}.`);
    expect(updated.status).toBe("pending");
    expect(updated.latestHumanResponse).toBe("Yes, use the feature flag.");
  });

  it("approves and rejects publish through the dashboard action layer", async () => {
    const [{ ensureArcheReady }, runsModule, actionsModule, { db }, schema] = await Promise.all([
      import("../src/lib/bootstrap"),
      import("../src/lib/arche/runs"),
      import("../src/lib/arche/dashboard-actions"),
      import("../src/lib/db/client"),
      import("../src/lib/db/schema"),
    ]);

    await ensureArcheReady();
    const approveRun = await createRun(runsModule, "PROJ-602");
    const rejectRun = await createRun(runsModule, "PROJ-603");

    await db
      .update(schema.runs)
      .set({ status: "awaiting_publish_approval" })
      .where(eq(schema.runs.id, approveRun.id));
    await db
      .update(schema.runs)
      .set({ status: "awaiting_publish_approval" })
      .where(eq(schema.runs.id, rejectRun.id));

    const approveResult = await actionsModule.executeDashboardAction({
      kind: "approve_publish",
      runId: approveRun.id,
    });
    const rejectResult = await actionsModule.executeDashboardAction({
      kind: "reject_publish",
      runId: rejectRun.id,
    });

    const approved = await runsModule.getRunById(approveRun.id);
    const rejected = await runsModule.getRunById(rejectRun.id);

    expect(approveResult.message).toBe(`Publish approved for ${approveRun.ticketKey}.`);
    expect(approved.status).toBe("publish_approved");
    expect(rejectResult.message).toBe(`Publish rejected for ${rejectRun.ticketKey}.`);
    expect(rejected.status).toBe("publish_rejected");
    expect(rejected.worktreeRetained).toBe(true);
  });

  it("retries a failed run and cancels a pending run", async () => {
    const [{ ensureArcheReady }, runsModule, actionsModule, { db }, schema] = await Promise.all([
      import("../src/lib/bootstrap"),
      import("../src/lib/arche/runs"),
      import("../src/lib/arche/dashboard-actions"),
      import("../src/lib/db/client"),
      import("../src/lib/db/schema"),
    ]);

    await ensureArcheReady();
    const failedRun = await createRun(runsModule, "PROJ-604");
    const pendingRun = await createRun(runsModule, "PROJ-605");

    await db
      .update(schema.runs)
      .set({
        status: "failed",
        failureReason: "Validation failed",
        finishedAt: new Date(),
      })
      .where(eq(schema.runs.id, failedRun.id));

    const retryResult = await actionsModule.executeDashboardAction({
      kind: "retry",
      runId: failedRun.id,
    });
    const retriedRun = await runsModule.getRunById(retryResult.selectedRunId);

    expect(retryResult.selectedRunId).not.toBe(failedRun.id);
    expect(retryResult.message).toBe(`Retry created for ${failedRun.ticketKey}.`);
    expect(retriedRun.ticketKey).toBe(failedRun.ticketKey);
    expect(retriedRun.source).toContain(":retry");

    const cancelResult = await actionsModule.executeDashboardAction({
      kind: "cancel",
      runId: pendingRun.id,
    });
    const cancelledRun = await runsModule.getRunById(pendingRun.id);

    expect(cancelResult.selectedRunId).toBe(pendingRun.id);
    expect(cancelResult.message).toBe(`Cancellation requested for ${pendingRun.ticketKey}.`);
    expect(cancelledRun.status).toBe("cancelled");
  });
});

async function createRun(
  runsModule: typeof import("../src/lib/arche/runs"),
  issueKey: string,
) {
  return runsModule.createRun({
    issue: {
      key: issueKey,
      title: `Ticket ${issueKey}`,
      description: `Implement the requested change for ${issueKey}.`,
      status: "In Progress",
      issueType: "Bug",
      labels: ["agent-ready"],
      assignee: "agent-dev",
      projectKey: "PROJ",
      raw: {
        key: issueKey,
        fields: {
          summary: `Ticket ${issueKey}`,
          description: `Implement the requested change for ${issueKey}.`,
          status: { name: "In Progress" },
          issuetype: { name: "Bug" },
          labels: ["agent-ready"],
          assignee: { displayName: "agent-dev" },
          project: { key: "PROJ" },
        },
      },
    },
    source: "manual",
    repository: null,
  });
}
