import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { asc, eq, or } from "drizzle-orm";

import { db, withSqliteWriteRetry } from "../../db/client";
import { repoRules, repositories, type RepositoryRow } from "../../db/schema";
import type { RepositoryUpdateInput, RepoRuleUpdateInput } from "../contracts";
import { ExternalServiceError, NotFoundError } from "../errors";
import { makeId } from "../utils";
import { presentRepoRule } from "./presenters";

/**
 * Resolves the effective agent instructions for a run:
 * 1. Reads .arche/instructions.md from the worktree (file in repo takes precedence).
 * 2. Falls back to the repository.instructions DB field.
 * Returns null if neither is present.
 */
/**
 * Resolves the list of extra tools enabled for a run.
 * Reads .arche/tools.json from the worktree first, falls back to repository.enabledTools in DB.
 */
export async function resolveRepoExtraTools(
  repository: RepositoryRow,
  worktreePath: string,
): Promise<string[]> {
  const filePath = join(worktreePath, ".arche", "tools.json");
  try {
    const raw = await readFile(filePath, "utf8");
    const content = JSON.parse(raw) as { extra_tools?: unknown };
    if (Array.isArray(content.extra_tools)) {
      return content.extra_tools.filter((t): t is string => typeof t === "string");
    }
  } catch {
    // File absent or invalid — fall through
  }
  return repository.enabledTools ?? [];
}

export async function resolveRepoInstructions(
  repository: RepositoryRow,
  worktreePath: string,
): Promise<string | null> {
  const filePath = join(worktreePath, ".arche", "instructions.md");
  try {
    const content = await readFile(filePath, "utf8");
    if (content.trim()) return content.trim();
  } catch {
    // File does not exist — fall through to DB value
  }
  return repository.instructions ?? null;
}

export async function listRepositories() {
  return db.select().from(repositories).orderBy(asc(repositories.createdAt));
}

export async function createRepository(data: Omit<RepositoryRow, "id" | "createdAt" | "updatedAt">) {
  const record = {
    id: makeId(),
    ...data,
  };
  const [repository] = await withSqliteWriteRetry(() =>
    db.insert(repositories).values(record).returning(),
  );
  return repository;
}

export async function listRepoRules() {
  const rows = await db
    .select({
      rule: repoRules,
      repositoryName: repositories.name,
    })
    .from(repoRules)
    .innerJoin(repositories, eq(repoRules.repositoryId, repositories.id))
    .orderBy(asc(repoRules.priority), asc(repoRules.createdAt));

  return rows.map(({ rule, repositoryName }) => presentRepoRule(rule, { repositoryName }));
}

export async function createRepoRule(data: {
  name: string;
  repositoryId?: string;
  repositoryName?: string;
  jiraProjectKey?: string | null;
  label?: string | null;
  issueType?: string | null;
  priority: number;
  enabled: boolean;
}) {
  const repositoryIdentifier = data.repositoryId ?? data.repositoryName;
  if (!repositoryIdentifier) {
    throw new ExternalServiceError("repositoryId or repositoryName is required");
  }

  const repository = await getRepositoryByNameOrId(repositoryIdentifier);
  const [rule] = await withSqliteWriteRetry(() => db
    .insert(repoRules)
    .values({
      id: makeId(),
      name: data.name,
      repositoryId: repository.id,
      jiraProjectKey: data.jiraProjectKey ?? null,
      label: data.label ?? null,
      issueType: data.issueType ?? null,
      priority: data.priority,
      enabled: data.enabled,
    })
    .returning());

  return presentRepoRule(rule, { repositoryName: repository.name });
}

export async function updateRepository(id: string, data: RepositoryUpdateInput) {
  const [updated] = await withSqliteWriteRetry(() =>
    db.update(repositories).set({ ...data, updatedAt: new Date() }).where(eq(repositories.id, id)).returning(),
  );
  if (!updated) throw new NotFoundError(`Repository ${id} not found`);
  return updated;
}

export async function deleteRepository(id: string) {
  const [deleted] = await withSqliteWriteRetry(() =>
    db.delete(repositories).where(eq(repositories.id, id)).returning(),
  );
  if (!deleted) throw new NotFoundError(`Repository ${id} not found`);
  return { deleted: true };
}

export async function updateRepoRule(id: string, data: RepoRuleUpdateInput) {
  // Resolve repository if repositoryName is provided
  let repositoryId = data.repositoryId;
  if (!repositoryId && data.repositoryName) {
    const repo = await getRepositoryByNameOrId(data.repositoryName);
    repositoryId = repo.id;
  }

  const { repositoryName: _, ...rest } = data;
  const updates: Record<string, unknown> = { ...rest, updatedAt: new Date() };
  if (repositoryId) updates.repositoryId = repositoryId;

  const [updated] = await withSqliteWriteRetry(() =>
    db.update(repoRules).set(updates).where(eq(repoRules.id, id)).returning(),
  );
  if (!updated) throw new NotFoundError(`Repo rule ${id} not found`);

  // Re-fetch with repository name for presentation
  const repo = await getRepositoryById(updated.repositoryId);
  return presentRepoRule(updated, { repositoryName: repo.name });
}

export async function deleteRepoRule(id: string) {
  const [deleted] = await withSqliteWriteRetry(() =>
    db.delete(repoRules).where(eq(repoRules.id, id)).returning(),
  );
  if (!deleted) throw new NotFoundError(`Repo rule ${id} not found`);
  return { deleted: true };
}

export async function getRepositoryById(repositoryId: string) {
  const [repository] = await db.select().from(repositories).where(eq(repositories.id, repositoryId)).limit(1);
  if (!repository) throw new NotFoundError(`Repository ${repositoryId} not found`);
  return repository;
}

export async function getRepositoryByNameOrId(identifier: string) {
  const [repository] = await db
    .select()
    .from(repositories)
    .where(or(eq(repositories.id, identifier), eq(repositories.name, identifier)))
    .limit(1);
  if (!repository) {
    throw new NotFoundError(`Repository ${identifier} not found`);
  }
  return repository;
}
