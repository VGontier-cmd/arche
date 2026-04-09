import { startServer } from "../server";
import { createLogger, errorDetails } from "../lib/arche/logging";

const logger = createLogger({ service: "server" });

startServer().catch((error) => {
  logger.error("api", "server crashed", {
    event: "server.crashed",
    details: errorDetails(error),
  });
  process.exit(1);
});
