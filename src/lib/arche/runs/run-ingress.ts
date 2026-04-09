import { and, eq, inArray } from "drizzle-orm";

import { getConfig } from "../../config";
import { db } from "../../db/client";
import { runs, type RepositoryRow } from "../../db/schema";
import { ExternalServiceError } from "../errors";
import { JiraClient, normalizeIssue } from "../jira";
import {
  ACTIVE_RUN_STATES,
  assertIssueEligible,
  evaluateIssueEligibility,
} from "../policy";
import { listMissingExecutionProfileSecrets } from "../profiles";
import { resolveRepositoryForIssue } from "../repository-resolver";
import type { JiraIssue } from "../types";
import { createRun } from "./run-lifecycle.js";

export async function activeRunExists(ticketKey: string) {
  const [run] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.ticketKey, ticketKey),
        inArray(runs.status, ACTIVE_RUN_STATES),
      ),
    )
    .limit(1);
  return Boolean(run);
}

export async function createManualRunForTicket(input: {
  ticketKey: string;
  force?: boolean;
}) {
  const jira = new JiraClient();
  if (!jira.configured) {
    throw new ExternalServiceError("Jira client is not configured");
  }

  const issue = await jira.fetchIssue(input.ticketKey);
  const config = await getConfig();
  const force = Boolean(input.force);
  const hasActiveRun = await activeRunExists(issue.key);
  let repository: RepositoryRow | null = null;
  let repoResolved = true;

  try {
    repository = await resolveRepositoryForIssue(issue);
  } catch {
    repoResolved = false;
  }

  if (!force) {
    assertIssueEligible(issue, config.policy, {
      hasActiveRun,
      repoResolved,
    });
  } else if (!repoResolved || !repository) {
    throw new ExternalServiceError(
      "Cannot force a manual run without a matching repository rule",
      "manual_run_repo_required",
    );
  }

  const missingSecrets = listMissingExecutionProfileSecrets(config);
  if (missingSecrets.length > 0) {
    throw new ExternalServiceError(
      `Missing execution profile secrets: ${missingSecrets.map((item) => `${item.role}:${item.apiKeyEnv}`).join(", ")}`,
    );
  }

  return createRun({
    issue,
    source: "manual",
    repository,
    manualOverride: force
      ? {
          force: true,
          bypassedEligibilityChecks: true,
          hadActiveRun: hasActiveRun,
        }
      : {},
  });
}

export async function handleJiraWebhook(input: {
  payload: Record<string, unknown>;
  secret: string | null;
}) {
  const jira = new JiraClient();
  if (!jira.validateWebhookSecret(input.secret)) {
    return { accepted: false, reason: "Invalid webhook secret" };
  }

  const issueKey =
    typeof input.payload.issue_key === "string"
      ? input.payload.issue_key
      : typeof (input.payload.issue as { key?: unknown } | undefined)?.key ===
          "string"
        ? (input.payload.issue as { key: string }).key
        : null;

  if (!issueKey && !input.payload.issue) {
    return { accepted: false, reason: "Missing issue key in payload" };
  }

  const issue: JiraIssue =
    issueKey && jira.configured
      ? await jira.fetchIssue(issueKey)
      : normalizeIssue(input.payload.issue);

  let repository: RepositoryRow | null = null;
  let repoResolved = true;
  try {
    repository = await resolveRepositoryForIssue(issue);
  } catch {
    repoResolved = false;
  }

  const config = await getConfig();
  const decision = evaluateIssueEligibility(issue, config.policy, {
    hasActiveRun: await activeRunExists(issue.key),
    repoResolved,
  });
  if (!decision.eligible) {
    return { accepted: false, reason: decision.reasons.join("; ") };
  }

  const missingSecrets = listMissingExecutionProfileSecrets(config);
  if (missingSecrets.length > 0) {
    return {
      accepted: false,
      reason: `Missing execution profile secrets: ${missingSecrets.map((item) => `${item.role}:${item.apiKeyEnv}`).join(", ")}`,
    };
  }

  const run = await createRun({
    issue,
    source: "jira",
    repository,
  });

  return { accepted: true, runId: run.id };
}
