import { eq } from "drizzle-orm";

import { db, withSqliteWriteRetry } from "../../db/client";
import { runs } from "../../db/schema";
import { ExternalServiceError } from "../errors";
import { appendRunEvent, appendRunMessage, appendSystemRunLog, transitionRun } from "./run-writer";
import { getRunById } from "./run-queries";
import { ensurePlannerOutput, getLatestTaskForRole } from "./run-tasks";

export async function cancelRun(runId: string) {
  const run = await getRunById(runId);
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

export async function approvePlan(runId: string) {
  const run = await getRunById(runId);
  if (run.status !== "awaiting_plan_approval") {
    throw new ExternalServiceError(`Run ${runId} is not awaiting plan approval`);
  }
  const latestPlannerTask = await getLatestTaskForRole(runId, "planner");
  const plannerOutput = ensurePlannerOutput(latestPlannerTask);
  const [updated] = await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        status: "pending",
        currentRole: "executor",
        currentCycle: 1,
        planMarkdown: plannerOutput.planMarkdown,
        planRisks: plannerOutput.risks,
        planOpenQuestions: plannerOutput.openQuestions,
        pendingQuestion: null,
        latestHumanResponse: null,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId))
      .returning(),
  );
  await appendRunEvent(runId, "run.plan_approved");
  await appendSystemRunLog(runId, "plan approved; queued for execution");
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
