import type { FastifyInstance } from "fastify";

import { ExternalServiceError } from "../errors";
import { ensureArcheReady } from "../../bootstrap";
import { optimizeDatabase } from "../../db/client";
import { env } from "../../env";
import { createLogger } from "../logging";
import { configuredServerAuthToken, isLoopbackHost } from "./request-context";
import { createArcheServerApp } from "./create-app";

const logger = createLogger({ service: "server" });

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
  const app = createArcheServerApp();

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
