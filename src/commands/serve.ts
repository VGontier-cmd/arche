import type { Command } from "commander";

import { printArcheBanner } from "../lib/arche/banner";
import { defaultInstallEnvValues } from "../lib/install";

export function register(program: Command) {
  program
    .command("serve")
    .description("Start the Arche API server")
    .option(
      "--host <host>",
      "host to bind",
      defaultInstallEnvValues.ARCHE_SERVER_HOST,
    )
    .option("--port <port>", "port to bind", "8787")
    .action(async (options: { host: string; port: string }) => {
      printArcheBanner();

      const { startServer } = await import("../server");
      await startServer({
        host: options.host,
        port: Number(options.port),
      });
    });
}
