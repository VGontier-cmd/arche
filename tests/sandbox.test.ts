import { describe, expect, it, vi } from "vitest";

const runCommandMock = vi.fn();

vi.mock("../src/lib/arche/utils", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/arche/utils")>(
    "../src/lib/arche/utils",
  );
  return {
    ...actual,
    runCommand: runCommandMock,
  };
});

describe("SandboxManager", () => {
  it("passes security flags and allowed environment variables to docker run", async () => {
    process.env.USER_OPENROUTER_API_KEY = "provider-token";
    process.env.UNRELATED_SECRET = "ignore-me";
    runCommandMock.mockResolvedValue({
      command: "docker run",
      returncode: 0,
      stdout: "sandbox-id\n",
      stderr: "",
      durationMs: 5,
    });

    const { SandboxManager } = await import("../src/lib/arche/sandbox");

    const manager = new SandboxManager({
      runtime: {
        root_dir: "/tmp/runtime",
        repos_dir: "/tmp/runtime/repos",
        runs_dir: "/tmp/runtime/runs",
        logs_dir: "/tmp/runtime/logs",
        db_retention_days: 30,
        artifact_retention_days: 14,
        failed_worktree_retention_days: 3,
      },
      worker: {
        poll_interval_seconds: 5,
        lease_ttl_seconds: 900,
        max_agent_steps: 8,
        max_run_seconds: 1200,
      },
      policy: {
        assignee: "agent-dev",
        required_status: "In Progress",
        required_label: "agent-ready",
        allowed_issue_types: ["Bug"],
        max_changed_files: 20,
        max_changed_lines: 500,
        description_min_length: 20,
      },
      sandbox: {
        image: "node:22-bookworm",
        network: "bridge",
        shell: "/bin/bash",
        read_only_rootfs: true,
        tmpfs_paths: ["/tmp"],
        cap_drop: ["ALL"],
        no_new_privileges: true,
        pids_limit: 256,
        memory_limit_mb: 2048,
        cpus: "2",
        env_allowlist: ["USER_OPENROUTER_API_KEY"],
        user: "",
      },
      defaults: {
        allowed_commands: [],
        validation_commands: [],
      },
      workflow: {
        mode: "plan_execute_review",
        max_review_cycles: 3,
        require_plan_approval: true,
        require_publish_approval: true,
      },
      executors: {
        defaults: {
          planner: "default",
          executor: "default",
          reviewer: "default",
        },
        profiles: {
          default: {
            driver: "openai_compatible_api",
            base_url: "https://llm.example.com/v1",
            model: "test-model",
            api_key_env: "USER_OPENROUTER_API_KEY",
            timeout_seconds: 60,
            max_actions: 8,
            temperature: 0.1,
          },
        },
      },
      bootstrap: {
        repositories: [],
        repo_rules: [],
      },
    });

    await manager.create("run-123", "/tmp/worktree");

    expect(runCommandMock).toHaveBeenCalledTimes(1);
    expect(runCommandMock.mock.calls[0]?.[0]).toBe("docker");
    expect(runCommandMock.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([
        "--read-only",
        "--security-opt",
        "no-new-privileges=true",
        "--tmpfs",
        "/tmp",
        "--cap-drop",
        "ALL",
        "--pids-limit",
        "256",
        "--memory",
        "2048m",
        "--cpus",
        "2",
        "-e",
        "USER_OPENROUTER_API_KEY=provider-token",
      ]),
    );
    expect(runCommandMock.mock.calls[0]?.[1]).not.toContain("UNRELATED_SECRET=ignore-me");
  });
});
