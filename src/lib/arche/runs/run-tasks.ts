import { and, desc, eq } from "drizzle-orm";

import { db, withSqliteWriteRetry } from "../../db/client";
import { runTasks, runs, type RunTaskRow } from "../../db/schema";
import { ExternalServiceError } from "../errors";
import { plannerRoleOutputSchema } from "../role-schemas";
import type { ProviderUsage } from "../provider";
import type { RunTaskRole, RunTaskStatus, RunTaskStrategy } from "../types";

export async function createRunTask(input: {
  runId: string;
  role: RunTaskRole;
  cycle: number;
  modelName: string;
  profileName: string;
  strategy: RunTaskStrategy;
  artifactsPath: string;
}) {
  const [task] = await withSqliteWriteRetry(() =>
    db
      .insert(runTasks)
      .values({
        runId: input.runId,
        role: input.role,
        cycle: input.cycle,
        status: "running",
        modelName: input.modelName,
        profileName: input.profileName,
        strategy: input.strategy,
        artifactsPath: input.artifactsPath,
      })
      .returning(),
  );
  return task;
}

export async function completeRunTask(
  taskId: number,
  input: {
    status: Exclude<RunTaskStatus, "running">;
    summary?: string | null;
    outputJson?: Record<string, unknown> | null;
    usage?: ProviderUsage | null;
    estimatedCostUsd?: number | null;
  },
) {
  const [task] = await withSqliteWriteRetry(() =>
    db
      .update(runTasks)
      .set({
        status: input.status,
        summary: input.summary ?? null,
        outputJson: input.outputJson ?? null,
        finishedAt: new Date(),
        ...(input.usage
          ? {
              promptTokens: input.usage.promptTokens,
              completionTokens: input.usage.completionTokens,
            }
          : {}),
        ...(typeof input.estimatedCostUsd === "number"
          ? { estimatedCostUsd: input.estimatedCostUsd.toFixed(6) }
          : {}),
      })
      .where(eq(runTasks.id, taskId))
      .returning(),
  );

  // Keep the parent run's totals fresh so the dashboard sees costs as soon as
  // each phase completes, not only at terminal transitions.
  if (task) {
    await syncRunTotalsFromTasks(task.runId);
  }
  return task;
}

export async function getLatestTaskForRole(runId: string, role: RunTaskRole) {
  const [task] = await db
    .select()
    .from(runTasks)
    .where(and(eq(runTasks.runId, runId), eq(runTasks.role, role)))
    .orderBy(desc(runTasks.startedAt), desc(runTasks.id))
    .limit(1);
  return task ?? null;
}

/**
 * Aggregate token/cost totals across all completed tasks for a run and
 * persist them on the runs row. Idempotent — safe to call multiple times,
 * always reflects the current state of run_tasks.
 */
export async function syncRunTotalsFromTasks(runId: string): Promise<void> {
  const tasks = await db
    .select({
      promptTokens: runTasks.promptTokens,
      completionTokens: runTasks.completionTokens,
      estimatedCostUsd: runTasks.estimatedCostUsd,
    })
    .from(runTasks)
    .where(eq(runTasks.runId, runId));

  let promptTotal = 0;
  let completionTotal = 0;
  let costTotal = 0;
  let hasCost = false;

  for (const task of tasks) {
    promptTotal += task.promptTokens ?? 0;
    completionTotal += task.completionTokens ?? 0;
    if (task.estimatedCostUsd) {
      const parsed = Number(task.estimatedCostUsd);
      if (Number.isFinite(parsed)) {
        costTotal += parsed;
        hasCost = true;
      }
    }
  }

  await withSqliteWriteRetry(() =>
    db
      .update(runs)
      .set({
        promptTokens: promptTotal,
        completionTokens: completionTotal,
        estimatedCostUsd: hasCost ? costTotal.toFixed(6) : null,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, runId)),
  );
}

export function ensurePlannerOutput(task: RunTaskRow | null): import("../types").PlannerRoleOutput {
  if (!task?.outputJson) {
    throw new ExternalServiceError("Approved plan is missing");
  }
  const raw = plannerRoleOutputSchema.parse(task.outputJson);
  const firstProposal = raw.proposals?.[0];
  return {
    proposals: raw.proposals,
    needsHumanInput: raw.needsHumanInput,
    question: raw.question,
    planMarkdown: firstProposal?.planMarkdown,
    risks: firstProposal?.risks ?? [],
    openQuestions: firstProposal?.openQuestions ?? [],
  };
}
