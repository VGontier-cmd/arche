import { existsSync } from "node:fs";
import { join } from "node:path";

import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

import { archePackageRootDir } from "../../cli-helpers";
import { createLogger } from "../logging";
import { registerServerHooks } from "./hooks";
import { registerServerRoutes } from "./routes";

const logger = createLogger({ service: "server" });

export function createArcheServerApp(): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: 1_048_576, // 1 MB
  });

  const root = archePackageRootDir();
  const webDir = join(root, "dist", "web");
  if (existsSync(webDir)) {
    app.register(fastifyStatic, {
      root: webDir,
      prefix: "/dashboard/",
      decorateReply: false,
      wildcard: false,
    });
  }

  registerServerHooks(app, logger);
  registerServerRoutes(app);

  return app;
}
