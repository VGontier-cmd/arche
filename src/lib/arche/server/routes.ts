import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { archePackageRootDir } from "../../cli-helpers";
import { ensureArcheReady } from "../../bootstrap";
import { db } from "../../db/client";
import { workers } from "../../db/schema";
import {
  jiraWebhookSchema,
  manualRunRequestSchema,
  repoRuleCreateSchema,
  repositoryCreateSchema,
  runHumanResponseSchema,
} from "../contracts";
import { getDashboardSnapshot } from "../dashboard/snapshot";
import { createLogger } from "../logging";
import {
  approvePlan,
  approvePublish,
  cancelRun,
  createManualRunForTicket,
  createRepoRule,
  createRepository,
  getRunDetail,
  handleJiraWebhook,
  listExecutionProfiles,
  listRepoRules,
  listRepositories,
  listRunCommands,
  listRunEvents,
  listRunLogs,
  listRunLogsPage,
  listRuns,
  rejectPublish,
  respondToRun,
  retryRun,
} from "../runs";
import type { PaginationQuery } from "./request-context";
import { parsePaginationQuery, readHeaderValue } from "./request-context";

const logger = createLogger({ service: "server" });

let dashboardHtmlCache: string | null = null;

function loadDashboardHtml(): string {
  if (dashboardHtmlCache) return dashboardHtmlCache;
  const root = archePackageRootDir();
  const candidates = [
    join(root, "dist", "web", "index.html"),
    join(root, "src", "lib", "arche", "server", "web", "index.html"),
  ];
  for (const path of candidates) {
    try {
      dashboardHtmlCache = readFileSync(path, "utf8");
      return dashboardHtmlCache;
    } catch { /* try next */ }
  }
  dashboardHtmlCache = "<html><body><h1>Dashboard HTML not found. Run: npm run build</h1></body></html>";
  return dashboardHtmlCache;
}

