import { isAbsolute } from "node:path";

import * as p from "@clack/prompts";
import type { Command } from "commander";

import { printArcheBanner } from "../lib/arche/banner";
import { cliLogger, pathExists, printJson } from "../lib/cli-helpers";

export function register(program: Command) {
  program
    .command("doctor")
    .description("Check local prerequisites for Arche")
    .option("--json", "output structured JSON instead of visual indicators")
    .action(async (options: { json?: boolean }) => {
      printArcheBanner();

      const [
        { runCommand },
        { ensureArcheReady },
        { db },
        { getConfig },
        { listMissingExecutionProfileSecrets },
      ] = await Promise.all([
        import("../lib/arche/utils"),
        import("../lib/bootstrap"),
        import("../lib/db/client"),
        import("../lib/config"),
        import("../lib/arche/profiles"),
      ]);

      const useVisual = !options.json && process.stdout.isTTY;
      const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

      const checks: Array<[string, string[]]> = [
        ["git", ["--version"]],
        ["docker", ["version", "--format", "{{.Server.Version}}"]],
      ];

      for (const [binary, args] of checks) {
        const result = await runCommand(binary, args);
        if (result.returncode !== 0) {
          results.push({ name: binary, ok: false, detail: result.stderr });
          if (useVisual) {
            p.log.error(`${binary}: not available`);
          } else {
            cliLogger.error("cli", "doctor check failed", {
              event: "cli.doctor.check_failed",
              details: { binary, stderr: result.stderr },
            });
          }
          process.exitCode = 1;
        } else {
          results.push({
            name: binary,
            ok: true,
            detail: result.stdout.trim(),
          });
          if (useVisual) {
            p.log.success(`${binary}: ${result.stdout.trim()}`);
          } else {
            cliLogger.info("cli", "doctor check passed", {
              event: "cli.doctor.check_passed",
              details: { binary, stdout: result.stdout.trim() },
            });
          }
        }
      }

      try {
        await ensureArcheReady();
        await db.get(sql`select 1 as value`);
        const config = await getConfig();
        const dockerSocketMounted = await pathExists("/var/run/docker.sock");
        const insideContainer = await pathExists("/.dockerenv");

        results.push({ name: "database", ok: true });
        if (useVisual) {
          p.log.success("Database: reachable");
        } else {
          cliLogger.info("cli", "database reachable", {
            event: "cli.doctor.database_reachable",
          });
        }

        const missingSecrets = listMissingExecutionProfileSecrets(config);
        if (missingSecrets.length > 0) {
          results.push({
            name: "execution_profiles",
            ok: false,
            detail: missingSecrets.join(", "),
          });
          if (useVisual) {
            p.log.warning(
              `Execution profiles: missing secrets (${missingSecrets.join(", ")})`,
            );
          } else {
            cliLogger.warn(
              "cli",
              "execution profiles are missing secrets",
              {
                event: "cli.doctor.execution_profile_secrets_missing",
                details: {
                  missingSecrets,
                  recommendation:
                    "Set the missing API key environment variables referenced by executors.profiles",
                },
              },
            );
          }
        } else {
          results.push({ name: "execution_profiles", ok: true });
          if (useVisual) {
            p.log.success(
              `Execution profiles: configured (${Object.keys(config.executors.profiles).join(", ")})`,
            );
          } else {
            cliLogger.info(
              "cli",
              "execution profile secrets are configured",
              {
                event: "cli.doctor.execution_profile_secrets_configured",
                details: { profiles: Object.keys(config.executors.profiles) },
              },
            );
          }
        }

        if (dockerSocketMounted && !isAbsolute(config.runtime.root_dir)) {
          if (useVisual) {
            p.log.warning(
              "Relative runtime root with host docker socket — use absolute ARCHE_RUNTIME_ROOT",
            );
          } else {
            cliLogger.warn(
              "cli",
              "relative runtime root with host docker socket",
              {
                event: "cli.doctor.runtime_root_relative",
                details: {
                  runtimeRoot: config.runtime.root_dir,
                  recommendation:
                    "Use an absolute ARCHE_RUNTIME_ROOT when a worker controls the host Docker daemon",
                },
              },
            );
          }
        }

        if (
          dockerSocketMounted &&
          !isAbsolute(process.env.ARCHE_CONFIG_PATH ?? "")
        ) {
          if (useVisual) {
            p.log.warning(
              "Relative config path with host docker socket — use absolute ARCHE_CONFIG_PATH",
            );
          } else {
            cliLogger.warn(
              "cli",
              "relative config path with host docker socket",
              {
                event: "cli.doctor.config_path_relative",
                details: {
                  configPath: process.env.ARCHE_CONFIG_PATH ?? "",
                  recommendation:
                    "Use an absolute ARCHE_CONFIG_PATH when running Arche in a container with docker.sock",
                },
              },
            );
          }
        }

        if (insideContainer && dockerSocketMounted) {
          if (useVisual) {
            p.log.warning(
              "Container controlling host Docker — ensure paths are absolute and mounted identically",
            );
          } else {
            cliLogger.warn(
              "cli",
              "containerized process is controlling host docker",
              {
                event: "cli.doctor.container_host_docker_warning",
                details: {
                  runtimeRoot: config.runtime.root_dir,
                  configPath: process.env.ARCHE_CONFIG_PATH ?? "",
                  recommendation:
                    "Ensure runtime and config paths are absolute and mounted at the same host/container path",
                },
              },
            );
          }
        }

        const imageCheck = await runCommand("docker", [
          "image",
          "inspect",
          config.sandbox.image,
        ]);
        if (imageCheck.returncode !== 0) {
          results.push({
            name: "sandbox_image",
            ok: false,
            detail: config.sandbox.image,
          });
          if (useVisual) {
            p.log.warning(
              `Sandbox image: ${config.sandbox.image} not found locally`,
            );
          } else {
            cliLogger.warn(
              "cli",
              "sandbox image is not available locally",
              {
                event: "cli.doctor.sandbox_image_missing",
                details: {
                  image: config.sandbox.image,
                  recommendation:
                    "Build or pull the sandbox image before running Arche on this machine",
                },
              },
            );
          }
        } else {
          results.push({ name: "sandbox_image", ok: true });
          if (useVisual) {
            p.log.success(`Sandbox image: ${config.sandbox.image}`);
          } else {
            cliLogger.info(
              "cli",
              "sandbox image is available locally",
              {
                event: "cli.doctor.sandbox_image_available",
                details: { image: config.sandbox.image },
              },
            );
          }
        }
      } catch (error) {
        results.push({
          name: "database",
          ok: false,
          detail: error instanceof Error ? error.message : "Unknown error",
        });
        if (useVisual) {
          p.log.error(
            `Database: ${error instanceof Error ? error.message : "unreachable"}`,
          );
        } else {
          cliLogger.error("cli", "database check failed", {
            event: "cli.doctor.database_failed",
            details: {
              error:
                error instanceof Error ? error.message : "Unknown error",
            },
          });
        }
        process.exitCode = 1;
      }

      if (options.json) {
        printJson(results);
      } else if (useVisual) {
        const allOk = results.every((r) => r.ok);
        if (allOk) {
          p.outro("All checks passed.");
        } else {
          p.outro("Some checks failed — review the warnings above.");
        }
      }
    });
}

// Import sql for the database check
import { sql } from "drizzle-orm";
