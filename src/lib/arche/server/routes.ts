import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { archePackageRootDir } from "../../cli-helpers";
import { ensureArcheReady } from "../../bootstrap";
import { getConfig, saveConfig } from "../../config";
import { db } from "../../db/client";
import { workers } from "../../db/schema";
import {
  configUpdateSchema,
  jiraWebhookSchema,
  manualRunRequestSchema,
  repoRuleCreateSchema,
  repoRuleUpdateSchema,
  repositoryCreateSchema,
  repositoryUpdateSchema,
  runHumanResponseSchema,
} from "../contracts";
import { stopWorker, restartWorker, purgeOfflineWorkers } from "../workers";
import { dashboardEvents } from "../dashboard/events";
import { getDashboardSnapshot, getDashboardListSnapshot, getRunDetailSnapshot, getRunTimeline } from "../dashboard/snapshot";
import { createLogger } from "../logging";
import {
  approvePlan,
  approvePublish,
  archiveRun,
  cancelRun,
  forceApprove,
  createManualRunForTicket,
  createRepoRule,
  createRepository,
  deleteRepoRule,
  deleteRepository,
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
  getRunsByTicketKey,
  createMergeRequestForRun,
  rejectPublish,
  respondToRun,
  retryRun,
  retryFromExecutor,
  updateRepoRule,
  updateRepository,
} from "../runs";
import type { PaginationQuery } from "./request-context";
import { parsePaginationQuery, readHeaderValue } from "./request-context";

const logger = createLogger({ service: "server" });

let dashboardHtmlCache: string | null = null;

