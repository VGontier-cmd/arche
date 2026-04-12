import {
  ArcheError,
  ConfigurationError,
  ConflictError,
  EligibilityError,
  NotFoundError,
} from "./errors";
import { createLogger, errorDetails } from "./logging";

const logger = createLogger({ service: "server" });

export function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

export function routeErrorResponse(error: unknown) {
  if (error instanceof NotFoundError) {
    return json({ error: error.message, code: error.code }, { status: 404 });
  }
  if (error instanceof ConflictError) {
    return json({ error: error.message, code: error.code }, { status: 409 });
  }
  if (error instanceof ConfigurationError) {
    return json({ error: error.message, code: error.code }, { status: 422 });
  }
  if (error instanceof EligibilityError) {
    return json({ error: error.message, code: error.code }, { status: 422 });
  }
  if (error instanceof ArcheError) {
    return json({ error: error.message, code: error.code }, { status: 400 });
  }
  logger.error("http", "unhandled server error", {
    event: "http.unhandled_error",
    details: errorDetails(error),
  });
  return json({ error: "Internal server error" }, { status: 500 });
}
