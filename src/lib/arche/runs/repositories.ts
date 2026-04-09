import { asc, eq, or } from "drizzle-orm";

import { db, withSqliteWriteRetry } from "../../db/client";
import { repoRules, repositories, type RepositoryRow } from "../../db/schema";
import { ExternalServiceError, NotFoundError } from "../errors";
import { makeId } from "../utils";
import { presentRepoRule } from "./presenters";

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
