import { eq } from "drizzle-orm";

import { getConfig } from "../../config";
import { db, withSqliteWriteRetry } from "../../db/client";
import { runs, type RepositoryRow } from "../../db/schema";
import { ExternalServiceError } from "../errors";
import { normalizeIssue } from "../jira";
import { resolveExecutionProfile } from "../profiles";
import type { JiraIssue } from "../types";
import { makeId } from "../utils";
import { buildRunArtifactsPath } from "./internal-utils";
import { getRepositoryById } from "./repositories";
import { getRunById } from "./run-queries";
import { appendRunEvent, appendSystemRunLog } from "./run-writer";

export async function createRun(input: {
  issue: JiraIssue;
  source: string;
  repository: RepositoryRow | null;
  manualOverride?: Record<string, unknown>;
}) {
  const config = await getConfig();
  const runId = makeId();
  const plannerProfile = resolveExecutionProfile(config, "planner");
  const executorProfile = resolveExecutionProfile(config, "executor");
  const reviewerProfile = resolveExecutionProfile(config, "reviewer");
  const [run] = await withSqliteWriteRetry(() => db
    .insert(runs)
    .values({
      id: runId,
      source: input.source,
      status: "pending",
      ticketKey: input.issue.key,
      ticketTitle: input.issue.title,
      ticketProjectKey: input.issue.projectKey,
      ticketPayload: input.issue.raw,
      repoName: input.repository?.name ?? null,
      repositoryId: input.repository?.id ?? null,
      workflowMode: config.workflow.mode,
      plannerProfile: plannerProfile.name,
      executorProfile: executorProfile.name,
      reviewerProfile: reviewerProfile.name,
      plannerDriver: plannerProfile.driver,
      executorDriver: executorProfile.driver,
      reviewerDriver: reviewerProfile.driver,
      modelName: executorProfile.model,
      currentRole: "planner",
      currentCycle: 0,
      planRisks: [],
      planOpenQuestions: [],
      latestFindings: [],
      artifactsPath: buildRunArtifactsPath(config.runtime.logs_dir, runId),
      commandHistory: [],
      worktreeRetained: false,
      manualOverride: input.manualOverride ?? {},
    })
    .returning());
  await appendRunEvent(run.id, "run.created", {
    source: input.source,
    ticketKey: input.issue.key,
    repositoryName: input.repository?.name ?? null,
    plannerProfile: plannerProfile.name,
    executorProfile: executorProfile.name,
    reviewerProfile: reviewerProfile.name,
  });
  await appendSystemRunLog(run.id, `run created from ${input.source} for ${input.issue.key}`);
  return run;
}

export async function retryRun(runId: string) {
  const original = await getRunById(runId);
  const retriedRun = await createRun({
    issue: normalizeIssue(original.ticketPayload),
    source: `${original.source}:retry`,
    repository: original.repositoryId ? await getRepositoryById(original.repositoryId) : null,
    manualOverride: original.manualOverride,
  });
  await appendRunEvent(retriedRun.id, "run.retry_requested", {
    originalRunId: runId,
  });
  return retriedRun;
}

export async function retryFromExecutor(runId: string) {
  const run = await getRunById(runId);
  if (run.status !== "failed") {
    throw new ExternalServiceError(`Run ${runId} is not in failed state`);
  }
  if (!run.planMarkdown) {
    throw new ExternalServiceError(`Run ${runId} has no plan to re-execute from`);
  }
  const [updated] = await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        status: "pending",
        currentRole: "executor",
        failureReason: null,
        finishedAt: null,
        startedAt: new Date(),
        latestReviewSummary: null,
        cancelRequested: false,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId))
      .returning(),
  );
  await appendRunEvent(runId, "run.retry_from_executor");
  await appendSystemRunLog(runId, "retrying from executor (keeping existing plan)");
  return updated;
}

