import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("getConfig", () => {
  let workspace: string;
  let configPath: string;
  let runtimeRoot: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "arche-config-"));
    configPath = join(workspace, "orchestrator.yml");
    runtimeRoot = join(workspace, "runtime");
    process.env.ARCHE_CONFIG_PATH = configPath;
    process.env.ARCHE_RUNTIME_ROOT = runtimeRoot;
    vi.resetModules();
    delete (globalThis as { __archeEnv?: unknown }).__archeEnv;
  });

  afterEach(async () => {
    vi.resetModules();
    delete (globalThis as { __archeEnv?: unknown }).__archeEnv;
    await rm(workspace, { recursive: true, force: true });
  });

  async function loadConfig(configYaml?: string) {
    if (configYaml !== undefined) {
      await writeFile(configPath, configYaml, "utf8");
    }
    const { getConfig } = await import("../src/lib/config");
    return getConfig();
  }

  it("returns the default API-only executor profiles when the config file is missing", async () => {
    const config = await loadConfig();

    expect(config.executors.defaults).toEqual({
      planner: "default",
      executor: "default",
      reviewer: "default",
    });
    expect(config.executors.profiles.default).toMatchObject({
      driver: "openai_compatible_api",
      model: "openai/gpt-5.4-mini",
      api_key_env: "USER_OPENROUTER_API_KEY",
    });
    expect(config.routing.default_repository).toBeNull();
    expect(config.git.branch_prefix).toBe("arche/");
    expect(config.runtime.root_dir).toBe(runtimeRoot);
  });

  it("rejects deprecated workflow.executor_kind and workflow.models", async () => {
    await expect(
      loadConfig([
        "workflow:",
        "  mode: plan_execute_review",
        "  executor_kind: codex_cli",
        "  models:",
        "    planner: old",
        "",
      ].join("\n")),
    ).rejects.toThrow(
      "workflow.executor_kind and workflow.models are no longer supported; use executors.defaults and executors.profiles",
    );
  });

  it("rejects defaults that point to an unknown execution profile", async () => {
    await expect(
      loadConfig([
        "executors:",
        "  defaults:",
        "    planner: missing",
        "    executor: default",
        "    reviewer: default",
        "  profiles:",
        "    default:",
        "      driver: openai_compatible_api",
        "      base_url: https://llm.example.com/v1",
        "      model: test-model",
        "      api_key_env: USER_OPENROUTER_API_KEY",
        "",
      ].join("\n")),
    ).rejects.toThrow(/Unknown executor profile: missing/);
  });

  it("parses distinct per-role OpenRouter profiles", async () => {
    const config = await loadConfig([
      "runtime: {}",
      "worker: {}",
      "policy: {}",
      "sandbox: {}",
      "defaults: {}",
      "routing:",
      "  default_repository: shared-service",
      "git:",
      "  branch_prefix: arche/",
      "executors:",
      "  defaults:",
      "    planner: planner",
      "    executor: executor",
      "    reviewer: reviewer",
      "  profiles:",
      "    planner:",
      "      driver: openai_compatible_api",
      "      base_url: https://openrouter.ai/api/v1",
      "      model: openai/gpt-5.4",
      "      api_key_env: USER_OPENROUTER_API_KEY",
      "    executor:",
      "      driver: openai_compatible_api",
      "      base_url: https://openrouter.ai/api/v1",
      "      model: openai/gpt-5.4-mini",
      "      api_key_env: USER_OPENROUTER_API_KEY",
      "    reviewer:",
      "      driver: openai_compatible_api",
      "      base_url: https://openrouter.ai/api/v1",
      "      model: anthropic/claude-3.5-sonnet",
      "      api_key_env: USER_OPENROUTER_API_KEY",
      "bootstrap: {}",
      "",
    ].join("\n"));

    expect(config.executors.defaults).toEqual({
      planner: "planner",
      executor: "executor",
      reviewer: "reviewer",
    });
    expect(config.executors.profiles.planner.model).toBe("openai/gpt-5.4");
    expect(config.executors.profiles.executor.model).toBe("openai/gpt-5.4-mini");
    expect(config.executors.profiles.reviewer.api_key_env).toBe("USER_OPENROUTER_API_KEY");
    expect(config.routing.default_repository).toBe("shared-service");
    expect(config.git.branch_prefix).toBe("arche/");
  });
});
