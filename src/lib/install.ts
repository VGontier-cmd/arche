import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse as parseDotEnv } from "dotenv";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/** OpenRouter API key (https://openrouter.ai/keys); referenced by `api_key_env` on the default executor profile. */
export const USER_OPENROUTER_API_KEY_ENV = "USER_OPENROUTER_API_KEY" as const;

const archeInternalManagedKeys = [
  "DATABASE_URL",
  "ARCHE_CONFIG_PATH",
  "ARCHE_RUNTIME_ROOT",
  "ARCHE_SERVER_HOST",
  "ARCHE_SERVER_AUTH_TOKEN",
  "ARCHE_LOG_LEVEL",
] as const;

const userOpenRouterKeys = [USER_OPENROUTER_API_KEY_ENV] as const;

const userGitIdentityKeys = ["USER_GIT_AUTHOR_NAME", "USER_GIT_AUTHOR_EMAIL"] as const;

const userJiraKeys = ["USER_JIRA_BASE_URL", "USER_JIRA_EMAIL", "USER_JIRA_API_TOKEN"] as const;

const userGitlabKeys = ["USER_GITLAB_BASE_URL", "USER_GITLAB_TOKEN"] as const;

const userManagedKeys = [
  ...userOpenRouterKeys,
  ...userGitIdentityKeys,
  ...userJiraKeys,
  ...userGitlabKeys,
] as const;

export const managedEnvKeys = [...archeInternalManagedKeys, ...userManagedKeys] as const;

export type ManagedEnvKey = (typeof managedEnvKeys)[number];
export type InstallEnvValues = Record<ManagedEnvKey, string>;

export function databaseUrlForRuntimeRoot(runtimeRoot: string) {
  return `${runtimeRoot}/arche.db`;
}

export const defaultInstallEnvValues: InstallEnvValues = {
  DATABASE_URL: databaseUrlForRuntimeRoot("./runtime"),
  ARCHE_CONFIG_PATH: "./orchestrator.yml",
  ARCHE_RUNTIME_ROOT: "./runtime",
  ARCHE_SERVER_HOST: "127.0.0.1",
  ARCHE_SERVER_AUTH_TOKEN: "",
  ARCHE_LOG_LEVEL: "info",
  [USER_OPENROUTER_API_KEY_ENV]: "",
  USER_GIT_AUTHOR_NAME: "arche-bot",
  USER_GIT_AUTHOR_EMAIL: "arche-bot@example.invalid",
  USER_JIRA_BASE_URL: "",
  USER_JIRA_EMAIL: "",
  USER_JIRA_API_TOKEN: "",
  USER_GITLAB_BASE_URL: "",
  USER_GITLAB_TOKEN: "",
};

export const defaultInitOrchestratorValues = {
  branchPrefix: "arche/",
  sharedModel: "openai/gpt-5.4-mini",
} as const;

const defaultInitOrchestratorConfig: Record<string, unknown> = {
  runtime: {
    root_dir: "./runtime",
    repos_dir: "./runtime/repos",
    runs_dir: "./runtime/runs",
    logs_dir: "./runtime/logs",
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
    allowed_issue_types: ["Bug", "Task", "Chore"],
    max_changed_files: 20,
    max_changed_lines: 500,
    description_min_length: 20,
  },
  sandbox: {
    image: "arche-app:local",
    network: "bridge",
    shell: "/bin/bash",
    read_only_rootfs: true,
    tmpfs_paths: ["/tmp"],
    cap_drop: ["ALL"],
    no_new_privileges: true,
    pids_limit: 256,
    memory_limit_mb: 2048,
    cpus: "2",
    env_allowlist: [],
    user: "",
  },
  defaults: {
    allowed_commands: [],
    validation_commands: [],
  },
  routing: {
    default_repository: null,
  },
  git: {
    branch_prefix: "arche/",
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
        base_url: "https://openrouter.ai/api/v1",
        model: "openai/gpt-5.4-mini",
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
};

export type InitOrchestratorValues = {
  branchPrefix: string;
  sharedModel: string;
};

export async function readEnvFile(path: string) {
  try {
    const raw = await readFile(path, "utf8");
    return parseDotEnv(raw);
  } catch {
    return {};
  }
}

export async function readInitOrchestratorConfig(path: string): Promise<{
  rawConfig: Record<string, unknown>;
  values: InitOrchestratorValues;
}> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = parseYaml(raw);
    const rawConfig = isObjectRecord(parsed) ? parsed : {};
    const git = isObjectRecord(rawConfig.git) ? rawConfig.git : {};
    const executors = isObjectRecord(rawConfig.executors) ? rawConfig.executors : {};
    const profiles = isObjectRecord(executors.profiles) ? executors.profiles : {};
    const defaultProfile = isObjectRecord(profiles.default) ? profiles.default : {};
    return {
      rawConfig,
      values: {
        branchPrefix:
          typeof git.branch_prefix === "string"
            ? git.branch_prefix
            : defaultInitOrchestratorValues.branchPrefix,
        sharedModel:
          typeof defaultProfile.model === "string"
            ? defaultProfile.model
            : defaultInitOrchestratorValues.sharedModel,
      },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        rawConfig: {},
        values: {
          ...defaultInitOrchestratorValues,
        },
      };
    }
    throw error;
  }
}

