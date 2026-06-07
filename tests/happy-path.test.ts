import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileAsync = promisify(execFile);

const originalFetch = globalThis.fetch.bind(globalThis);

const state = {
  scenario: "happy" as "happy" | "needs_input" | "review_changes",
  branchName: "",
  worktreePath: "",
  comments: [] as Array<{ issueKey: string; comment: string }>,
  mergeRequests: [] as Array<{ branchName: string; summary: string }>,
  createdSandboxes: [] as string[],
  destroyedSandboxes: [] as string[],
  committedBranches: [] as string[],
  providerInvocations: [] as Array<{ role: string; cycle: number; modelName: string }>,
  executorCalls: 0,
  needsInputSent: false,
  reviewerCalls: 0,
};

const issue = {
  key: "PROJ-123",
  title: "Fix popup alignment",
  description: "Investigate popup overflow and ship a bounded fix for the landing page popup.",
  status: "In Progress",
  issueType: "Bug",
  labels: ["agent-ready"],
  assignee: "agent-dev",
  projectKey: "PROJ",
  raw: {
    key: "PROJ-123",
    fields: {
      summary: "Fix popup alignment",
      description: "Investigate popup overflow and ship a bounded fix for the landing page popup.",
      status: { name: "In Progress" },
      issuetype: { name: "Bug" },
      labels: ["agent-ready"],
      assignee: { displayName: "agent-dev" },
      project: { key: "PROJ" },
    },
  },
};

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
          key: issueKey,
          fields: {
            summary: issue.title,
            description: issue.description,
            status: { name: issue.status },
            issuetype: { name: issue.issueType },
            labels: issue.labels,
            assignee: { displayName: issue.assignee },
            project: { key: issue.projectKey },
          },
        },
      };
    }

    async commentIssue(issueKey: string, comment: string) {
      state.comments.push({ issueKey, comment });
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

    async createMergeRequest(_repository: unknown, branchName: string, _issue: unknown, summary: string) {
      state.mergeRequests.push({ branchName, summary });
      return `https://gitlab.example.com/mr/${branchName.replaceAll("/", "-")}`;
    }
  }

  return { GitLabClient };
});

vi.mock("../src/lib/arche/git", () => {
  class GitManager {
    buildBranchName(input: { key: string; title: string }) {
      state.branchName = `jira/${input.key}-fix-popup-alignment`;
      return state.branchName;
    }

    async createWorktree(_repository: unknown, branchName: string, issueKey: string) {
      state.worktreePath = `/tmp/arche/${issueKey}/${branchName.replaceAll("/", "-")}`;
      await mkdir(state.worktreePath, { recursive: true });
      return state.worktreePath;
    }

    async cleanupWorktree(_worktreePath?: string) {
      if (state.worktreePath) {
        await rm(state.worktreePath, { recursive: true, force: true });
      }
    }

    async isWorktreeValid() {
      return true;
    }

    async diffExcerpt() {
      return "diff --git a/src/index.ts b/src/index.ts\n+console.log('new')";
    }

    async diffStats() {
      return { changedFiles: 1, changedLines: 3 };
    }

    async commitAndPush(_repository: unknown, _worktreePath: string, branchName: string) {
      state.committedBranches.push(branchName);
    }

    async trackedFiles() {
      return ["src/index.ts", "src/components/Popup.tsx"];
    }

    async applyPatch() {
      return;
    }

    async getRecentCommits() {
      return [];
    }
  }

  return { GitManager };
});

vi.mock("../src/lib/arche/sandbox", () => {
  class SandboxManager {
    async create(runId: string) {
      const sandboxId = `sandbox-${runId}-${state.createdSandboxes.length + 1}`;
      state.createdSandboxes.push(sandboxId);
      return sandboxId;
    }

    async run(_sandboxId: string, argv: string[]) {
      const command = argv.join(" ");
      return {
        command,
        returncode: 0,
        stdout: `${command}\nvalidation ok\nprovider-token`,
        stderr: "provider-token",
        durationMs: 123,
      };
    }

    async destroy(sandboxId: string | null) {
      if (sandboxId) {
        state.destroyedSandboxes.push(sandboxId);
      }
    }
  }

  return { SandboxManager };
});

