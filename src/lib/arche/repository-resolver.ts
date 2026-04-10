import { asc, eq } from "drizzle-orm";

import { getConfig } from "../config";
import { db } from "../db/client";
import { repoRules, repositories } from "../db/schema";
import { NotFoundError } from "./errors";
import type { JiraIssue } from "./types";

export async function resolveRepositoryForIssue(issue: JiraIssue) {
  const rows = await db
    .select({
      rule: repoRules,
      repository: repositories,
    })
    .from(repoRules)
    .innerJoin(repositories, eq(repoRules.repositoryId, repositories.id))
    .where(eq(repoRules.enabled, true))
    .orderBy(asc(repoRules.priority), asc(repoRules.createdAt));

  for (const row of rows) {
    const { rule, repository } = row;
    if (!repository.enabled) continue;
    if (rule.jiraProjectKey && rule.jiraProjectKey !== issue.projectKey) continue;
    if (rule.label && !issue.labels.includes(rule.label)) continue;
    if (rule.issueType && rule.issueType !== issue.issueType) continue;
    return repository;
  }

  const config = await getConfig();
  const defaultRepositoryName = config.routing.default_repository?.trim();
  if (defaultRepositoryName) {
    const [defaultRepository] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.name, defaultRepositoryName))
      .limit(1);
    if (defaultRepository?.enabled) {
      return defaultRepository;
    }
    throw new NotFoundError(`Configured default repository ${defaultRepositoryName} was not found or is disabled`);
  }

  throw new NotFoundError(`No repository rule matched issue ${issue.key}`);
}
