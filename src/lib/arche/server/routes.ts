import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";

import {
  jiraWebhookSchema,
  manualRunRequestSchema,
  repoRuleCreateSchema,
  repositoryCreateSchema,
  runHumanResponseSchema,
} from "../contracts";
import { ensureArcheReady } from "../../bootstrap";
import { db } from "../../db/client";
import {
  cancelRun,
  createManualRunForTicket,
  createRepoRule,
  createRepository,
  approvePlan,
  approvePublish,
  getRunDetail,
  handleJiraWebhook,
  listRepoRules,
  listRepositories,
  listRunCommands,
  listRunEvents,
  listRunLogs,
  listRunLogsPage,
  listExecutionProfiles,
  listRuns,
  rejectPublish,
  respondToRun,
  retryRun,
} from "../runs";
import type { PaginationQuery } from "./request-context";
import { parsePaginationQuery, readHeaderValue } from "./request-context";

export function registerServerRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/ready", async () => {
    await ensureArcheReady();
    await db.get(sql`select 1 as value`);
    return { status: "ready" };
  });

  app.get("/runs", async () => {
    await ensureArcheReady();
    return listRuns();
  });

  app.get<{ Params: { id: string } }>("/runs/:id", async (request) => {
    await ensureArcheReady();
    return getRunDetail(request.params.id);
  });

  app.get<{ Params: { id: string }; Querystring: PaginationQuery }>(
    "/runs/:id/logs",
    async (request) => {
      await ensureArcheReady();
      const pagination = parsePaginationQuery(request.query);
      if (pagination.afterId || pagination.limit) {
        return listRunLogsPage(request.params.id, pagination);
      }
      return listRunLogs(request.params.id);
    },
  );

  app.get<{ Params: { id: string }; Querystring: PaginationQuery }>(
    "/runs/:id/events",
    async (request) => {
      await ensureArcheReady();
      return listRunEvents(request.params.id, parsePaginationQuery(request.query));
    },
  );

  app.get<{ Params: { id: string }; Querystring: PaginationQuery }>(
    "/runs/:id/commands",
    async (request) => {
      await ensureArcheReady();
      return listRunCommands(request.params.id, parsePaginationQuery(request.query));
    },
  );

  app.post<{ Params: { id: string } }>("/runs/:id/retry", async (request) => {
    await ensureArcheReady();
    return retryRun(request.params.id);
  });

  app.post<{ Params: { id: string } }>("/runs/:id/cancel", async (request) => {
    await ensureArcheReady();
    return cancelRun(request.params.id);
  });

  app.post<{ Params: { id: string } }>("/runs/:id/approve-plan", async (request) => {
    await ensureArcheReady();
    return approvePlan(request.params.id);
  });

  app.post<{ Params: { id: string } }>("/runs/:id/approve-publish", async (request) => {
    await ensureArcheReady();
    return approvePublish(request.params.id);
  });

  app.post<{ Params: { id: string } }>("/runs/:id/reject-publish", async (request) => {
    await ensureArcheReady();
    return rejectPublish(request.params.id);
  });

  app.post<{ Params: { id: string } }>("/runs/:id/respond", async (request) => {
    await ensureArcheReady();
    const body = runHumanResponseSchema.parse(request.body ?? {});
    return respondToRun(request.params.id, body.message);
  });

  app.post("/runs/manual", async (request, reply) => {
    await ensureArcheReady();
    const body = manualRunRequestSchema.parse(request.body ?? {});
    const run = await createManualRunForTicket({
      ticketKey: body.ticketKey,
      force: body.force,
    });
    reply.status(201);
    return run;
  });

  app.get("/repo-rules", async () => {
    await ensureArcheReady();
    return listRepoRules();
  });

  app.post("/repo-rules", async (request, reply) => {
    await ensureArcheReady();
    const body = repoRuleCreateSchema.parse(request.body ?? {});
    const rule = await createRepoRule({
      name: body.name,
      repositoryId: body.repositoryId,
      repositoryName: body.repositoryName,
      jiraProjectKey: body.jiraProjectKey ?? null,
      label: body.label ?? null,
      issueType: body.issueType ?? null,
      priority: body.priority,
      enabled: body.enabled,
    });
    reply.status(201);
    return rule;
  });

  app.get("/repositories", async () => {
    await ensureArcheReady();
    return listRepositories();
  });

  app.post("/repositories", async (request, reply) => {
    await ensureArcheReady();
    const body = repositoryCreateSchema.parse(request.body ?? {});
    const repository = await createRepository({
      name: body.name,
      gitProvider: body.gitProvider,
      remoteUrl: body.remoteUrl,
      localMirrorPath: body.localMirrorPath,
      defaultBranch: body.defaultBranch,
      enabled: body.enabled,
      gitlabProjectId: body.gitlabProjectId ?? null,
      allowedCommands: body.allowedCommands,
      validationCommands: body.validationCommands,
    });
    reply.status(201);
    return repository;
  });

  app.get("/profiles", async () => {
    await ensureArcheReady();
    return listExecutionProfiles();
  });

  app.post("/webhooks/jira", async (request, reply) => {
    await ensureArcheReady();
    const payload = jiraWebhookSchema.parse(request.body ?? {});
    const result = await handleJiraWebhook({
      payload: payload as Record<string, unknown>,
      secret:
        readHeaderValue(request.headers["x-arche-webhook-secret"]) ??
        readHeaderValue(request.headers["x-webhook-secret"]),
    });
    reply.status(result.accepted ? 200 : 400);
    return result;
  });
}
