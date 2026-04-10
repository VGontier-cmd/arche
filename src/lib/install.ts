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
  branchPrefix: "jira/",
  defaultRepository: "",
} as const;

export type InitOrchestratorValues = {
  branchPrefix: string;
  defaultRepository: string;
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
    const routing = isObjectRecord(rawConfig.routing) ? rawConfig.routing : {};
    const git = isObjectRecord(rawConfig.git) ? rawConfig.git : {};
    return {
      rawConfig,
      values: {
        branchPrefix:
          typeof git.branch_prefix === "string"
            ? git.branch_prefix
            : defaultInitOrchestratorValues.branchPrefix,
        defaultRepository:
          typeof routing.default_repository === "string" ? routing.default_repository : "",
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
    ...rawConfig,
  };
  const nextGit = {
    ...(isObjectRecord(rawConfig.git) ? rawConfig.git : {}),
    branch_prefix: normalizeBranchPrefix(values.branchPrefix),
  };
  nextConfig.git = nextGit;

  const defaultRepository = values.defaultRepository.trim();
  const nextRouting = {
    ...(isObjectRecord(rawConfig.routing) ? rawConfig.routing : {}),
  };

  if (defaultRepository) {
    nextRouting.default_repository = defaultRepository;
  } else {
    delete nextRouting.default_repository;
  }

  if (Object.keys(nextRouting).length > 0) {
    nextConfig.routing = nextRouting;
  } else {
    delete nextConfig.routing;
  }

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
