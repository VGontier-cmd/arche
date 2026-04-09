import { startWorker } from "../worker/main";
import { createLogger, errorDetails } from "../lib/arche/logging";

const logger = createLogger({ service: "worker" });

startWorker().catch((error) => {
  logger.error("worker_loop", "worker crashed", {
    event: "worker.crashed",
    details: errorDetails(error),
  });
  process.exit(1);
});
