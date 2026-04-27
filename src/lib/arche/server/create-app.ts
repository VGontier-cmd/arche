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

  // Allow empty bodies on POST/PUT/PATCH so requests with `Content-Type:
  // application/json` but no payload (e.g. action endpoints like /runs/:id/cancel
  // hit by `curl -X POST -H "Content-Type: application/json"`) don't crash with
  // an unhandled FastifyError. Default parser rejects empty strings; we replace
  // it with one that treats them as `{}`.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, body: string, done) => {
      if (typeof body !== "string" || body.trim().length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(body));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

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
