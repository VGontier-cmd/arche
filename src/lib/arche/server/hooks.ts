import type { FastifyInstance } from "fastify";

import { createLogger } from "../logging";
import { PUBLIC_PATHS } from "./constants";
import {
  configuredServerAuthToken,
  enforceRateLimit,
  getRequestDurationMs,
  getRequestPath,
  readRequestAuthToken,
  sendError,
  setRequestStartTime,
  tokensMatch,
} from "./request-context";

export type ArcheServerLogger = ReturnType<typeof createLogger>;

export function registerServerHooks(app: FastifyInstance, logger: ArcheServerLogger) {
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
}
