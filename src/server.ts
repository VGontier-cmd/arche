import { timingSafeEqual } from "node:crypto";

import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { sql } from "drizzle-orm";

import {
  jiraWebhookSchema,
  manualRunRequestSchema,
  repoRuleCreateSchema,
  repositoryCreateSchema,
  runHumanResponseSchema,
} from "./lib/arche/contracts";
import { ExternalServiceError } from "./lib/arche/errors";
import { ensureArcheReady } from "./lib/bootstrap";
import { db, optimizeDatabase } from "./lib/db/client";
import { env } from "./lib/env";
import { routeErrorResponse } from "./lib/arche/http";
import { createLogger } from "./lib/arche/logging";
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
} from "./lib/arche/runs";

const logger = createLogger({ service: "server" });
const PUBLIC_PATHS = new Set(["/health", "/ready", "/webhooks/jira"]);
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;

type PaginationQuery = {
  after_id?: string;
  limit?: string;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

type InstrumentedRequest = FastifyRequest & {
  archeStartedAt?: number;
};

const rateLimitEntries = new Map<string, RateLimitEntry>();

function parsePaginationQuery(query: PaginationQuery) {
  const parsedAfterId = query.after_id ? Number(query.after_id) : undefined;
  const parsedLimit = query.limit ? Number(query.limit) : undefined;
  return {
    afterId: Number.isFinite(parsedAfterId) ? parsedAfterId : undefined,
    limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
  };
}

function readHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

async function sendError(reply: FastifyReply, error: unknown) {
  const response = routeErrorResponse(error);
  const payload = await response.json();
  reply.status(response.status).send(payload);
}

function getRequestPath(request: FastifyRequest) {
  return new URL(request.raw.url ?? "/", "http://127.0.0.1").pathname;
}

function isLoopbackHost(host: string) {
  const normalized = host.trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

function configuredServerAuthToken() {
  const token = env.ARCHE_SERVER_AUTH_TOKEN?.trim();
  return token ? token : null;
}

function readRequestAuthToken(request: FastifyRequest) {
  const apiTokenHeader = readHeaderValue(request.headers["x-arche-api-token"])?.trim();
  if (apiTokenHeader) {
    return apiTokenHeader;
  }

  const authorization = readHeaderValue(request.headers.authorization)?.trim();
  if (!authorization) {
    return null;
  }

  const matched = /^Bearer\s+(.+)$/.exec(authorization);
  return matched?.[1]?.trim() ?? null;
}

function tokensMatch(expected: string, provided: string | null) {
  if (!provided) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function enforceRateLimit(request: FastifyRequest) {
  const now = Date.now();
  for (const [key, entry] of rateLimitEntries) {
    if (entry.resetAt <= now) {
      rateLimitEntries.delete(key);
    }
  }

  const key = request.ip;
  const current = rateLimitEntries.get(key);

  if (!current || current.resetAt <= now) {
    rateLimitEntries.set(key, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return null;
  }

  current.count += 1;
  if (current.count <= RATE_LIMIT_MAX_REQUESTS) {
    return null;
  }

  return Math.max(1, Math.ceil((current.resetAt - now) / 1000));
}

function setRequestStartTime(request: FastifyRequest) {
  (request as InstrumentedRequest).archeStartedAt = Date.now();
}

function getRequestDurationMs(request: FastifyRequest) {
  const startedAt = (request as InstrumentedRequest).archeStartedAt;
  return typeof startedAt === "number" ? Math.max(0, Date.now() - startedAt) : null;
}

function createApp() {
  const app = Fastify({
    logger: false,
  });

  app.addHook("onRequest", async (request, reply) => {
    setRequestStartTime(request);
    reply.header("x-request-id", request.id);

    const path = getRequestPath(request);
    if (PUBLIC_PATHS.has(path)) {
      return;
    }

    const retryAfterSeconds = enforceRateLimit(request);
    if (retryAfterSeconds !== null) {
      logger.warn("api", "request rate limited", {
        requestId: request.id,
        event: "request.rate_limited",
        details: {
          method: request.method,
          path,
          ip: request.ip,
          retryAfterSeconds,
        },
      });
      reply.header("retry-after", String(retryAfterSeconds));
      reply.status(429).send({ error: "Rate limit exceeded" });
      return reply;
    }

    const authToken = configuredServerAuthToken();
    if (!authToken) {
      return;
    }

    if (tokensMatch(authToken, readRequestAuthToken(request))) {
      return;
    }

    logger.warn("api", "request unauthorized", {
      requestId: request.id,
      event: "request.unauthorized",
      details: {
        method: request.method,
        path,
        ip: request.ip,
      },
    });
    reply.header("www-authenticate", 'Bearer realm="arche"');
    reply.status(401).send({ error: "Unauthorized" });
    return reply;
  });

  app.setNotFoundHandler(async (_request, reply) => {
    reply.status(404).send({ error: "Not found" });
  });

  app.setErrorHandler(async (error, request, reply) => {
    logger.error("api", "request failed", {
      requestId: request.id,
      event: "request.failed",
      details: {
        method: request.method,
        path: getRequestPath(request),
        error: error instanceof Error ? error.message : "Unknown error",
      },
    });
    await sendError(reply, error);
  });

  app.addHook("onResponse", async (request, reply) => {
    const path = getRequestPath(request);
    const durationMs = getRequestDurationMs(request);
    const details = {
      method: request.method,
      path,
      statusCode: reply.statusCode,
      durationMs,
      ip: request.ip,
    };

    if (reply.statusCode >= 500) {
      logger.error("api", "request completed with server error", {
        requestId: request.id,
        event: "request.completed",
        details,
      });
      return;
    }

    if (reply.statusCode >= 400) {
      logger.warn("api", "request completed with client error", {
        requestId: request.id,
        event: "request.completed",
        details,
      });
      return;
    }

    if (request.method === "GET" && PUBLIC_PATHS.has(path)) {
      logger.debug("api", "request completed", {
        requestId: request.id,
        event: "request.completed",
        details,
      });
      return;
    }

    logger.info("api", "request completed", {
      requestId: request.id,
      event: "request.completed",
      details,
    });
  });

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

  return app;
}

export async function startServer(
  options: { host?: string; port?: number } = {},
): Promise<FastifyInstance> {
  const host = options.host ?? env.ARCHE_SERVER_HOST;
  const port = options.port ?? 8787;
  if (!isLoopbackHost(host) && !configuredServerAuthToken()) {
    throw new ExternalServiceError(
      "ARCHE_SERVER_AUTH_TOKEN is required when binding Arche on a non-loopback host",
      "server_auth_required",
    );
  }
  await ensureArcheReady();
  await optimizeDatabase();
  const app = createApp();

  await app.listen({ host, port });

  const address = app.server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  logger.info("api", "server listening", {
    event: "server.started",
    details: {
      host,
      port: boundPort,
      authRequired: Boolean(configuredServerAuthToken()),
    },
  });

  return app;
}
