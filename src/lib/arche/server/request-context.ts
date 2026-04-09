import { timingSafeEqual } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

import { env } from "../../env";
import { routeErrorResponse } from "../http";
import { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from "./constants";

export type PaginationQuery = {
  after_id?: string;
  limit?: string;
};

export type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export type InstrumentedRequest = FastifyRequest & {
  archeStartedAt?: number;
};

const rateLimitEntries = new Map<string, RateLimitEntry>();

export function parsePaginationQuery(query: PaginationQuery) {
  const parsedAfterId = query.after_id ? Number(query.after_id) : undefined;
  const parsedLimit = query.limit ? Number(query.limit) : undefined;
  return {
    afterId: Number.isFinite(parsedAfterId) ? parsedAfterId : undefined,
    limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
  };
}

export function readHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

export async function sendError(reply: FastifyReply, error: unknown) {
  const response = routeErrorResponse(error);
  const payload = await response.json();
  reply.status(response.status).send(payload);
}

export function getRequestPath(request: FastifyRequest) {
  return new URL(request.raw.url ?? "/", "http://127.0.0.1").pathname;
}

export function isLoopbackHost(host: string) {
  const normalized = host.trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

export function configuredServerAuthToken() {
  const token = env.ARCHE_SERVER_AUTH_TOKEN?.trim();
  return token ? token : null;
}

export function readRequestAuthToken(request: FastifyRequest) {
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

export function tokensMatch(expected: string, provided: string | null) {
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

export function enforceRateLimit(request: FastifyRequest) {
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

export function setRequestStartTime(request: FastifyRequest) {
  (request as InstrumentedRequest).archeStartedAt = Date.now();
}

export function getRequestDurationMs(request: FastifyRequest) {
  const startedAt = (request as InstrumentedRequest).archeStartedAt;
  return typeof startedAt === "number" ? Math.max(0, Date.now() - startedAt) : null;
}
