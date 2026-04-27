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
  /** Inline ticket metadata to bypass Jira lookup — required when Jira is not configured. */
  inline?: {
    title: string;
    description?: string;
    projectKey?: string | null;
    labels?: string[];
    issueType?: string | null;
  };
}) {
  const jira = new JiraClient();
  let issue: JiraIssue;
  if (input.inline) {
    issue = normalizeIssue({
      key: input.ticketKey,
      fields: {
        summary: input.inline.title,
        description: input.inline.description ?? "",
        status: { name: "In Progress" },
        labels: input.inline.labels ?? [],
        issuetype: input.inline.issueType ? { name: input.inline.issueType } : { name: "Task" },
        project: { key: input.inline.projectKey ?? input.ticketKey.split("-")[0] ?? null },
      },
    });
  } else {
    if (!jira.configured) {
      throw new ExternalServiceError(
        "Jira client is not configured. Pass --title (and optionally --description) to create a manual run without Jira.",
      );
    }
    issue = await jira.fetchIssue(input.ticketKey);
  }
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

export async function handleJiraWebhook(input: { payload: Record<string, unknown> }) {
  const jira = new JiraClient();

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