export function registerServerRoutes(app: FastifyInstance) {
  // === Health & Readiness ===
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/v1/health", async (_request, reply) => {
    const workerRows = await db.select().from(workers);
    const offlineThresholdMs = 15_000;
    const now = Date.now();
    const onlineWorkers = workerRows.filter((w) => {
      const hb = w.lastHeartbeatAt instanceof Date ? w.lastHeartbeatAt.getTime() : 0;
      return now - hb < offlineThresholdMs;
    });

    let dbOk = false;
    try {
      await db.get(sql`select 1 as value`);
      dbOk = true;
    } catch { /* db unreachable */ }

    let diskFreeBytes: number | null = null;
    try {
      const fsp = await import("node:fs/promises");
      if ("statfs" in fsp) {
        const stats = await (fsp as { statfs: (path: string) => Promise<{ bfree: bigint; bsize: bigint }> }).statfs(".");
        diskFreeBytes = Number(stats.bfree) * Number(stats.bsize);
      }
    } catch { /* not available */ }

    reply.send({
      status: "ok",
      components: {
        database: { status: dbOk ? "ok" : "degraded" },
        workers: {
          status: onlineWorkers.length > 0 ? "ok" : "degraded",
          total: workerRows.length,
          online: onlineWorkers.length,
        },
        ...(diskFreeBytes !== null ? { disk: { freeBytes: diskFreeBytes } } : {}),
      },
    });
  });

  app.get("/ready", async () => {
    await ensureArcheReady();
    await db.get(sql`select 1 as value`);
    return { status: "ready" };
  });

  app.get("/v1/ready", async () => {
    await ensureArcheReady();
    await db.get(sql`select 1 as value`);
    return { status: "ready" };
  });

  // === Dashboard Web ===
  app.get("/dashboard", async (_request, reply) => {
    reply.type("text/html").send(loadDashboardHtml());
  });

  // === Dashboard API ===
  app.get("/v1/dashboard/snapshot", async (request) => {
    await ensureArcheReady();
    const query = request.query as { runId?: string };
    return getDashboardSnapshot({ selectedRunId: query.runId ?? null });
  });

  app.get<{ Params: { runId: string } }>(
    "/v1/dashboard/snapshot/:runId",
    async (request) => {
      await ensureArcheReady();
      return getDashboardSnapshot({ selectedRunId: request.params.runId });
    },
  );

  // === Runs ===
  app.get("/v1/runs", async () => {
    await ensureArcheReady();
    return listRuns();
  });

  app.get<{ Params: { id: string } }>("/v1/runs/:id", async (request) => {
    await ensureArcheReady();
    return getRunDetail(request.params.id);
  });

  app.get<{ Params: { id: string }; Querystring: PaginationQuery }>(
    "/v1/runs/:id/logs",
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
    "/v1/runs/:id/events",
    async (request) => {
      await ensureArcheReady();
      return listRunEvents(
        request.params.id,
        parsePaginationQuery(request.query),
      );
    },
  );

  app.get<{ Params: { id: string }; Querystring: PaginationQuery }>(
    "/v1/runs/:id/commands",
    async (request) => {
      await ensureArcheReady();
      return listRunCommands(
        request.params.id,
        parsePaginationQuery(request.query),
      );
    },
  );

  app.post<{ Params: { id: string } }>("/v1/runs/:id/retry", async (request) => {
    await ensureArcheReady();
    return retryRun(request.params.id);
  });

  app.post<{ Params: { id: string } }>("/v1/runs/:id/cancel", async (request) => {
    await ensureArcheReady();
    return cancelRun(request.params.id);
  });

  app.post<{ Params: { id: string } }>(
    "/v1/runs/:id/approve-plan",
    async (request) => {
      await ensureArcheReady();
      return approvePlan(request.params.id);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/v1/runs/:id/approve-publish",
    async (request) => {
      await ensureArcheReady();
      return approvePublish(request.params.id);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/v1/runs/:id/reject-publish",
    async (request) => {
      await ensureArcheReady();
      return rejectPublish(request.params.id);
    },
  );

  app.post<{ Params: { id: string } }>("/v1/runs/:id/respond", async (request) => {
    await ensureArcheReady();
    const body = runHumanResponseSchema.parse(request.body ?? {});
    return respondToRun(request.params.id, body.message);
  });

  app.post("/v1/runs/manual", async (request, reply) => {
    await ensureArcheReady();
    const body = manualRunRequestSchema.parse(request.body ?? {});
    const run = await createManualRunForTicket({
      ticketKey: body.ticketKey,
      force: body.force,
    });
    reply.status(201);
    return run;
  });

  // === Repositories ===
  app.get("/v1/repositories", async () => {
    await ensureArcheReady();
    return listRepositories();
  });

  app.post("/v1/repositories", async (request, reply) => {
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

  // === Repo Rules ===
  app.get("/v1/repo-rules", async () => {
    await ensureArcheReady();
    return listRepoRules();
  });

  app.post("/v1/repo-rules", async (request, reply) => {
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

  // === Profiles ===
  app.get("/v1/profiles", async () => {
    await ensureArcheReady();
    return listExecutionProfiles();
  });

  // === Webhooks ===
  app.post("/v1/webhooks/jira", async (request, reply) => {
    await ensureArcheReady();

    const webhookSecret = process.env.ARCHE_JIRA_WEBHOOK_SECRET?.trim();
    if (webhookSecret) {
      const signatureHeader = readHeaderValue(
        request.headers["x-hub-signature"] ?? request.headers["x-atlassian-webhook-signature"],
      );
      if (!signatureHeader) {
        logger.warn("api", "jira webhook missing signature header", {
          event: "webhook.jira.missing_signature",
        });
        reply.status(401).send({ error: "Missing webhook signature" });
        return;
      }

      const rawBody = JSON.stringify(request.body);
      const expectedSignature = createHmac("sha256", webhookSecret)
        .update(rawBody)
        .digest("hex");
      const providedSignature = signatureHeader.replace(/^sha256=/, "");

      const expectedBuf = Buffer.from(expectedSignature, "hex");
      const providedBuf = Buffer.from(providedSignature, "hex");

      if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
        logger.warn("api", "jira webhook signature mismatch", {
          event: "webhook.jira.invalid_signature",
        });
        reply.status(401).send({ error: "Invalid webhook signature" });
        return;
      }
    } else {
      logger.debug("api", "jira webhook signature verification skipped (ARCHE_JIRA_WEBHOOK_SECRET not set)", {
        event: "webhook.jira.no_secret",
      });
    }

    const payload = jiraWebhookSchema.parse(request.body ?? {});
    const result = await handleJiraWebhook({
      payload: payload as Record<string, unknown>,
    });
    reply.status(result.accepted ? 200 : 400);
    return result;
  });
}