/** Minimal required fields shared by all OpenResponses wire-format responses. */
function baseResponseFields(output: unknown[], outputText: string) {
  return {
    id: "resp_test",
    object: "response",
    created_at: 1700000000,
    model: "any",
    status: "completed",
    completed_at: 1700000000,
    output,
    output_text: outputText,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    tools: [],
    tool_choice: "auto",
    parallel_tool_calls: false,
    temperature: 0.1,
    top_p: 1.0,
    presence_penalty: 0,
    frequency_penalty: 0,
    usage: {
      input_tokens: 10,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 5,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 15,
    },
  };
}

/** Build a minimal OpenResponses (non-streaming) JSON response with text content. */
function providerResponse(text: string): Response {
  return new Response(
    JSON.stringify(baseResponseFields(
      [{ id: "msg_test", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] }],
      text,
    )),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/** Build an OpenResponses response with function_call output items (executor tool calls). */
function functionCallResponse(calls: Array<{ name: string; args: Record<string, unknown> }>): Response {
  return new Response(
    JSON.stringify(baseResponseFields(
      calls.map((call, i) => ({
        type: "function_call",
        id: `call_${call.name}_${i}`,
        call_id: `call_${call.name}_${i}`,
        name: call.name,
        arguments: JSON.stringify(call.args),
        status: "completed",
      })),
      "",
    )),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

async function parseProviderRequest(input: string | URL | Request, init?: RequestInit) {
  const rawBody =
    input instanceof Request
      ? await input.clone().text()
      : typeof init?.body === "string"
        ? init.body
        : "{}";
  return JSON.parse(rawBody) as {
    model: string;
    input?: string | Array<Record<string, unknown>>;
    instructions?: string;
    tools?: unknown[];
  };
}

function extractUserText(request: { input?: string | Array<Record<string, unknown>> }) {
  if (typeof request.input === "string") return request.input;
  if (Array.isArray(request.input)) {
    return (request.input.find((m) => m.role === "user")?.content as string | undefined) ?? "";
  }
  return "";
}

function roleFromRequest(request: { model: string; input?: string | Array<Record<string, unknown>> }) {
  if (request.model === "test-planner-model") {
    return extractUserText(request).includes("researcher role for Arche") ? "researcher" : "planner";
  }
  if (request.model === "test-executor-model") return "executor";
  return "reviewer";
}

function cycleFromRequest(role: string, request: { input?: string | Array<Record<string, unknown>> }) {
  if (role === "planner") return 0;
  const text =
    typeof request.input === "string"
      ? request.input
      : Array.isArray(request.input)
        ? ((request.input.find((m) => m.role === "user")?.content as string | undefined) ?? "")
        : "";
  const pattern = role === "executor" ? /Execution cycle:\s*(\d+)/ : /Review cycle:\s*(\d+)/;
  const matched = text.match(pattern);
  return matched ? Number(matched[1]) : 1;
}

describe("workflow orchestration", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "arche-happy-"));
    state.scenario = "happy";
    state.branchName = "";
    state.worktreePath = "";
    state.comments = [];
    state.mergeRequests = [];
    state.createdSandboxes = [];
    state.destroyedSandboxes = [];
    state.committedBranches = [];
    state.providerInvocations = [];
    state.executorCalls = 0;
    state.needsInputSent = false;
    state.reviewerCalls = 0;

    const configPath = join(workspace, "orchestrator.yml");
    const runtimeRoot = join(workspace, "runtime");

    process.env.DATABASE_URL = join(runtimeRoot, "arche.db");
    process.env.ARCHE_CONFIG_PATH = configPath;
    process.env.ARCHE_RUNTIME_ROOT = runtimeRoot;
    process.env.ARCHE_SERVER_AUTH_TOKEN = "server-token";
    process.env.USER_JIRA_BASE_URL = "https://jira.example.com";
    process.env.USER_JIRA_EMAIL = "agent-dev@example.com";
    process.env.USER_JIRA_API_TOKEN = "jira-token";
    process.env.USER_GITLAB_BASE_URL = "https://gitlab.example.com";
    process.env.USER_GITLAB_TOKEN = "gitlab-token";
    process.env.USER_OPENROUTER_API_KEY = "provider-token";

    await writeFile(
      configPath,
      [
        "runtime:",
        `  root_dir: ${runtimeRoot}`,
        `  repos_dir: ${runtimeRoot}/repos`,
        `  runs_dir: ${runtimeRoot}/runs`,
        `  logs_dir: ${runtimeRoot}/logs`,
        "  failed_worktree_retention_days: 3",
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
        "  env_allowlist:",
        "    - USER_OPENROUTER_API_KEY",
        "defaults:",
        "  allowed_commands: []",
        "  validation_commands:",
        "    - pnpm test",
        "workflow:",
        "  mode: plan_execute_review",
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
        "      base_url: https://llm.example.com/v1",
        "      model: test-planner-model",
        "      api_key_env: USER_OPENROUTER_API_KEY",
        "      timeout_seconds: 60",
        "      max_actions: 4",
        "      temperature: 0.1",
        "    kimi:",
        "      driver: openai_compatible_api",
        "      base_url: https://llm.example.com/v1",
        "      model: test-executor-model",
        "      api_key_env: USER_OPENROUTER_API_KEY",
        "      timeout_seconds: 60",
        "      max_actions: 4",
        "      temperature: 0.1",
        "    openai:",
        "      driver: openai_compatible_api",
        "      base_url: https://llm.example.com/v1",
        "      model: test-reviewer-model",
        "      api_key_env: USER_OPENROUTER_API_KEY",
        "      timeout_seconds: 60",
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
        "    - name: proj-bug-routing",
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

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === "https://llm.example.com/v1/responses") {
        const request = await parseProviderRequest(input, init);
        const role = roleFromRequest(request);

        if (role === "researcher") {
          // Researcher is a pre-planner phase; the assertions below track only
          // planner / executor / reviewer invocations, so we don't record it.
          return providerResponse(
            JSON.stringify({
              summary: "Popup component lives in src/components/Popup.tsx and is rendered on the landing page.",
              relevantFiles: ["src/components/Popup.tsx"],
              architectureNotes: "React function components with co-located styles.",
              externalDeps: [],
              potentialRisks: ["Popup placement may regress on smaller breakpoints."],
            }),
          );
        }

        const cycle = cycleFromRequest(role, request);
        state.providerInvocations.push({ role, cycle, modelName: request.model });

        if (role === "planner") {
          return providerResponse(
            JSON.stringify({
              planMarkdown: "1. Inspect popup styles\n2. Update popup positioning\n3. Re-run bounded validation",
              risks: ["Popup placement may regress on smaller breakpoints."],
              openQuestions: [],
              needsHumanInput: false,
            }),
          );
        }

        if (role === "executor") {
          // Initial call: input is a string (fresh callModel invocation).
          if (typeof request.input === "string") {
            if (state.scenario === "needs_input" && !state.needsInputSent) {
              state.needsInputSent = true;
              return functionCallResponse([{
                name: "needs_human_input",
                args: { question: "Should the popup keep the 768px breakpoint behavior or switch to the mobile layout earlier?" },
              }]);
            }
            return functionCallResponse([{
              name: "write_file",
              args: {
                path: "src/components/Popup.tsx",
                content: "// Updated popup alignment\nexport const Popup = () => <div>Fixed</div>;\n",
              },
            }]);
          }

          // Follow-up call: input is an array with tool call history.
          const inputArr = Array.isArray(request.input) ? request.input : [];
          const calledNames = inputArr
            .filter((item) => item.type === "function_call")
            .map((item) => item.name as string);

          // write_file was called but finish not yet → call finish
          if (calledNames.includes("write_file") && !calledNames.includes("finish")) {
            state.executorCalls += 1;
            const isFirstCycle = state.executorCalls === 1 && state.scenario === "review_changes";
            return functionCallResponse([{
              name: "finish",
              args: isFirstCycle
                ? {
                    summary: "Implemented the initial popup alignment fix.",
                    implementedPlanDelta: "Adjusted the popup positioning rules but did not yet address the reviewer follow-up.",
                  }
                : {
                    summary: "Implemented the popup alignment fix.",
                    implementedPlanDelta: "Adjusted popup positioning rules and retained the bounded breakpoint behavior.",
                  },
            }]);
          }

          // finish was already called → return final text (SDK stop condition fires on next check)
          return providerResponse("Execution complete.");
        }

        state.reviewerCalls += 1;
        if (state.scenario === "review_changes" && state.reviewerCalls === 1) {
          return providerResponse(
            JSON.stringify({
              decision: "request_changes",
              summary: "The desktop offset fix is good, but the reviewer still sees a missing regression guard.",
              findings: [{
                title: "Missing regression guard",
                body: "Add coverage or code handling for the desktop-only popup offset regression.",
                file: "src/components/Popup.tsx",
              }],
            }),
          );
        }
        return providerResponse(
          JSON.stringify({
            decision: "approve",
            summary: "Review passed after validation.",
            findings: [],
          }),
        );
      }

      return originalFetch(input as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1]);
    }));

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

  it("accepts a Jira webhook, waits for plan approval, then publishes after explicit approval", async () => {
    const [{ ensureArcheReady }, runsModule, workersModule, { startServer }, schema, { db }] = await Promise.all([
      import("../src/lib/bootstrap"),
      import("../src/lib/arche/runs"),
      import("../src/lib/arche/workers"),
      import("../src/server"),
      import("../src/lib/db/schema"),
      import("../src/lib/db/client"),
    ]);

    await ensureArcheReady();
    await workersModule.registerWorker({
      workerId: "worker-1",
      hostname: "test-worker",
      pid: 1001,
      metadata: { pollIntervalSeconds: 1 },
    });

    const accepted = await runsModule.handleJiraWebhook({
      payload: {
        issue_key: issue.key,
      },
    });

    expect(accepted).toMatchObject({
      accepted: true,
    });
    expect(typeof accepted.runId).toBe("string");

    const plannedClaim = await runsModule.claimNextRun("worker-1", 60);
    expect(plannedClaim?.id).toBe(accepted.runId);

    const planned = await runsModule.processRun(accepted.runId!, "worker-1");
    expect(planned.status).toBe("awaiting_plan_approval");
    expect(planned.currentRole).toBe("planner");
    expect(planned.planMarkdown).toContain("Update popup positioning");

    const plannedDetail = await runsModule.getRunDetail(accepted.runId!);
    expect(plannedDetail.run.worktreeRetained).toBe(true);
    expect(plannedDetail.tasks).toHaveLength(1);
    expect(plannedDetail.tasks[0]).toMatchObject({
      role: "planner",
      cycle: 0,
      status: "completed",
      modelName: "test-planner-model",
      profileName: "qwen",
      strategy: "direct",
    });

    const cliEnv = {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL!,
      ARCHE_CONFIG_PATH: process.env.ARCHE_CONFIG_PATH!,
      ARCHE_RUNTIME_ROOT: process.env.ARCHE_RUNTIME_ROOT!,
      ARCHE_LOG_LEVEL: "error",
    };
    const approvePlanCli = await execFileAsync(
      "node",
      ["--import", "tsx", "./src/cli.ts", "runs", "approve-plan", accepted.runId!],
      {
        cwd: process.cwd(),
        env: cliEnv,
      },
    );
    expect(JSON.parse(approvePlanCli.stdout)).toMatchObject({
      id: accepted.runId,
      status: "pending",
      currentRole: "executor",
      currentCycle: 1,
    });

    const executionClaim = await runsModule.claimNextRun("worker-1", 60);
    expect(executionClaim?.id).toBe(accepted.runId);

    const awaitingPublish = await runsModule.processRun(accepted.runId!, "worker-1");
    expect(awaitingPublish.status).toBe("awaiting_publish_approval");
    expect(awaitingPublish.summary).toBe("Implemented the popup alignment fix.");
    expect(awaitingPublish.latestReviewSummary).toBe("Review passed after validation.");
    expect(awaitingPublish.worktreeRetained).toBe(true);
    expect(awaitingPublish.worktreePath).toBe(state.worktreePath);
    expect(awaitingPublish.plannerProfile).toBe("qwen");
    expect(awaitingPublish.executorProfile).toBe("kimi");
    expect(awaitingPublish.reviewerProfile).toBe("openai");

    const detail = await runsModule.getRunDetail(accepted.runId!);
    const eventPage = await runsModule.listRunEvents(accepted.runId!);
    const commandPage = await runsModule.listRunCommands(accepted.runId!);
    const messagePage = await runsModule.listRunMessages(accepted.runId!);
    expect(detail.run.diffExcerpt).toContain("diff --git");
    expect(detail.tasks.map((task) => `${task.role}:${task.cycle}:${task.status}`)).toEqual([
      "planner:0:completed",
      "executor:1:completed",
      "reviewer:1:completed",
    ]);
    expect(state.providerInvocations).toEqual([
      { role: "planner", cycle: 0, modelName: "test-planner-model" },
      { role: "executor", cycle: 1, modelName: "test-executor-model" },  // write_file
      { role: "executor", cycle: 1, modelName: "test-executor-model" },  // finish
      { role: "executor", cycle: 1, modelName: "test-executor-model" },  // final text (after stopWhen)
      { role: "reviewer", cycle: 1, modelName: "test-reviewer-model" },
    ]);
    expect(commandPage.items).toHaveLength(1);
    expect(commandPage.items[0]).toMatchObject({
      phase: "validation",
      command: "pnpm test",
      returncode: 0,
    });
    expect(messagePage.items.some((message) => message.kind === "plan")).toBe(true);
    expect(messagePage.items.some((message) => message.kind === "review")).toBe(true);
    expect(eventPage.items.some((event) => event.type === "run.awaiting_plan_approval")).toBe(true);
    expect(eventPage.items.some((event) => event.type === "run.awaiting_publish_approval")).toBe(true);
    expect(String(commandPage.items[0].stdoutExcerpt)).not.toContain("provider-token");
    expect(String(commandPage.items[0].stderrExcerpt)).not.toContain("provider-token");

    const stdoutArtifact = await readFile(String(commandPage.items[0].stdoutArtifactPath), "utf8");
    const stderrArtifact = await readFile(String(commandPage.items[0].stderrArtifactPath), "utf8");
    expect(stdoutArtifact).not.toContain("provider-token");
    expect(stderrArtifact).not.toContain("provider-token");
    expect(stdoutArtifact).toContain("[REDACTED]");
    expect(stderrArtifact).toContain("[REDACTED]");

    const server = await startServer({ host: "127.0.0.1", port: 0 });
    try {
      const address = server.server.address();
      expect(address).not.toBeNull();
      const port = typeof address === "object" && address ? address.port : 0;
      const apiHeaders = {
        authorization: "Bearer server-token",
      };
      const [detailResponse, logsResponse, eventsResponse, commandsResponse, profilesResponse] = await Promise.all([
        fetch(`http://127.0.0.1:${port}/v1/runs/${accepted.runId!}`, { headers: apiHeaders }),
        fetch(`http://127.0.0.1:${port}/v1/runs/${accepted.runId!}/logs?after_id=0&limit=10`, {
          headers: apiHeaders,
        }),
        fetch(`http://127.0.0.1:${port}/v1/runs/${accepted.runId!}/events?after_id=0&limit=100`, {
          headers: apiHeaders,
        }),
        fetch(`http://127.0.0.1:${port}/v1/runs/${accepted.runId!}/commands?after_id=0&limit=10`, {
          headers: apiHeaders,
        }),
        fetch(`http://127.0.0.1:${port}/v1/profiles`, { headers: apiHeaders }),
      ]);

      expect(detailResponse.status).toBe(200);
      expect(logsResponse.status).toBe(200);
      expect(eventsResponse.status).toBe(200);
      expect(commandsResponse.status).toBe(200);
      expect(profilesResponse.status).toBe(200);

      const detailBody = (await detailResponse.json()) as {
        run: Record<string, unknown>;
        tasks: Array<Record<string, unknown>>;
      };
      const logsBody = (await logsResponse.json()) as { items: Array<Record<string, unknown>> };
      const eventsBody = (await eventsResponse.json()) as { items: Array<Record<string, unknown>> };
      const commandsBody = (await commandsResponse.json()) as { items: Array<Record<string, unknown>> };
      const profilesBody = (await profilesResponse.json()) as {
        defaults: Record<string, string>;
        profiles: Record<string, Record<string, unknown>>;
      };

      expect(detailBody.run.status).toBe("awaiting_publish_approval");
      expect(detailBody.tasks).toHaveLength(3);
      expect(logsBody.items.length).toBeGreaterThan(0);
      expect(eventsBody.items.some((event) => event.type === "run.awaiting_publish_approval")).toBe(true);
      expect(commandsBody.items[0]?.phase).toBe("validation");
      expect(profilesBody.defaults).toMatchObject({
        planner: "qwen",
        executor: "kimi",
        reviewer: "openai",
      });
      expect(profilesBody.profiles.kimi?.model).toBe("test-executor-model");
    } finally {
      await server.close();
    }

    const approvePublishCli = await execFileAsync(
      "node",
      ["--import", "tsx", "./src/cli.ts", "runs", "approve", accepted.runId!],
      {
        cwd: process.cwd(),
        env: cliEnv,
      },
    );
    expect(JSON.parse(approvePublishCli.stdout)).toMatchObject({
      id: accepted.runId,
      status: "publish_approved",
    });

    const publishClaim = await runsModule.claimNextRun("worker-1", 60);
    expect(publishClaim?.id).toBe(accepted.runId);

    const processed = await runsModule.processRun(accepted.runId!, "worker-1");
    const completedRun = await runsModule.getRunById(accepted.runId!);
    expect(processed.status).toBe("pushed");
    expect(processed.summary).toBe("Implemented the popup alignment fix.");
    expect(processed.branchName).toBe("jira/PROJ-123-fix-popup-alignment");
    expect(completedRun.worktreeRetained).toBe(false);
    expect(completedRun.worktreePath).toBeNull();
    expect(completedRun.artifactsPath).toContain(`/runs/${accepted.runId}`);
    expect(state.committedBranches).toEqual(["jira/PROJ-123-fix-popup-alignment"]);
    expect(state.mergeRequests).toEqual([]);
    expect(state.createdSandboxes).toHaveLength(2);
    expect(state.destroyedSandboxes).toEqual(state.createdSandboxes);

    const cliJson = await execFileAsync(
      "node",
      ["--import", "tsx", "./src/cli.ts", "runs", "logs", accepted.runId!, "--kind", "commands", "--json"],
      {
        cwd: process.cwd(),
        env: cliEnv,
      },
    );
    const cliHuman = await execFileAsync(
      "node",
      ["--import", "tsx", "./src/cli.ts", "runs", "logs", accepted.runId!, "--kind", "logs"],
      {
        cwd: process.cwd(),
        env: cliEnv,
      },
    );
    const cliInspect = await execFileAsync(
      "node",
      ["--import", "tsx", "./src/cli.ts", "runs", "inspect", accepted.runId!],
      {
        cwd: process.cwd(),
        env: cliEnv,
      },
    );
    const cliProfiles = await execFileAsync(
      "node",
      ["--import", "tsx", "./src/cli.ts", "profiles", "show"],
      {
        cwd: process.cwd(),
        env: cliEnv,
      },
    );
    expect(JSON.parse(cliJson.stdout)).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: "command" })]),
    );
    expect(cliHuman.stdout).toContain("planner completed; waiting for human approval");
    expect(JSON.parse(cliInspect.stdout)).toMatchObject({
      run: {
        id: accepted.runId,
        status: "pushed",
        worktreeRetained: false,
      },
      tasks: expect.arrayContaining([
        expect.objectContaining({ role: "planner", cycle: 0, profileName: "qwen" }),
        expect.objectContaining({ role: "executor", cycle: 1, profileName: "kimi" }),
        expect.objectContaining({ role: "reviewer", cycle: 1, profileName: "openai" }),
      ]),
    });
    expect(JSON.parse(cliProfiles.stdout)).toMatchObject({
      defaults: {
        planner: "qwen",
        executor: "kimi",
        reviewer: "openai",
      },
      profiles: {
        kimi: {
          baseUrl: "https://llm.example.com/v1",
          model: "test-executor-model",
          apiKeyConfigured: true,
        },
      },
    });

    const [workerRow] = await db.select().from(schema.workers).where(eq(schema.workers.id, "worker-1"));
    expect(workerRow).toMatchObject({
      status: "idle",
      activity: "polling",
      currentRunId: null,
    });

    const databaseBuffer = await readFile(process.env.DATABASE_URL!);
    expect(databaseBuffer.byteLength).toBeGreaterThan(0);
  }, 15_000);

  it("supports human input resume and explicit publish rejection", async () => {
    state.scenario = "needs_input";

    const [{ ensureArcheReady }, runsModule, workersModule, { startServer }] = await Promise.all([
      import("../src/lib/bootstrap"),
      import("../src/lib/arche/runs"),
      import("../src/lib/arche/workers"),
      import("../src/server"),
    ]);

    await ensureArcheReady();
    await workersModule.registerWorker({
      workerId: "worker-1",
      hostname: "test-worker",
      pid: 1001,
      metadata: { pollIntervalSeconds: 1 },
    });

    const accepted = await runsModule.handleJiraWebhook({
      payload: {
        issue_key: issue.key,
      },
    });

    await runsModule.claimNextRun("worker-1", 60);
    await runsModule.processRun(accepted.runId!, "worker-1");
    await runsModule.approvePlan(accepted.runId!);

    await runsModule.claimNextRun("worker-1", 60);
    const blocked = await runsModule.processRun(accepted.runId!, "worker-1");
    expect(blocked.status).toBe("needs_human_input");
    expect(blocked.currentRole).toBe("executor");
    expect(blocked.pendingQuestion).toContain("768px breakpoint");
    expect(blocked.worktreeRetained).toBe(true);

    const server = await startServer({ host: "127.0.0.1", port: 0 });
    try {
      const address = server.server.address();
      expect(address).not.toBeNull();
      const port = typeof address === "object" && address ? address.port : 0;
      const response = await fetch(`http://127.0.0.1:${port}/v1/runs/${accepted.runId!}/respond`, {
        method: "POST",
        headers: {
          authorization: "Bearer server-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: "Keep the 768px breakpoint behavior and only fix the desktop popup offset.",
        }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.status).toBe("pending");
      expect(body.pendingQuestion).toBeNull();
      expect(body.latestHumanResponse).toBe(
        "Keep the 768px breakpoint behavior and only fix the desktop popup offset.",
      );
      expect(response.headers.get("x-request-id")).toBeTruthy();
    } finally {
      await server.close();
    }

    await runsModule.claimNextRun("worker-1", 60);
    const awaitingPublish = await runsModule.processRun(accepted.runId!, "worker-1");
    expect(awaitingPublish.status).toBe("awaiting_publish_approval");

    const cliEnv = {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL!,
      ARCHE_CONFIG_PATH: process.env.ARCHE_CONFIG_PATH!,
      ARCHE_RUNTIME_ROOT: process.env.ARCHE_RUNTIME_ROOT!,
      ARCHE_LOG_LEVEL: "error",
    };
    const rejectCli = await execFileAsync(
      "node",
      ["--import", "tsx", "./src/cli.ts", "runs", "reject", accepted.runId!],
      {
        cwd: process.cwd(),
        env: cliEnv,
      },
    );
    expect(JSON.parse(rejectCli.stdout)).toMatchObject({
      id: accepted.runId,
      status: "publish_rejected",
      worktreeRetained: true,
    });

    const rejected = await runsModule.getRunById(accepted.runId!);
    const detail = await runsModule.getRunDetail(accepted.runId!);
    expect(rejected.status).toBe("publish_rejected");
    expect(rejected.mrUrl).toBeNull();
    expect(state.mergeRequests).toEqual([]);
    expect(state.committedBranches).toEqual([]);
    expect(detail.tasks.map((task) => `${task.role}:${task.status}`)).toEqual([
      "planner:completed",
      "executor:needs_human_input",
      "executor:completed",
      "reviewer:completed",
    ]);
    expect(state.providerInvocations).toEqual([
      { role: "planner", cycle: 0, modelName: "test-planner-model" },
      { role: "executor", cycle: 1, modelName: "test-executor-model" },  // needs_human_input
      { role: "executor", cycle: 1, modelName: "test-executor-model" },  // write_file (after resume)
      { role: "executor", cycle: 1, modelName: "test-executor-model" },  // finish
      { role: "executor", cycle: 1, modelName: "test-executor-model" },  // final text
      { role: "reviewer", cycle: 1, modelName: "test-reviewer-model" },
    ]);
  }, 15_000);

  it("reviewer request_changes auto-retries executor once before asking human", async () => {
    state.scenario = "review_changes";

    const [{ ensureArcheReady }, runsModule, workersModule] = await Promise.all([
      import("../src/lib/bootstrap"),
      import("../src/lib/arche/runs"),
      import("../src/lib/arche/workers"),
    ]);

    await ensureArcheReady();
    await workersModule.registerWorker({
      workerId: "worker-1",
      hostname: "test-worker",
      pid: 1001,
      metadata: { pollIntervalSeconds: 1 },
    });

    const accepted = await runsModule.handleJiraWebhook({
      payload: {
        issue_key: issue.key,
      },
    });

    // Planning
    await runsModule.claimNextRun("worker-1", 60);
    await runsModule.processRun(accepted.runId!, "worker-1");
    await runsModule.approvePlan(accepted.runId!);

    // Single execution: executor → reviewer (request_changes) → auto-retry executor → reviewer (approve)
    // No human intervention needed — the auto-retry resolves it.
    await runsModule.claimNextRun("worker-1", 60);
    const awaitingPublish = await runsModule.processRun(accepted.runId!, "worker-1");

    expect(awaitingPublish.status).toBe("awaiting_publish_approval");
    expect(awaitingPublish.currentCycle).toBe(2);
    expect(awaitingPublish.latestReviewSummary).toBe("Review passed after validation.");
    expect(awaitingPublish.latestFindings).toEqual([]);

    const detail = await runsModule.getRunDetail(accepted.runId!);
    expect(detail.tasks.map((task) => `${task.role}:${task.cycle}:${task.status}`)).toEqual([
      "planner:0:completed",
      "executor:1:completed",
      "reviewer:1:completed",
      "executor:2:completed",
      "reviewer:2:completed",
    ]);
    expect(state.providerInvocations.map((i) => i.role)).toEqual([
      "planner",
      "executor", "executor", "executor",  // write_file, finish, final text (cycle 1)
      "reviewer",
      "executor", "executor", "executor",  // write_file, finish, final text (cycle 2)
      "reviewer",
    ]);
    expect(state.providerInvocations[0]).toEqual({ role: "planner", cycle: 0, modelName: "test-planner-model" });
    expect(state.providerInvocations[1]).toEqual({ role: "executor", cycle: 1, modelName: "test-executor-model" });
    expect(state.providerInvocations[4]).toEqual({ role: "reviewer", cycle: 1, modelName: "test-reviewer-model" });
    expect(state.providerInvocations[5]).toEqual({ role: "executor", cycle: 2, modelName: "test-executor-model" });
    expect(state.providerInvocations[8]).toEqual({ role: "reviewer", cycle: 2, modelName: "test-reviewer-model" });
  }, 15_000);
});
