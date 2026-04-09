import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { getConfig } from "./config";
import { db, withSqliteWriteRetry } from "./db/client";
import { initSchema } from "./db/init";
import { repoRules, repositories } from "./db/schema";

let bootstrapPromise: Promise<void> | undefined;

async function ensureRuntimeDirectories() {
  const config = await getConfig();
  await Promise.all([
    mkdir(config.runtime.root_dir, { recursive: true }),
    mkdir(config.runtime.repos_dir, { recursive: true }),
    mkdir(config.runtime.runs_dir, { recursive: true }),
    mkdir(config.runtime.logs_dir, { recursive: true }),
  ]);
}

async function bootstrapEntities() {
  const config = await getConfig();

  for (const repository of config.bootstrap.repositories) {
    const [existing] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.name, String(repository.name)))
      .limit(1);
    if (existing) continue;
    await withSqliteWriteRetry(() => db.insert(repositories).values({
      id: randomUUID(),
      name: String(repository.name),
      gitProvider: String(repository.gitProvider ?? "gitlab"),
      remoteUrl: String(repository.remoteUrl),
      localMirrorPath: String(repository.localMirrorPath),
      defaultBranch: String(repository.defaultBranch ?? "main"),
      enabled: repository.enabled !== false,
      gitlabProjectId:
        repository.gitlabProjectId === undefined ? null : String(repository.gitlabProjectId),
      allowedCommands: Array.isArray(repository.allowedCommands)
        ? repository.allowedCommands.map(String)
        : [],
      validationCommands: Array.isArray(repository.validationCommands)
        ? repository.validationCommands.map(String)
        : [],
    }));
  }

  const allRepositories = await db.select().from(repositories);
  const repositoryByName = new Map(allRepositories.map((repository) => [repository.name, repository]));

  for (const rule of config.bootstrap.repo_rules) {
    const [existing] = await db
      .select()
      .from(repoRules)
      .where(eq(repoRules.name, String(rule.name)))
      .limit(1);
    if (existing) continue;
    const repository = repositoryByName.get(String(rule.repository_name));
    if (!repository) continue;
    await withSqliteWriteRetry(() => db.insert(repoRules).values({
      id: randomUUID(),
      name: String(rule.name),
      jiraProjectKey:
        rule.jira_project_key === undefined ? null : String(rule.jira_project_key),
      label: rule.label === undefined ? null : String(rule.label),
      issueType: rule.issue_type === undefined ? null : String(rule.issue_type),
      priority: Number(rule.priority ?? 100),
      enabled: rule.enabled !== false,
      repositoryId: repository.id,
    }));
  }
}

export async function ensureArcheReady() {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      await initSchema();
      await ensureRuntimeDirectories();
      await bootstrapEntities();
    })();
  }
  await bootstrapPromise;
}
