import { eq } from "drizzle-orm";

import { db, withSqliteWriteRetry } from "../../db/client";
import { runs } from "../../db/schema";
import { ExternalServiceError } from "../errors";
import { GitHubClient } from "../github";
import { GitLabClient } from "../gitlab";
import { JiraClient } from "../jira";
import type { JiraIssue } from "../types";
import { appendRunEvent, appendRunMessage, appendSystemRunLog, transitionRun } from "./run-writer";
import { getRunById } from "./run-queries";
import { getRepositoryById } from "./repositories";
import { getLatestTaskForRole } from "./run-tasks";

const TERMINAL_RUN_STATUSES = new Set([
  "success",
  "pushed",
  "failed",
  "cancelled",
  "publish_rejected",
]);

export async function cancelRun(runId: string) {
  const run = await getRunById(runId);
  // Already terminal — refuse instead of silently flipping cancel_requested on
  // a finished run, which would mislead future readers and produce empty events.
  if (TERMINAL_RUN_STATUSES.has(run.status)) {
    throw new ExternalServiceError(
      `Run ${runId} is already in terminal state ${run.status}`,
    );
  }
  if (
    run.status === "pending" ||
    run.status === "awaiting_plan_approval" ||
    run.status === "awaiting_publish_approval" ||
    run.status === "needs_human_input" ||
    run.status === "publish_approved"
  ) {
    await appendSystemRunLog(run.id, "run cancelled before execution");
    return transitionRun(run.id, "cancelled");
  }
  const [updated] = await withSqliteWriteRetry(() => db
    .update(runs)
    .set({
      cancelRequested: true,
      updatedAt: new Date(),
    })
    .where(eq(runs.id, runId))
    .returning());
  await appendRunEvent(runId, "run.cancel_requested");
  await appendSystemRunLog(runId, "cancellation requested");
  return updated;
}

export async function approvePlan(runId: string, proposalIndex?: number) {
  const run = await getRunById(runId);
  if (run.status !== "awaiting_plan_approval") {
    throw new ExternalServiceError(`Run ${runId} is not awaiting plan approval`);
  }

  // If proposals exist and an index is provided, use the selected proposal
  let planMarkdown = run.planMarkdown;
  let planRisks = run.planRisks;
  let planOpenQuestions = run.planOpenQuestions;

  if (run.planProposals && proposalIndex !== undefined) {
    const proposal = run.planProposals[proposalIndex];
    if (!proposal) {
      throw new ExternalServiceError(`Proposal index ${proposalIndex} is out of range`);
    }
    planMarkdown = proposal.planMarkdown;
    planRisks = proposal.risks;
    planOpenQuestions = proposal.openQuestions;
  }

  // Backwards-compat: legacy runs / older fixtures only stored the plan in the
  // planner task's outputJson (sometimes in the pre-proposals flat shape). Fall
  // back to that when the run row doesn't carry the plan directly. We accept
  // both the new `proposals[].planMarkdown` shape and the legacy flat shape
  // without forcing strict schema validation, since old DB rows predate the
  // current schema.
  if (!planMarkdown) {
    const latestPlannerTask = await getLatestTaskForRole(runId, "planner");
    const raw = latestPlannerTask?.outputJson as
      | {
          planMarkdown?: string;
          risks?: string[];
          openQuestions?: string[];
          proposals?: Array<{ planMarkdown?: string; risks?: string[]; openQuestions?: string[] }>;
        }
      | null
      | undefined;
    if (raw) {
      const flat = typeof raw.planMarkdown === "string" ? raw : null;
      const firstProposal = Array.isArray(raw.proposals) ? raw.proposals[0] : null;
      const source = flat ?? firstProposal;
      if (source) {
        planMarkdown = source.planMarkdown ?? planMarkdown;
        planRisks = (source.risks ?? planRisks) as typeof planRisks;
        planOpenQuestions = (source.openQuestions ?? planOpenQuestions) as typeof planOpenQuestions;
      }
    }
  }

  const [updated] = await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        status: "pending",
        currentRole: "executor",
        currentCycle: 1,
        planMarkdown,
        planRisks,
        planOpenQuestions,
        pendingQuestion: null,
        latestHumanResponse: null,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId))
      .returning(),
  );
  await appendRunEvent(runId, "run.plan_approved", { proposalIndex: proposalIndex ?? "default" });
  await appendSystemRunLog(runId, `plan approved (${proposalIndex !== undefined ? run.planProposals?.[proposalIndex]?.approach ?? "selected" : "default"}); queued for execution`);
  return updated;
}

