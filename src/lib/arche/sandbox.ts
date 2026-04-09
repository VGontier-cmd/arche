import { resolve } from "node:path";

import type { OrchestratorConfig } from "../config";
import { ExternalServiceError } from "./errors";
import { formatCommandArgv, runCommand } from "./utils";
import type { CommandResult } from "./utils";

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
