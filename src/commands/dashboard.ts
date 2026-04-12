import type { Command } from "commander";

export function register(program: Command) {
  program
    .command("dashboard")
    .description("Open the Arche web dashboard in the browser")
    .option("--port <port>", "server port to connect to", "8787")
    .option("--host <host>", "server host", "127.0.0.1")
    .action(async (options: { port: string; host: string }) => {
      const url = `http://${options.host}:${options.port}/dashboard`;
      const { exec } = await import("node:child_process");
      const { platform } = await import("node:os");

      const openCommand =
        platform() === "darwin"
          ? "open"
          : platform() === "win32"
            ? "start"
            : "xdg-open";

      console.log(`Opening dashboard: ${url}`);
      exec(`${openCommand} ${url}`);
    });
}