/** Installed project layout: secrets and local env live next to the workspace, not as a loose package dotfile. */
export const ARCHE_PROJECT_ENV_RELATIVE = ".arche/environment" as const;

export function resolveArcheProjectEnvPath(cwd = process.cwd()): string {
  return resolve(cwd, ARCHE_PROJECT_ENV_RELATIVE);
}

/** True when the parsed env file has at least one non-empty value (whitespace-only counts as empty). */
export function envFileHasNonEmptyValues(parsed: Record<string, string>): boolean {
  return Object.values(parsed).some((v) => v !== undefined && String(v).trim() !== "");
}

export function resolveInstallEnvValues(input: {
  exampleValues?: Record<string, string>;
  existingValues?: Record<string, string>;
  processValues?: Partial<Record<ManagedEnvKey, string | undefined>>;
}) {
  const merged = {
    ...defaultInstallEnvValues,
    ...pickManagedOverrides(input.exampleValues),
    ...pickManagedOverrides(input.existingValues),
    ...pickManagedOverrides(input.processValues),
  };

  merged.DATABASE_URL = databaseUrlForRuntimeRoot(merged.ARCHE_RUNTIME_ROOT);

  return merged;
}

export function preserveUnmanagedEnvValues(input: {
  exampleValues?: Record<string, string>;
  existingValues?: Record<string, string>;
}) {
  const source = hasKeys(input.existingValues) ? input.existingValues : input.exampleValues;
  if (!source) return {};

  return Object.fromEntries(
    Object.entries(source).filter(([key]) => !managedEnvKeys.includes(key as ManagedEnvKey)),
  );
}

export function normalizeBranchPrefix(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return `${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}/`;
}

export function mergeInitOrchestratorConfig(
  rawConfig: Record<string, unknown>,
  values: InitOrchestratorValues,
) {
  const nextConfig: Record<string, unknown> = {
    ...(structuredClone(defaultInitOrchestratorConfig) as Record<string, unknown>),
    ...rawConfig,
  };
  const nextGit = {
    ...(isObjectRecord(rawConfig.git) ? rawConfig.git : {}),
    branch_prefix: normalizeBranchPrefix(values.branchPrefix),
  };
  nextConfig.git = nextGit;
  const currentExecutors = isObjectRecord(rawConfig.executors) ? rawConfig.executors : {};
  const currentProfiles = isObjectRecord(currentExecutors.profiles) ? currentExecutors.profiles : {};
  const currentDefaultProfile = isObjectRecord(currentProfiles.default) ? currentProfiles.default : {};
  const normalizedModel = values.sharedModel.trim() || defaultInitOrchestratorValues.sharedModel;
  nextConfig.executors = {
    ...(isObjectRecord(nextConfig.executors) ? nextConfig.executors : {}),
    profiles: {
      ...(isObjectRecord(currentExecutors.profiles) ? currentExecutors.profiles : {}),
      default: {
        ...currentDefaultProfile,
        model: normalizedModel,
      },
    },
  };

  return nextConfig;
}

export async function writeInstallEnvFile(path: string, values: InstallEnvValues, preserved: Record<string, string>) {
  const content = renderInstallEnvFile(values, preserved);
  await writeFile(path, content, "utf8");
}

export async function writeInitOrchestratorConfig(path: string, config: Record<string, unknown>) {
  await writeFile(path, stringifyYaml(config), "utf8");
}

function renderKeyBlock(lines: string[], keys: readonly string[], values: InstallEnvValues) {
  for (const key of keys) {
    lines.push(`${key}=${formatEnvValue(values[key as ManagedEnvKey])}`);
  }
}

export function renderInstallEnvFile(values: InstallEnvValues, preserved: Record<string, string> = {}) {
  const lines: string[] = ["# Arche environment"];

  lines.push("", "# Internal — runtime and Arche services (DATABASE_URL + ARCHE_*)");
  renderKeyBlock(lines, archeInternalManagedKeys, values);

  lines.push("", "# User — OpenRouter API key (https://openrouter.ai — set api_key_env on executors.profiles)");
  renderKeyBlock(lines, userOpenRouterKeys, values);

  lines.push("", "# User — Git identity for automated commits");
  renderKeyBlock(lines, userGitIdentityKeys, values);

  lines.push("", "# User — Jira API");
  renderKeyBlock(lines, userJiraKeys, values);

  lines.push("", "# User — GitLab (optional)");
  renderKeyBlock(lines, userGitlabKeys, values);

  const preservedEntries = Object.entries(preserved);
  if (preservedEntries.length > 0) {
    lines.push("", "# User — additional variables (prefer USER_* prefix)");
    for (const [key, value] of preservedEntries) {
      lines.push(`${key}=${formatEnvValue(value)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function applyEnvToProcess(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
}

function pickManagedOverrides(input?: Partial<Record<string, string | undefined>>) {
  const values: Partial<InstallEnvValues> = {};

  for (const key of managedEnvKeys) {
    const raw = input?.[key];
    if (raw !== undefined) {
      values[key] = raw;
    }
  }

  return values;
}

function hasKeys(input?: Record<string, string>) {
  return Boolean(input && Object.keys(input).length > 0);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatEnvValue(value: string) {
  if (value.length === 0) {
    return '""';
  }

  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}
