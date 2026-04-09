import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const baseIssue = {
  key: "PROJ-800",
  title: "Manual run policy coverage",
  description: "Manual run issue with enough detail to satisfy the configured minimum description length.",
  status: "In Progress",
  issueType: "Bug",
  labels: ["agent-ready"],
  assignee: "agent-dev",
  projectKey: "PROJ",
  raw: {
    key: "PROJ-800",
    fields: {
      summary: "Manual run policy coverage",
      description:
        "Manual run issue with enough detail to satisfy the configured minimum description length.",
      status: { name: "In Progress" },
      issuetype: { name: "Bug" },
      labels: ["agent-ready"],
      assignee: { displayName: "agent-dev" },
      project: { key: "PROJ" },
    },
  },
};

let currentIssue = { ...baseIssue };

vi.mock("../src/lib/arche/jira", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/arche/jira")>("../src/lib/arche/jira");

  class JiraClient {
    get configured() {
      return true;
    }

    async fetchIssue(issueKey: string) {
      return {
        ...currentIssue,
        key: issueKey,
        raw: {
          ...currentIssue.raw,
          key: issueKey,
          fields: {
            ...(currentIssue.raw.fields as Record<string, unknown>),
            summary: currentIssue.title,
            description: currentIssue.description,
            status: { name: currentIssue.status },
            issuetype: { name: currentIssue.issueType },
            labels: currentIssue.labels,
            assignee: { displayName: currentIssue.assignee },
            project: { key: currentIssue.projectKey },
          },
        },
      };
    }

    async commentIssue() {
      return;
    }
  }

  return {
    ...actual,
    JiraClient,
  };
});

describe("manual runs", () => {
  let workspace: string;
  let runtimeRoot: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "arche-manual-run-"));
    runtimeRoot = join(workspace, "runtime");
    const configPath = join(workspace, "orchestrator.yml");

    currentIssue = {
      ...baseIssue,
      raw: structuredClone(baseIssue.raw),
    };

    process.env.DATABASE_URL = join(runtimeRoot, "arche.db");
    process.env.ARCHE_CONFIG_PATH = configPath;
    process.env.ARCHE_RUNTIME_ROOT = runtimeRoot;
    process.env.ARCHE_LOG_LEVEL = "error";
    process.env.USER_OPENROUTER_API_KEY = "provider-token";
    process.env.USER_JIRA_BASE_URL = "https://jira.example.com";
    process.env.USER_JIRA_EMAIL = "agent-dev@example.com";
    process.env.USER_JIRA_API_TOKEN = "jira-token";

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
        "      api_key_env: USER_OPENROUTER_API_KEY",
        "      timeout_seconds: 60",
        "      max_actions: 8",
        "      temperature: 0.1",
        "bootstrap:",
        "  repositories:",
        "    - name: my-service",
        "      gitProvider: gitlab",
        "      remoteUrl: git@gitlab.example.com:team/my-service.git",
        `      localMirrorPath: ${runtimeRoot}/repos/my-service`,
        "      defaultBranch: main",
        "      gitlabProjectId: team%2Fmy-service",
        "      allowedCommands: []",
        "      validationCommands: []",
        "  repo_rules:",
        "    - name: proj-routing",
        "      repository_name: my-service",
        "      jira_project_key: PROJ",
        "      label: agent-ready",
        "      issue_type: Bug",
        "      priority: 100",
        "      enabled: true",
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

  it("enforces the configured policy for manual runs by default", async () => {
    const [{ ensureArcheReady }, { createManualRunForTicket }] = await Promise.all([
      import("../src/lib/bootstrap"),
      import("../src/lib/arche/runs"),
    ]);

    currentIssue = {
      ...currentIssue,
      status: "Todo",
    };

    await ensureArcheReady();

    await expect(
      createManualRunForTicket({
        ticketKey: "PROJ-800",
      }),
    ).rejects.toThrow(/Issue status is not eligible/);
  });

  it("blocks duplicate active runs by default", async () => {
    const [{ ensureArcheReady }, { createManualRunForTicket }] = await Promise.all([
      import("../src/lib/bootstrap"),
      import("../src/lib/arche/runs"),
    ]);

    await ensureArcheReady();
    const firstRun = await createManualRunForTicket({
      ticketKey: "PROJ-800",
    });

    await expect(
      createManualRunForTicket({
        ticketKey: "PROJ-800",
      }),
    ).rejects.toThrow(/An active run already exists for this ticket/);

    expect(firstRun.status).toBe("pending");
  });

  it("supports an explicit force override for operators", async () => {
    const [{ ensureArcheReady }, { createManualRunForTicket }] = await Promise.all([
      import("../src/lib/bootstrap"),
      import("../src/lib/arche/runs"),
    ]);

    await ensureArcheReady();
    await createManualRunForTicket({
      ticketKey: "PROJ-800",
    });

    currentIssue = {
      ...currentIssue,
      status: "Todo",
    };

    const forcedRun = await createManualRunForTicket({
      ticketKey: "PROJ-800",
      force: true,
    });

    expect(forcedRun.status).toBe("pending");
    expect(forcedRun.manualOverride).toEqual({
      force: true,
      bypassedEligibilityChecks: true,
      hadActiveRun: true,
    });
  });

  it("does not let force bypass repository resolution", async () => {
    const [{ ensureArcheReady }, { createManualRunForTicket }] = await Promise.all([
      import("../src/lib/bootstrap"),
      import("../src/lib/arche/runs"),
    ]);

    currentIssue = {
      ...currentIssue,
      projectKey: "OTHER",
    };

    await ensureArcheReady();

    await expect(
      createManualRunForTicket({
        ticketKey: "PROJ-800",
        force: true,
      }),
    ).rejects.toMatchObject({
      code: "manual_run_repo_required",
    });
  });
});
