import { spawn } from "node:child_process";
import { resolve } from "node:path";

import type { OrchestratorConfig } from "../config";
import { ExternalServiceError } from "./errors";
import { formatCommandArgv, runCommand } from "./utils";
import type { CommandResult } from "./utils";

export type SandboxStreamEvent =
  | { type: "started"; command: string }
  | { type: "stdout"; chunk: string }
  | { type: "stderr"; chunk: string };

export type SandboxRunStreamResult = {
  events: AsyncIterable<SandboxStreamEvent>;
  /** Resolves to the final command result when the process exits. */
  done: Promise<CommandResult>;
};

export class SandboxManager {
  constructor(private readonly config: OrchestratorConfig) {}

  async create(
    runId: string,
    worktreePath: string,
    options: {
      artifactsPath?: string;
    } = {},
  ) {
    const containerName = `arche-run-${runId}`;
    const args = [
      "run",
      "-d",
      "--rm",
      "--name",
      containerName,
      "--network",
      this.config.sandbox.network,
      "--pids-limit",
      String(this.config.sandbox.pids_limit),
      "--memory",
      `${this.config.sandbox.memory_limit_mb}m`,
      "--cpus",
      this.config.sandbox.cpus,
      "-w",
      "/workspace",
      "-v",
      `${resolve(worktreePath)}:/workspace`,
    ];
    if (options.artifactsPath) {
      args.push("-v", `${resolve(options.artifactsPath)}:/arche-artifacts`);
    }

    if (this.config.sandbox.read_only_rootfs) {
      args.push("--read-only");
    }
    if (this.config.sandbox.no_new_privileges) {
      args.push("--security-opt", "no-new-privileges=true");
    }
    for (const tmpfsPath of this.config.sandbox.tmpfs_paths) {
      args.push("--tmpfs", tmpfsPath);
    }
    for (const capability of this.config.sandbox.cap_drop) {
      args.push("--cap-drop", capability);
    }
    for (const [envName, envValue] of this.allowedEnvironmentEntries()) {
      args.push("-e", `${envName}=${envValue}`);
    }
    if (this.config.sandbox.user.trim()) {
      args.push("--user", this.config.sandbox.user);
    }
    args.push(this.config.sandbox.image, "tail", "-f", "/dev/null");

    const result = await runCommand("docker", args);
    if (result.returncode !== 0) {
      throw new ExternalServiceError(result.stderr || "Sandbox creation failed");
    }
    return containerName;
  }

  async run(sandboxId: string, argv: string[], timeout: number): Promise<CommandResult> {
    if (argv.length === 0) {
      throw new ExternalServiceError("Sandbox command argv must not be empty", "command_invalid");
    }
    return runCommand("docker", ["exec", "-w", "/workspace", sandboxId, ...argv], {
      timeout,
      label: formatCommandArgv(argv),
    });
  }

  /**
   * Streaming variant: spawn `docker exec` and emit stdout/stderr chunks as
   * they arrive so the model (via SDK preliminary results) and the dashboard
   * timeline see live progress on long-running commands like `npm test`.
   * Returns both an event iterable and a `done` promise that resolves with
   * the final aggregated CommandResult — caller can pick whichever fits.
   */
  runStreaming(sandboxId: string, argv: string[], timeout: number): SandboxRunStreamResult {
    if (argv.length === 0) {
      throw new ExternalServiceError("Sandbox command argv must not be empty", "command_invalid");
    }
    const label = formatCommandArgv(argv);
    const child = spawn("docker", ["exec", "-w", "/workspace", sandboxId, ...argv], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const startedAt = Date.now();
    const stdoutBuf: string[] = [];
    const stderrBuf: string[] = [];

    const queue: SandboxStreamEvent[] = [{ type: "started", command: label }];
    let pushResolve: (() => void) | null = null;
    let finished = false;

    const push = (event: SandboxStreamEvent) => {
      queue.push(event);
      pushResolve?.();
    };

    child.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString("utf8");
      stdoutBuf.push(chunk);
      push({ type: "stdout", chunk });
    });
    child.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString("utf8");
      stderrBuf.push(chunk);
      push({ type: "stderr", chunk });
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeout);

    const done = new Promise<CommandResult>((resolveDone) => {
      child.on("close", (code) => {
        clearTimeout(timer);
        finished = true;
        pushResolve?.();
        resolveDone({
          command: label,
          returncode: typeof code === "number" ? code : 1,
          stdout: stdoutBuf.join(""),
          stderr: stderrBuf.join(""),
          durationMs: Date.now() - startedAt,
        });
      });
    });

    const events: AsyncIterable<SandboxStreamEvent> = {
      [Symbol.asyncIterator]: async function* () {
        while (true) {
          if (queue.length > 0) {
            yield queue.shift()!;
            continue;
          }
          if (finished) return;
          await new Promise<void>((r) => { pushResolve = r; });
          pushResolve = null;
        }
      },
    };

    return { events, done };
  }

  async destroy(sandboxId: string | null) {
    if (!sandboxId) return;
    await runCommand("docker", ["rm", "-f", sandboxId]);
  }

  private allowedEnvironmentEntries() {
    return this.config.sandbox.env_allowlist
      .map((name) => [name, process.env[name]])
      .filter((entry): entry is [string, string] => typeof entry[1] === "string");
  }
}