function loadDashboardHtml(): string {
  if (dashboardHtmlCache) return dashboardHtmlCache;
  const root = archePackageRootDir();
  const indexPath = join(root, "dist", "web", "index.html");
  if (existsSync(indexPath)) {
    dashboardHtmlCache = readFileSync(indexPath, "utf8");
    return dashboardHtmlCache;
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

  // Lightweight run detail endpoint (no system probes)
  app.get<{ Params: { runId: string } }>(
    "/v1/dashboard/run-detail/:runId",
    async (request, reply) => {
      await ensureArcheReady();
      const detail = await getRunDetailSnapshot(request.params.runId);
      if (!detail) {
        reply.code(404);
        return { error: "Run not found" };
      }
      return detail;
    },
  );

  // === Dashboard SSE ===
  app.get("/v1/dashboard/sse", async (request, reply) => {
    await ensureArcheReady();

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Use light snapshot (lists + metadata only, no run details) for smaller payload
    const initial = await getDashboardListSnapshot();
    const initialJson = JSON.stringify(initial);
    reply.raw.write(`data: ${initialJson}\n\n`);
    let lastJson = initialJson;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const sendIfChanged = async () => {
      try {
        const snap = await getDashboardListSnapshot();
        const json = JSON.stringify(snap);
        if (json !== lastJson) {
          lastJson = json;
          reply.raw.write(`data: ${json}\n\n`);
        }
      } catch {
        // Client disconnected or error — listener will be cleaned up
      }
    };

    const onChange = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(sendIfChanged, 300);
    };

    dashboardEvents.on("changed", onChange);

    // Poll DB every 5s to catch cross-process changes (workers run in separate processes)
    const pollTimer = setInterval(sendIfChanged, 5_000);

    request.raw.on("close", () => {
      dashboardEvents.off("changed", onChange);
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(pollTimer);
    });

    await reply.hijack();
  });

  // === Live Logs SSE ===
  app.get<{ Params: { id: string } }>("/v1/runs/:id/logs/stream", async (request, reply) => {
    await ensureArcheReady();
    const runId = request.params.id;

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    let lastId = 0;
    let closed = false;

    const sendLogs = async () => {
      try {
        const page = await listRunLogsPage(runId, { afterId: lastId || undefined, limit: 200 });
        for (const log of page.items) {
          if (closed) return;
          reply.raw.write(`data: ${JSON.stringify(log)}\n\n`);
          if (typeof log.id === "number" && log.id > lastId) lastId = log.id;
        }
      } catch {
        // run not found or client disconnected
      }
    };

    await sendLogs();

    const pollTimer = setInterval(sendLogs, 2_000);

    request.raw.on("close", () => {
      closed = true;
      clearInterval(pollTimer);
    });

    await reply.hijack();
  });

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

  app.get<{ Params: { id: string }; Querystring: { offset?: string; limit?: string } }>(
    "/v1/runs/:id/timeline",
    async (request) => {
      await ensureArcheReady();
      const offset = request.query.offset ? Number(request.query.offset) : undefined;
      const limit = request.query.limit ? Number(request.query.limit) : undefined;
      return getRunTimeline(request.params.id, {
        offset: Number.isFinite(offset) ? offset : undefined,
        limit: Number.isFinite(limit) ? limit : undefined,
      });
    },
  );

  app.post<{ Params: { id: string } }>("/v1/runs/:id/retry", async (request) => {
    await ensureArcheReady();
    return retryRun(request.params.id);
  });

  app.post<{ Params: { id: string } }>("/v1/runs/:id/retry-executor", async (request) => {
    await ensureArcheReady();
    return retryFromExecutor(request.params.id);
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
    "/v1/runs/:id/force-approve",
    async (request) => {
      await ensureArcheReady();
      return forceApprove(request.params.id);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/v1/runs/:id/reject-publish",
    async (request) => {
      await ensureArcheReady();
      return rejectPublish(request.params.id);
    },
  );

  app.post<{ Params: { id: string } }>("/v1/runs/:id/archive", async (request) => {
    await ensureArcheReady();
    return archiveRun(request.params.id);
  });

  app.post<{ Params: { id: string } }>("/v1/runs/:id/create-mr", async (request) => {
    await ensureArcheReady();
    return createMergeRequestForRun(request.params.id);
  });

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

  // === Tickets ===
  app.get<{ Params: { key: string } }>("/v1/tickets/:key/runs", async (request) => {
    await ensureArcheReady();
    return getRunsByTicketKey(request.params.key);
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

  app.put<{ Params: { id: string } }>("/v1/repositories/:id", async (request) => {
    await ensureArcheReady();
    const body = repositoryUpdateSchema.parse(request.body ?? {});
    return updateRepository(request.params.id, body);
  });

  app.delete<{ Params: { id: string } }>("/v1/repositories/:id", async (request) => {
    await ensureArcheReady();
    return deleteRepository(request.params.id);
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

  app.put<{ Params: { id: string } }>("/v1/repo-rules/:id", async (request) => {
    await ensureArcheReady();
    const body = repoRuleUpdateSchema.parse(request.body ?? {});
    return updateRepoRule(request.params.id, body);
  });

  app.delete<{ Params: { id: string } }>("/v1/repo-rules/:id", async (request) => {
    await ensureArcheReady();
    return deleteRepoRule(request.params.id);
  });

  // === Profiles ===
  app.get("/v1/profiles", async () => {
    await ensureArcheReady();
    return listExecutionProfiles();
  });

  // === Config ===
  app.get("/v1/config", async () => {
    await ensureArcheReady();
    const config = await getConfig();
    const { runtime: _runtime, bootstrap: _bootstrap, defaults, ...rest } = config;
    return { ...rest, defaults };
  });

  app.put("/v1/config", async (request) => {
    await ensureArcheReady();
    const body = configUpdateSchema.parse(request.body ?? {});
    const updated = await saveConfig(body);
    const { runtime: _runtime, bootstrap: _bootstrap, defaults, ...rest } = updated;
    return { ...rest, defaults };
  });

  // === Workers ===
  app.post("/v1/workers/purge-offline", async () => {
    await ensureArcheReady();
    return purgeOfflineWorkers();
  });

  app.post<{ Params: { workerId: string } }>(
    "/v1/workers/:workerId/stop",
    async (request) => {
      await ensureArcheReady();
      return stopWorker(request.params.workerId);
    },
  );

  app.post<{ Params: { workerId: string } }>(
    "/v1/workers/:workerId/restart",
    async (request) => {
      await ensureArcheReady();
      return restartWorker(request.params.workerId);
    },
  );

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
