import Fastify, { type FastifyInstance } from "fastify";

import { createLogger } from "../logging";
import { registerServerHooks } from "./hooks";
import { registerServerRoutes } from "./routes";

const logger = createLogger({ service: "server" });

export function createArcheServerApp(): FastifyInstance {
  const app = Fastify({
    logger: false,
  });

  registerServerHooks(app, logger);
  registerServerRoutes(app);

  return app;
}
