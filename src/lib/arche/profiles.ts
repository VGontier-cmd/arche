import type { ExecutorProfileConfig, OrchestratorConfig } from "../config";
import type { RunTaskRole } from "./types";

export type ResolvedExecutionProfile = ExecutorProfileConfig & {
  name: string;
  role: RunTaskRole;
};

export function resolveExecutionProfile(
  config: OrchestratorConfig,
  role: RunTaskRole,
): ResolvedExecutionProfile {
  const profileName = config.executors.defaults[role];
  const profile = config.executors.profiles[profileName];
  if (!profile) {
    throw new Error(`Unknown execution profile ${profileName} for role ${role}`);
  }
  return {
    ...profile,
    name: profileName,
    role,
  };
}

export function presentExecutionProfiles(config: OrchestratorConfig) {
  return {
    defaults: {
      ...config.executors.defaults,
    },
    profiles: Object.fromEntries(
      Object.entries(config.executors.profiles).map(([name, profile]) => [
        name,
        {
          driver: profile.driver,
          baseUrl: profile.base_url,
          model: profile.model,
          apiKeyEnv: profile.api_key_env,
          apiKeyConfigured: hasExecutionProfileApiKey(profile),
          timeoutSeconds: profile.timeout_seconds,
          maxActions: profile.max_actions,
          temperature: profile.temperature,
        },
      ]),
    ),
  };
}

export function hasExecutionProfileApiKey(profile: ExecutorProfileConfig) {
  const value = process.env[profile.api_key_env];
  return typeof value === "string" && value.length > 0;
}

export function listMissingExecutionProfileSecrets(config: OrchestratorConfig) {
  const missing = [];
  for (const role of ["planner", "executor", "reviewer"] as const) {
    const profile = resolveExecutionProfile(config, role);
    if (!hasExecutionProfileApiKey(profile)) {
      missing.push({
        role,
        profileName: profile.name,
        apiKeyEnv: profile.api_key_env,
      });
    }
  }
  return missing;
}
