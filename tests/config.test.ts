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
      api_key_env: "ARCHE_DEFAULT_API_KEY",
    });
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
        "      api_key_env: ARCHE_DEFAULT_API_KEY",
        "",
      ].join("\n")),
    ).rejects.toThrow(/Unknown executor profile: missing/);
  });

  it("parses distinct per-role profiles", async () => {
    const config = await loadConfig([
      "runtime: {}",
      "worker: {}",
      "policy: {}",
      "sandbox: {}",
      "defaults: {}",
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
      "      api_key_env: QWEN_API_KEY",
      "    kimi:",
      "      driver: openai_compatible_api",
      "      base_url: https://kimi.example.com/v1",
      "      model: kimi-k2",
      "      api_key_env: KIMI_API_KEY",
      "    openai:",
      "      driver: openai_compatible_api",
      "      base_url: https://api.openai.com/v1",
      "      model: gpt-5.4-mini",
      "      api_key_env: OPENAI_API_KEY",
      "bootstrap: {}",
      "",
    ].join("\n"));

    expect(config.executors.defaults).toEqual({
      planner: "qwen",
      executor: "kimi",
      reviewer: "openai",
    });
    expect(config.executors.profiles.qwen.base_url).toBe("https://qwen.example.com/v1");
    expect(config.executors.profiles.kimi.model).toBe("kimi-k2");
    expect(config.executors.profiles.openai.api_key_env).toBe("OPENAI_API_KEY");
  });
});
