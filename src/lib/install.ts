import { readFile, writeFile } from "node:fs/promises";

import { parse as parseDotEnv } from "dotenv";

export const managedEnvKeys = [
  "DATABASE_URL",
  "ARCHE_CONFIG_PATH",
  "ARCHE_RUNTIME_ROOT",
  "ARCHE_SERVER_HOST",
  "ARCHE_SERVER_AUTH_TOKEN",
  "ARCHE_GIT_AUTHOR_NAME",
  "ARCHE_GIT_AUTHOR_EMAIL",
  "ARCHE_LOG_LEVEL",
  "ARCHE_DEFAULT_API_KEY",
  "ARCHE_JIRA_BASE_URL",
  "ARCHE_JIRA_EMAIL",
  "ARCHE_JIRA_API_TOKEN",
  "ARCHE_JIRA_WEBHOOK_SECRET",
  "ARCHE_GITLAB_BASE_URL",
  "ARCHE_GITLAB_TOKEN",
] as const;

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
  ARCHE_GIT_AUTHOR_NAME: "arche-bot",
  ARCHE_GIT_AUTHOR_EMAIL: "arche-bot@example.invalid",
  ARCHE_LOG_LEVEL: "info",
  ARCHE_DEFAULT_API_KEY: "",
  ARCHE_JIRA_BASE_URL: "",
  ARCHE_JIRA_EMAIL: "",
  ARCHE_JIRA_API_TOKEN: "",
  ARCHE_JIRA_WEBHOOK_SECRET: "",
  ARCHE_GITLAB_BASE_URL: "",
  ARCHE_GITLAB_TOKEN: "",
};

export async function readEnvFile(path: string) {
  try {
    const raw = await readFile(path, "utf8");
    return parseDotEnv(raw);
  } catch {
    return {};
  }
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

export async function writeInstallEnvFile(path: string, values: InstallEnvValues, preserved: Record<string, string>) {
  const content = renderInstallEnvFile(values, preserved);
  await writeFile(path, content, "utf8");
}

export function renderInstallEnvFile(values: InstallEnvValues, preserved: Record<string, string> = {}) {
  const lines = ["# Arche CLI configuration"];

  for (const key of managedEnvKeys) {
    lines.push(`${key}=${formatEnvValue(values[key])}`);
  }

  const preservedEntries = Object.entries(preserved);
  if (preservedEntries.length > 0) {
    lines.push("", "# Additional secrets");
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

function formatEnvValue(value: string) {
  if (value.length === 0) {
    return '""';
  }

  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}
