import type { Command } from "commander";

import { printArcheBanner } from "../lib/arche/banner";

export function register(program: Command) {
  program
    .command("worker")
    .description("Start the Arche worker loop")
    .action(async () => {
      printArcheBanner();

      const { startWorker } = await import("../worker/main");
      await startWorker();
    });
}
