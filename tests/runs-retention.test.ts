import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("run retention and command history", () => {
  let workspace: string;
  let runtimeRoot: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "arche-retention-"));
    const configPath = join(workspace, "orchestrator.yml");
    runtimeRoot = join(workspace, "runtime");

    process.env.DATABASE_URL = join(runtimeRoot, "arche.db");
    process.env.ARCHE_CONFIG_PATH = configPath;
    process.env.ARCHE_RUNTIME_ROOT = runtimeRoot;
    process.env.ARCHE_LOG_LEVEL = "error";
    process.env.USER_OPENROUTER_API_KEY = "provider-token";

    await writeFile(
      configPath,
      [
        "runtime:",
        `  root_dir: ${runtimeRoot}`,
        `  repos_dir: ${runtimeRoot}/repos`,
        `  runs_dir: ${runtimeRoot}/runs`,
        `  logs_dir: ${runtimeRoot}/logs`,
        "  db_retention_days: 1",
        "  artifact_retention_days: 1",
        "  failed_worktree_retention_days: 1",
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
        "      api_key_env: USER_OPENROUTER_API_KEY",
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

  it("caps command history and prunes retained run history, artifacts, and failed worktrees", async () => {
    const [{ ensureArcheReady }, runsModule, { db }, schema, { ensureDirectory }] = await Promise.all([
      import("../src/lib/bootstrap"),
      import("../src/lib/arche/runs"),
      import("../src/lib/db/client"),
      import("../src/lib/db/schema"),
      import("../src/lib/arche/utils"),
    ]);

    await ensureArcheReady();

    const baseIssue = {
      key: "PROJ-123",
      title: "Retention test",
      description: "Retention baseline issue for Arche.",
      status: "In Progress",
      issueType: "Bug",
      labels: ["agent-ready"],
      assignee: "agent-dev",
      projectKey: "PROJ",
      raw: {},
    };

    const boundedRun = await runsModule.createRun({
      issue: baseIssue,
      source: "manual",
      repository: null,
    });

    for (let index = 0; index < 60; index += 1) {
      await runsModule.appendRunCommand(boundedRun.id, {
        timestamp: new Date(Date.now() + index).toISOString(),
        command: `pnpm test:${index}`,
        returncode: 0,
      });
    }

    const boundedRunDetail = await runsModule.getRunById(boundedRun.id);
    expect(boundedRunDetail.commandHistory).toHaveLength(50);
    expect((boundedRunDetail.commandHistory[0] as { command: string }).command).toBe("pnpm test:10");

    const prunableRun = await runsModule.createRun({
      issue: {
        ...baseIssue,
        key: "PROJ-124",
      },
      source: "manual",
      repository: null,
    });

    await runsModule.appendRunEvent(prunableRun.id, "validation.succeeded", { changedFiles: 1 });
    await runsModule.appendRunLog(prunableRun.id, "stdout", "command output");
    await runsModule.appendRunMessage(prunableRun.id, "assistant", "summary", "Retained summary");

    const artifactDir = join(workspace, "runtime", "logs", "runs", prunableRun.id, "commands");
    const stdoutArtifactPath = join(artifactDir, "1-stdout.log");
    await ensureDirectory(artifactDir);
    await writeFile(stdoutArtifactPath, "artifact", "utf8");

    const oldDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await utimes(stdoutArtifactPath, oldDate, oldDate);

    await db.insert(schema.runCommands).values({
      runId: prunableRun.id,
      phase: "validation",
      command: "pnpm test",
      returncode: 0,
      durationMs: 10,
      stdoutExcerpt: "artifact",
      stderrExcerpt: null,
      stdoutArtifactPath,
      stderrArtifactPath: null,
      timestamp: oldDate,
    });

    await db
      .update(schema.runs)
      .set({
        status: "success",
        finishedAt: oldDate,
        updatedAt: oldDate,
      })
      .where(eq(schema.runs.id, prunableRun.id));

    const retainedWorktreePath = join(runtimeRoot, "runs", "PROJ-124", "jira-PROJ-124-retained");
    await ensureDirectory(retainedWorktreePath);
    await writeFile(join(retainedWorktreePath, "debug.txt"), "keep me", "utf8");
    await db
      .update(schema.runs)
      .set({
        worktreePath: retainedWorktreePath,
        worktreeRetained: true,
        finishedAt: oldDate,
        updatedAt: oldDate,
        status: "failed",
      })
      .where(eq(schema.runs.id, prunableRun.id));

    const summary = await runsModule.pruneRunHistory({ force: true });
    expect(summary.deletedEvents).toBeGreaterThan(0);
    expect(summary.deletedLogs).toBeGreaterThan(0);
    expect(summary.deletedCommands).toBeGreaterThan(0);
    expect(summary.deletedMessages).toBeGreaterThan(0);
    expect(summary.deletedTasks).toBeGreaterThanOrEqual(0);
    expect(summary.deletedArtifacts).toBeGreaterThan(0);
    expect(summary.deletedWorktrees).toBeGreaterThan(0);

    const events = await runsModule.listRunEvents(prunableRun.id);
    const logs = await runsModule.listRunLogsPage(prunableRun.id);
    const commands = await runsModule.listRunCommands(prunableRun.id);
    const messages = await runsModule.listRunMessages(prunableRun.id);
    expect(events.items).toHaveLength(0);
    expect(logs.items).toHaveLength(0);
    expect(commands.items).toHaveLength(0);
    expect(messages.items).toHaveLength(0);
    await expect(readFile(stdoutArtifactPath, "utf8")).rejects.toThrow();
    await expect(readFile(join(retainedWorktreePath, "debug.txt"), "utf8")).rejects.toThrow();

    const retainedRun = await runsModule.getRunById(prunableRun.id);
    expect(retainedRun.status).toBe("failed");
    expect(retainedRun.worktreePath).toBeNull();
    expect(retainedRun.worktreeRetained).toBe(false);
  });
});
