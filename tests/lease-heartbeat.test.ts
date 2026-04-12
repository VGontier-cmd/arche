import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const providerDelayMs = 1_200;

const issue = {
  key: "PROJ-700",
  title: "Keep lease alive during slow planning",
  description: "Exercise run lease and ticket lock heartbeats while the planner blocks on a slow provider call.",
  status: "In Progress",
  issueType: "Bug",
  labels: ["agent-ready"],
  assignee: "agent-dev",
  projectKey: "PROJ",
  raw: {
    key: "PROJ-700",
    fields: {
      summary: "Keep lease alive during slow planning",
      description: "Exercise run lease and ticket lock heartbeats while the planner blocks on a slow provider call.",
      status: { name: "In Progress" },
      issuetype: { name: "Bug" },
      labels: ["agent-ready"],
      assignee: { displayName: "agent-dev" },
      project: { key: "PROJ" },
    },
  },
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

vi.mock("../src/lib/arche/jira", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/arche/jira")>("../src/lib/arche/jira");

  class JiraClient {
    get configured() {
      return true;
    }

    async fetchIssue(issueKey: string) {
      return {
        ...issue,
        key: issueKey,
        raw: {
          ...issue.raw,
          key: issueKey,
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

vi.mock("../src/lib/arche/gitlab", () => {
  class GitLabClient {
    get configured() {
      return true;
    }

    async createMergeRequest() {
      return "https://gitlab.example.com/mr/1";
    }
  }

  return { GitLabClient };
});

vi.mock("../src/lib/arche/git", () => {
  class GitManager {
    buildBranchName(input: { key: string }) {
      return `jira/${input.key}-heartbeat`;
    }

    async createWorktree(_repository: unknown, branchName: string, issueKey: string) {
      return `/tmp/arche/${issueKey}/${branchName.replaceAll("/", "-")}`;
    }

    async cleanupWorktree() {
      return;
    }

    async isWorktreeValid() {
      return true;
    }

    async diffExcerpt() {
      return "";
    }

    async diffStats() {
      return { changedFiles: 0, changedLines: 0 };
    }

    async commitAndPush() {
      return;
    }

    async trackedFiles() {
      return ["src/index.ts", "src/components/Popup.tsx"];
    }

    async applyPatch() {
      return;
    }
  }

  return { GitManager };
});

vi.mock("../src/lib/arche/sandbox", () => {
  class SandboxManager {
    async create(runId: string) {
      return `sandbox-${runId}`;
    }

    async run() {
      return {
        command: "pnpm test",
        returncode: 0,
        stdout: "ok",
        stderr: "",
        durationMs: 10,
      };
    }

    async destroy() {
      return;
    }
  }

  return { SandboxManager };
});

describe("run ownership heartbeat", () => {
  let workspace: string;
  let runtimeRoot: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "arche-lease-heartbeat-"));
    runtimeRoot = join(workspace, "runtime");
    const configPath = join(workspace, "orchestrator.yml");

    process.env.DATABASE_URL = join(runtimeRoot, "arche.db");
    process.env.ARCHE_CONFIG_PATH = configPath;
    process.env.ARCHE_RUNTIME_ROOT = runtimeRoot;
    process.env.ARCHE_LOG_LEVEL = "error";
    process.env.USER_OPENROUTER_API_KEY = "provider-token";
    process.env.USER_JIRA_BASE_URL = "https://jira.example.com";
    process.env.USER_JIRA_EMAIL = "agent-dev@example.com";
    process.env.USER_JIRA_API_TOKEN = "jira-token";
    process.env.USER_GITLAB_BASE_URL = "https://gitlab.example.com";
    process.env.USER_GITLAB_TOKEN = "gitlab-token";

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
        "  lease_ttl_seconds: 1",
        "  max_agent_steps: 4",
        "  max_run_seconds: 5",
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
        "  env_allowlist:",
        "    - USER_OPENROUTER_API_KEY",
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
        "      timeout_seconds: 5",
        "      max_actions: 4",
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

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url === "https://llm.example.com/v1/chat/completions") {
          await delay(providerDelayMs);
          return new Response(
            JSON.stringify({
              id: "chatcmpl-test",
              choices: [
                {
                  index: 0,
                  finish_reason: "stop",
                  message: {
                    role: "assistant",
                    content: JSON.stringify({
                      planMarkdown: "1. Wait for a slow provider\n2. Ensure the lease stays alive",
                      risks: [],
                      openQuestions: [],
                      needsHumanInput: false,
                    }),
                  },
                },
              ],
              created: 1,
              model: "test-planner-model",
              object: "chat.completion",
              system_fingerprint: null,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        throw new Error(`Unexpected fetch URL: ${url}`);
      }),
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
    vi.unstubAllGlobals();
    await rm(workspace, { recursive: true, force: true });
  });

  it("refreshes the run lease, ticket lock, and worker heartbeat while waiting on a slow provider", async () => {
    const [{ ensureArcheReady }, runsModule, workersModule, { db }, schema] = await Promise.all([
      import("../src/lib/bootstrap"),
      import("../src/lib/arche/runs"),
      import("../src/lib/arche/workers"),
      import("../src/lib/db/client"),
      import("../src/lib/db/schema"),
    ]);

    await ensureArcheReady();
    await workersModule.registerWorker({
      workerId: "worker-1",
      hostname: "test-worker",
      pid: 1001,
      metadata: { pollIntervalSeconds: 1 },
    });

    const accepted = await runsModule.handleJiraWebhook({
      payload: { issue_key: issue.key },
    });
    expect(accepted.accepted).toBe(true);

    const claimed = await runsModule.claimNextRun("worker-1", 1);
    expect(claimed?.id).toBe(accepted.runId);
    const initialRun = await runsModule.getRunById(accepted.runId!);
    expect(initialRun.leaseExpiresAt).not.toBeNull();

    const processing = runsModule.processRun(accepted.runId!, "worker-1");

    const readCurrentLock = async () => {
      const [lock] = await db
        .select()
        .from(schema.locks)
        .where(
          eq(schema.locks.ownerRunId, accepted.runId!),
        )
        .limit(1);
      return lock;
    };

    const waitForLock = async (timeoutMs: number) => {
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        const lock = await readCurrentLock();
        if (lock) {
          return lock;
        }
        await delay(50);
      }

      const timedOutRun = await runsModule.getRunById(accepted.runId!);
      const allLocks = await db.select().from(schema.locks);
      const events = await db
        .select()
        .from(schema.runEvents)
        .where(eq(schema.runEvents.runId, accepted.runId!));
      throw new Error(
        `Timed out waiting for ticket lock; run status=${timedOutRun.status}; locks=${JSON.stringify(allLocks)}; events=${JSON.stringify(events.map((event) => event.type))}`,
      );
    };

    try {
      const firstLock = await waitForLock(1_000);
      const firstWorker = await workersModule.getWorkerById("worker-1");

      let secondRun = await runsModule.getRunById(accepted.runId!);
      let secondLock = await readCurrentLock();
      let secondWorker = await workersModule.getWorkerById("worker-1");

      const startedAt = Date.now();
      while (
        Date.now() - startedAt < 900 &&
        !(
          secondRun.leaseExpiresAt!.getTime() > initialRun.leaseExpiresAt!.getTime() &&
          secondLock &&
          secondLock.expiresAt.getTime() > firstLock.expiresAt.getTime() &&
          secondWorker.lastHeartbeatAt.getTime() > firstWorker.lastHeartbeatAt.getTime()
        )
      ) {
        await delay(50);
        secondRun = await runsModule.getRunById(accepted.runId!);
        secondLock = await readCurrentLock();
        secondWorker = await workersModule.getWorkerById("worker-1");
      }

      expect(secondRun.leaseExpiresAt!.getTime()).toBeGreaterThan(
        initialRun.leaseExpiresAt!.getTime(),
      );
      expect(secondLock?.expiresAt.getTime()).toBeGreaterThan(
        firstLock.expiresAt.getTime(),
      );
      expect(secondWorker.lastHeartbeatAt.getTime()).toBeGreaterThan(
        firstWorker.lastHeartbeatAt.getTime(),
      );

      const finished = await processing;
      expect(finished.status).toBe("awaiting_plan_approval");
    } finally {
      await processing.catch(() => undefined);
    }
  }, 10_000);
});
