import type { OrchestratorConfig } from "../config";
import { resolveExecutionProfile } from "./profiles";
import type { ResolvedExecutionProfile } from "./profiles";

export type ComplexityInput = {
  descriptionLength: number;
  trackedFileCount: number;
  cycle: number;
  hasPendingFindings: boolean;
};

/**
 * Score task complexity on a 0–100 scale.
 * Used to select the appropriate executor profile when complexity_routing is enabled.
 */
export function scoreComplexity(input: ComplexityInput): number {
  let score = 0;
  score += Math.min(input.descriptionLength / 20, 30);  // max 30 pts
  score += Math.min(input.trackedFileCount / 10, 30);   // max 30 pts
  score += Math.min(input.cycle * 10, 20);              // max 20 pts
  score += input.hasPendingFindings ? 20 : 0;           // 20 pts flat
  return Math.min(Math.round(score), 100);
}

/**
 * Returns the execution profile to use for a given complexity score.
 * Falls back to the default profile if complexity_routing is disabled or unconfigured.
 */
export function resolveProfileByComplexity(
  config: OrchestratorConfig,
  role: "planner" | "executor" | "reviewer",
  complexityScore: number,
): ResolvedExecutionProfile {
  const routing = config.complexity_routing;
  if (!routing?.enabled) return resolveExecutionProfile(config, role);

  let profileName: string;
  if (complexityScore <= (routing.thresholds?.low?.max_score ?? 30)) {
    profileName = routing.thresholds?.low?.profile ?? routing.default ?? "default";
  } else if (complexityScore >= (routing.thresholds?.high?.min_score ?? 70)) {
    profileName = routing.thresholds?.high?.profile ?? routing.default ?? "default";
  } else {
    profileName = routing.default ?? "default";
  }

  // Resolve named profile, falling back to standard resolution if not found
  const profiles = config.executors.profiles;
  if (profileName in profiles) {
    return {
      name: profileName,
      ...profiles[profileName as keyof typeof profiles],
    } as ResolvedExecutionProfile;
  }
  return resolveExecutionProfile(config, role);
}
