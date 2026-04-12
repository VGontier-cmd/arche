import { existsSync } from "node:fs";

import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

import { resolveArcheProjectEnvPath } from "./install";

// Load the project-specific env file first so its values take precedence over
// a generic .env, but neither call uses `override` so that env vars already set
// in the process (e.g. by tests or container orchestrators) always win.
const archeEnvFile = resolveArcheProjectEnvPath();
if (existsSync(archeEnvFile)) {
  loadDotEnv({ path: archeEnvFile });
}
loadDotEnv();

function readEnvValue(key: keyof NodeJS.ProcessEnv) {
  const value = process.env[key];
  return value === "" ? undefined : value;
}

const envSchema = z.object({
  DATABASE_URL: z.string().default("./runtime/arche.db"),
  ARCHE_CONFIG_PATH: z.string().default("./orchestrator.yml"),
  ARCHE_SERVER_HOST: z.string().default("127.0.0.1"),
  ARCHE_SERVER_AUTH_TOKEN: z.string().optional(),
  USER_GIT_AUTHOR_NAME: z.string().default("arche-bot"),
  USER_GIT_AUTHOR_EMAIL: z.string().default("arche-bot@example.invalid"),
  USER_JIRA_BASE_URL: z.string().url().optional(),
  USER_JIRA_EMAIL: z.string().optional(),
  USER_JIRA_API_TOKEN: z.string().optional(),
  USER_GITLAB_BASE_URL: z.string().url().optional(),
  USER_GITLAB_TOKEN: z.string().optional(),
  /** Optional PAT for HTTPS Git to github.com (username "x-access-token"); DB keeps clean URLs. */
  USER_GITHUB_TOKEN: z.string().optional(),
  /** HMAC-SHA256 secret to verify Jira webhook payloads. Warning logged if not set. */
  ARCHE_JIRA_WEBHOOK_SECRET: z.string().optional(),
  ARCHE_RUNTIME_ROOT: z.string().default("./runtime"),
  ARCHE_LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type ArcheEnv = z.infer<typeof envSchema>;

declare global {
  var __archeEnv: ArcheEnv | undefined;
}

export const env =
  globalThis.__archeEnv ??
  envSchema.parse({
    DATABASE_URL: readEnvValue("DATABASE_URL"),
    ARCHE_CONFIG_PATH: readEnvValue("ARCHE_CONFIG_PATH"),
    ARCHE_SERVER_HOST: readEnvValue("ARCHE_SERVER_HOST"),
    ARCHE_SERVER_AUTH_TOKEN: readEnvValue("ARCHE_SERVER_AUTH_TOKEN"),
    USER_GIT_AUTHOR_NAME: readEnvValue("USER_GIT_AUTHOR_NAME"),
    USER_GIT_AUTHOR_EMAIL: readEnvValue("USER_GIT_AUTHOR_EMAIL"),
    USER_JIRA_BASE_URL: readEnvValue("USER_JIRA_BASE_URL"),
    USER_JIRA_EMAIL: readEnvValue("USER_JIRA_EMAIL"),
    USER_JIRA_API_TOKEN: readEnvValue("USER_JIRA_API_TOKEN"),
    USER_GITLAB_BASE_URL: readEnvValue("USER_GITLAB_BASE_URL"),
    USER_GITLAB_TOKEN: readEnvValue("USER_GITLAB_TOKEN"),
    USER_GITHUB_TOKEN: readEnvValue("USER_GITHUB_TOKEN"),
    ARCHE_JIRA_WEBHOOK_SECRET: readEnvValue("ARCHE_JIRA_WEBHOOK_SECRET"),
    ARCHE_RUNTIME_ROOT: readEnvValue("ARCHE_RUNTIME_ROOT"),
    ARCHE_LOG_LEVEL: readEnvValue("ARCHE_LOG_LEVEL"),
  });

if (!globalThis.__archeEnv) {
  globalThis.__archeEnv = env;
}

export function readSecretEnv(name: string) {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}
