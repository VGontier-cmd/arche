import { and, desc, eq } from "drizzle-orm";

import { db, withSqliteWriteRetry } from "../../db/client";
import { runTasks, type RunTaskRow } from "../../db/schema";
import { ExternalServiceError } from "../errors";
import { plannerRoleOutputSchema } from "../role-schemas";
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
      })
      .where(eq(runTasks.id, taskId))
      .returning(),
  );
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

export function ensurePlannerOutput(task: RunTaskRow | null) {
  if (!task?.outputJson) {
    throw new ExternalServiceError("Approved plan is missing");
  }
  return plannerRoleOutputSchema.parse(task.outputJson);
}
