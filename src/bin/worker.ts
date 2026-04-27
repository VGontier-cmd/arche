import { startWorker } from "../worker/main";
import { createLogger, errorDetails } from "../lib/arche/logging";

const logger = createLogger({ service: "worker" });

// Defense in depth: long-running orchestrators are full of fire-and-forget
// timers and detached promises (heartbeats, SSE pumps, schedule pings). A
// single unhandled rejection in any of them would otherwise terminate the
// whole worker on Node 20+ — which previously made the worker silently die
// after one run and required manual restart. Log it loudly and keep going.
process.on("unhandledRejection", (reason) => {
  logger.error("worker_loop", "unhandled promise rejection (kept worker alive)", {
    event: "worker.unhandled_rejection",
    details: errorDetails(reason),
  });
});

process.on("uncaughtException", (error) => {
  // Synchronous throws are usually programming bugs — log with high signal
  // but don't exit, since the worker loop's own try/catch already covers
  // most of these and a crash here is much worse than a noisy log.
  logger.error("worker_loop", "uncaught exception (kept worker alive)", {
    event: "worker.uncaught_exception",
    details: errorDetails(error),
  });
});

startWorker().catch((error) => {
  logger.error("worker_loop", "worker crashed", {
    event: "worker.crashed",
    details: errorDetails(error),
  });
  process.exit(1);
});
