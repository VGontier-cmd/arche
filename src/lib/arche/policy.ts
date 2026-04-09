import type { OrchestratorConfig } from "../config";
import { EligibilityError } from "./errors";
import { RUN_STATES } from "./types";
import type { JiraIssue, PolicyDecision, RunStatus } from "./types";

export const ACTIVE_RUN_STATES: RunStatus[] = [
  "pending",
  "planning",
  "awaiting_plan_approval",
  "executing",
  "reviewing",
  "needs_human_input",
  "awaiting_publish_approval",
  "publish_approved",
  "publishing",
  "validating",
  "preparing_repo",
  "creating_sandbox",
  "running_agent",
  "validating_changes",
];

export const TERMINAL_RUN_STATES: RunStatus[] = ["success", "failed", "cancelled", "publish_rejected"];

export function evaluateIssueEligibility(
  issue: JiraIssue,
  config: OrchestratorConfig["policy"],
  options: {
    hasActiveRun: boolean;
    repoResolved: boolean;
  },
): PolicyDecision {
  const reasons: string[] = [];

  if (!config.allowed_issue_types.includes(issue.issueType ?? "")) {
    reasons.push("Issue type is not allowed");
  }
  if (!issue.labels.includes(config.required_label)) {
    reasons.push("Required label missing");
  }
  if (issue.assignee !== config.assignee) {
    reasons.push("Issue assignee does not match configured agent");
  }
  if (issue.status !== config.required_status) {
    reasons.push("Issue status is not eligible");
  }
  if ((issue.description ?? "").trim().length < config.description_min_length) {
    reasons.push("Issue description is too short");
  }
  if (!options.repoResolved) {
    reasons.push("No repository mapping matched the issue");
  }
  if (options.hasActiveRun) {
    reasons.push("An active run already exists for this ticket");
  }

  return {
    eligible: reasons.length === 0,
    reasons,
  };
}

export function assertIssueEligible(
  issue: JiraIssue,
  config: OrchestratorConfig["policy"],
  options: {
    hasActiveRun: boolean;
    repoResolved: boolean;
  },
) {
  const decision = evaluateIssueEligibility(issue, config, options);
  if (!decision.eligible) {
    throw new EligibilityError(decision.reasons.join("; "));
  }
}

export function isActiveRunStatus(status: string): status is RunStatus {
  return ACTIVE_RUN_STATES.includes(status as RunStatus);
}

export function isValidRunStatus(status: string): status is RunStatus {
  return RUN_STATES.includes(status as RunStatus);
}