export async function respondToRun(runId: string, message: string) {
  const run = await getRunById(runId);
  if (run.status !== "needs_human_input" && run.status !== "awaiting_plan_approval") {
    throw new ExternalServiceError(`Run ${runId} is not waiting for human input`);
  }
  const [updated] = await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        status: "pending",
        pendingQuestion: null,
        latestHumanResponse: message,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId))
      .returning(),
  );
  await appendRunEvent(runId, "run.human_response_received", {
    currentRole: run.currentRole,
  });
  await appendRunMessage(runId, "user", "human_response", message);
  await appendSystemRunLog(runId, `human response received for ${run.currentRole ?? "workflow"}`);
  return updated;
}

export async function forceApprove(runId: string) {
  const run = await getRunById(runId);
  if (run.status !== "needs_human_input") {
    throw new ExternalServiceError(`Run ${runId} is not in needs_human_input state`);
  }
  // Refuse force-approval when there is nothing to publish — protects against
  // accidentally pushing an empty branch (e.g. after planner-stage human input).
  const diff = (run.diffExcerpt ?? "").trim();
  if (!diff) {
    throw new ExternalServiceError(
      `Cannot force-approve run ${runId}: no diff captured (worktree empty or executor never ran)`,
    );
  }
  const [updated] = await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        status: "awaiting_publish_approval",
        currentRole: "reviewer",
        pendingQuestion: null,
        worktreeRetained: true,
        latestReviewSummary: "Force-approved by human — review skipped.",
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId))
      .returning(),
  );
  await appendRunEvent(runId, "run.force_approved");
  await appendSystemRunLog(runId, "force-approved by human; skipping reviewer, waiting for publish approval");
  return updated;
}

export async function approvePublish(runId: string) {
  const run = await getRunById(runId);
  if (run.status !== "awaiting_publish_approval") {
    throw new ExternalServiceError(`Run ${runId} is not awaiting publish approval`);
  }
  const [updated] = await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        status: "publish_approved",
        currentRole: "reviewer",
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId))
      .returning(),
  );
  await appendRunEvent(runId, "run.publish_approved");
  await appendSystemRunLog(runId, "publish approved; queued for publication");
  return updated;
}

export async function rejectPublish(runId: string) {
  const run = await getRunById(runId);
  if (run.status !== "awaiting_publish_approval") {
    throw new ExternalServiceError(`Run ${runId} is not awaiting publish approval`);
  }
  const [updated] = await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        status: "publish_rejected",
        worktreeRetained: true,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId))
      .returning(),
  );
  await appendRunEvent(runId, "run.publish_rejected");
  await appendSystemRunLog(runId, "publish rejected; retaining worktree for inspection");
  return updated;
}

export async function archiveRun(runId: string) {
  const run = await getRunById(runId);
  const terminalStatuses = ["success", "pushed", "failed", "cancelled", "publish_rejected"];
  if (!terminalStatuses.includes(run.status)) {
    throw new ExternalServiceError(`Run ${runId} is not in a terminal state (current: ${run.status})`);
  }
  const [updated] = await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        archivedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId))
      .returning(),
  );
  await appendRunEvent(runId, "run.archived");
  await appendSystemRunLog(runId, "run archived from dashboard");
  return updated;
}

export async function createMergeRequestForRun(runId: string) {
  const run = await getRunById(runId);
  if (run.status !== "pushed") {
    throw new ExternalServiceError(`Run ${runId} is not in pushed state`);
  }
  if (!run.repositoryId || !run.branchName) {
    throw new ExternalServiceError(`Run ${runId} is missing repository or branch information`);
  }

  const repository = await getRepositoryById(run.repositoryId);

  const issue: JiraIssue = {
    key: run.ticketKey,
    title: run.ticketTitle,
    description: "",
    status: null,
    issueType: null,
    labels: [],
    assignee: null,
    projectKey: run.ticketProjectKey ?? null,
    raw: {},
  };

  const description = run.summary ?? run.latestReviewSummary ?? "Automated change ready for review.";
  let mrUrl: string;
  let eventName: string;

  if (repository.gitProvider === "github") {
    const github = new GitHubClient();
    if (!github.configured) {
      throw new ExternalServiceError("GitHub client is not configured (USER_GITHUB_TOKEN)");
    }
    mrUrl = await github.createPullRequest(repository, run.branchName, issue, description);
    eventName = "github.pull_request_created";
  } else {
    const gitlab = new GitLabClient();
    if (!gitlab.configured) {
      throw new ExternalServiceError("GitLab client is not configured");
    }
    mrUrl = await gitlab.createMergeRequest(repository, run.branchName, issue, description);
    eventName = "gitlab.merge_request_created";
  }

  const [updated] = await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        status: "success",
        mrUrl,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId))
      .returning(),
  );

  await appendRunEvent(runId, eventName, {
    mrUrl,
    branchName: run.branchName,
  });

  const jira = new JiraClient();
  await jira.commentIssue(issue.key, `PR/MR created: ${mrUrl}`).catch(() => undefined);

  await appendSystemRunLog(runId, `pull/merge request created ${mrUrl}`);
  return updated;
}
