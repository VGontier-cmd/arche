import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { Command } from "commander";

import { printArcheBanner } from "../lib/arche/banner";
import { archePackageRootDir } from "../lib/cli-helpers";

export function register(program: Command) {
  program
    .command("up")
    .description(
      "Start server, worker, and open the dashboard (all-in-one)",
    )
    .option("--port <port>", "server port", "8787")
    .option("--host <host>", "server host", "127.0.0.1")
    .action(async (options: { port: string; host: string }) => {
      printArcheBanner();

      const root = archePackageRootDir();
      const distServer = join(root, "dist", "server.js");
      const isBundled = existsSync(distServer);

      const serverPath = isBundled
        ? distServer
        : join(root, "src", "bin", "server.ts");
      const workerPath = isBundled
        ? join(root, "dist", "worker", "main.js")
        : join(root, "src", "bin", "worker.ts");

      const children: ReturnType<typeof fork>[] = [];
      const ac = new AbortController();

      function cleanup() {
        ac.abort();
        for (const child of children) {
          child.kill("SIGTERM");
        }
      }

      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);

      const forkOptions = {
        stdio: "inherit" as const,
        env: {
          ...process.env,
          ARCHE_SERVER_HOST: options.host,
          ARCHE_SERVER_PORT: options.port,
        },
        execArgv: isBundled ? [] : ["--import", "tsx"],
      };

      console.log(`Starting Arche server on ${options.host}:${options.port}...`);
      const serverChild = fork(serverPath, [], forkOptions);
      children.push(serverChild);

      console.log("Starting Arche worker...");
      const workerChild = fork(workerPath, [], forkOptions);
      children.push(workerChild);

      // Wait a moment for server to start, then open dashboard
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const dashboardUrl = `http://${options.host}:${options.port}/dashboard`;
      console.log(`Dashboard: ${dashboardUrl}`);

      const { platform } = await import("node:os");
      const { exec } = await import("node:child_process");
      const openCommand =
        platform() === "darwin"
          ? "open"
          : platform() === "win32"
            ? "start"
            : "xdg-open";
      exec(`${openCommand} ${dashboardUrl}`);

      // Wait for children to exit
      await Promise.all(
        children.map(
          (child) =>
            new Promise<void>((resolve) => {
              child.on("exit", () => resolve());
            }),
        ),
      );
    });
}
