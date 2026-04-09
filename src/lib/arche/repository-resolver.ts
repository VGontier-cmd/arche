import { asc, eq } from "drizzle-orm";

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

  throw new NotFoundError(`No repository rule matched issue ${issue.key}`);
}
