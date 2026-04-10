#!/usr/bin/env node

import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as p from "@clack/prompts";
import { Command } from "commander";
import { sql } from "drizzle-orm";

import { printArcheBanner } from "./lib/arche/banner";
import { createLogger } from "./lib/arche/logging";
import {
  applyEnvToProcess,
  databaseUrlForRuntimeRoot,
  defaultInitOrchestratorValues,
  defaultInstallEnvValues,
  envFileHasNonEmptyValues,
  mergeInitOrchestratorConfig,
  normalizeBranchPrefix,
  preserveUnmanagedEnvValues,
  readEnvFile,
  readInitOrchestratorConfig,
  resolveArcheProjectEnvPath,
  resolveInstallEnvValues,
  USER_OPENROUTER_API_KEY_ENV,
  writeInitOrchestratorConfig,
  writeInstallEnvFile,
  type InitOrchestratorValues,
  type InstallEnvValues,
} from "./lib/install";

function archePackageRootDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

function bundledEnvTemplatePath(): string {
  return join(archePackageRootDir(), "install", "env.default");
}

function printJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const cliLogger = createLogger({ service: "cli", stream: process.stderr });

async function pathExists(path: string) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

const program = new Command();

program
  .name("arche")
  .description("Arche self-hosted development agent orchestrator")
  .version("0.1.0");

program
  .command("init")
  .description(
    "Initialize runtime directories and project environment (.arche/environment)",
  )
  .option("--yes", "skip prompts and accept inferred defaults")
  .option("--force", "overwrite existing .arche/environment")
  .action(async (options: { yes?: boolean; force?: boolean }) => {
    printArcheBanner();

    const envPath = resolveArcheProjectEnvPath();
    const legacyEnvPath = resolve(".env");
    const templatePath = bundledEnvTemplatePath();
    const hasExistingProjectEnv =
      (await pathExists(envPath)) &&
      envFileHasNonEmptyValues(await readEnvFile(envPath));
    const exampleValues = await readEnvFile(templatePath);
    const existingArche = await readEnvFile(envPath);
    const existingLegacy = await readEnvFile(legacyEnvPath);
    const existingValues = { ...existingLegacy, ...existingArche };
    const hadPriorEnvOnDisk =
      envFileHasNonEmptyValues(existingArche) ||
      envFileHasNonEmptyValues(existingLegacy);
    const managedValues = resolveInstallEnvValues({
      exampleValues,
      existingValues,
      processValues: process.env as Partial<
        Record<keyof InstallEnvValues, string | undefined>
      >,
    });
    const preservedValues = preserveUnmanagedEnvValues({
      exampleValues,
      existingValues,
    });
    const extraEnvValues = { ...preservedValues };

    const interactive = Boolean(
      process.stdin.isTTY && process.stdout.isTTY && !options.yes,
    );
    let shouldWriteEnv = !hasExistingProjectEnv || Boolean(options.force);

    if (interactive) {
      p.intro("Arche setup");
    }

    if (hasExistingProjectEnv && !options.force) {
      if (interactive) {
        const overwrite = guardPrompt(
          await p.confirm({
            message:
              "Existing Arche environment detected (.arche/environment). Overwrite it and run the setup prompts? (No keeps your current file)",
            initialValue: false,
          }),
        );
        shouldWriteEnv = overwrite;
      } else {
        shouldWriteEnv = false;
      }
    }

    let nextManagedValues = managedValues;
    let selectedSharedModel: string = defaultInitOrchestratorValues.sharedModel;
    if (shouldWriteEnv) {
      if (interactive) {
        const promptResult = await promptInstallEnv(
          managedValues,
          hadPriorEnvOnDisk,
        );
        nextManagedValues = promptResult.values;
        selectedSharedModel = promptResult.sharedModel;
      }

      await mkdir(dirname(envPath), { recursive: true });
      await writeInstallEnvFile(envPath, nextManagedValues, extraEnvValues);
      if (interactive) {
        p.note(envPath, "Wrote environment file");
      } else {
        cliLogger.info("cli", "wrote environment file", {
          event: "cli.init.env_written",
          details: { envPath },
        });
      }
    } else if (interactive) {
      p.note(envPath, "Using existing environment file");
    }

    applyEnvToProcess({
      ...extraEnvValues,
      ...nextManagedValues,
    });

    const orchestratorPath = resolve(nextManagedValues.ARCHE_CONFIG_PATH);
    const hasExistingOrchestratorConfig = await pathExists(orchestratorPath);
    const orchestratorConfigState =
      await readInitOrchestratorConfig(orchestratorPath);
    let shouldWriteOrchestratorConfig =
      !hasExistingOrchestratorConfig || Boolean(options.force);

    if (interactive && hasExistingOrchestratorConfig && !options.force) {
      const updateOrchestratorConfig = guardPrompt(
        await p.confirm({
          message: "Update branch prefix in orchestrator config now?",
          initialValue: false,
        }),
      );
      shouldWriteOrchestratorConfig = updateOrchestratorConfig;
    }

    if (shouldWriteOrchestratorConfig) {
      const nextOrchestratorValues = interactive
        ? await promptInitOrchestratorValues(
            orchestratorConfigState.values,
            selectedSharedModel,
          )
        : orchestratorConfigState.values;
      const nextOrchestratorConfig = mergeInitOrchestratorConfig(
        orchestratorConfigState.rawConfig,
        nextOrchestratorValues,
      );
      await mkdir(dirname(orchestratorPath), { recursive: true });
      await writeInitOrchestratorConfig(
        orchestratorPath,
        nextOrchestratorConfig,
      );
      if (interactive) {
        p.note(orchestratorPath, "Wrote orchestrator config");
      } else {
        cliLogger.info("cli", "wrote orchestrator config", {
          event: "cli.init.orchestrator_written",
          details: { orchestratorPath },
        });
      }
    } else if (interactive) {
      p.note(orchestratorPath, "Using existing orchestrator config");
    }

    const spinner = interactive ? p.spinner() : null;
    spinner?.start("Preparing Arche runtime");

    const [{ ensureArcheReady }, { getConfig }] = await Promise.all([
      import("./lib/bootstrap"),
      import("./lib/config"),
    ]);

    await ensureArcheReady();
    const config = await getConfig();

    spinner?.stop("Arche runtime ready");

    if (interactive) {
      p.note(
        [
          `Database: ${nextManagedValues.DATABASE_URL}`,
          `Config: ${nextManagedValues.ARCHE_CONFIG_PATH}`,
          `Server host: ${nextManagedValues.ARCHE_SERVER_HOST}`,
          `Runtime: ${config.runtime.root_dir}`,
          `Logs: ${config.runtime.logs_dir}`,
          `Server API auth configured: ${nextManagedValues.ARCHE_SERVER_AUTH_TOKEN ? "yes" : "no"}`,
          `OpenRouter API key configured (${USER_OPENROUTER_API_KEY_ENV}): ${nextManagedValues[USER_OPENROUTER_API_KEY_ENV] ? "yes" : "no"}`,
        ].join("\n"),
        "Runtime",
      );
      p.note(
        [
          "1) Validate local setup",
          "   arche doctor",
          "",
          "2) Register a repository",
          "   arche repositories add --name <repo> --remote-url <git-url> --local-mirror-path ./runtime/repos/<repo> [--gitlab-project-id <id>]",
          "",
          "3) Route Jira tickets to a repository",
          "   arche repo-rules add --name <rule> --repository <repo> --jira-project-key <KEY> --label agent-ready --issue-type Bug",
          "",
          "4) Start services",
          "   arche serve --port 8787",
          "   arche worker",
          "   arche dashboard",
          "",
          "5) Trigger a run manually",
          "   arche runs manual <JIRA-KEY>",
        ].join("\n"),
        "Next steps",
      );
      p.outro("Arche is ready.");
      return;
    }

    cliLogger.info("cli", "runtime ready", {
      event: "cli.init.ready",
    });
    printJson(config.runtime);
  });

program
  .command("doctor")
  .description("Check local prerequisites for Arche")
  .action(async () => {
    printArcheBanner();

    const [
      { runCommand },
      { ensureArcheReady },
      { db },
      { getConfig },
      { listMissingExecutionProfileSecrets },
    ] = await Promise.all([
      import("./lib/arche/utils"),
      import("./lib/bootstrap"),
      import("./lib/db/client"),
      import("./lib/config"),
      import("./lib/arche/profiles"),
    ]);

    const checks: Array<[string, string[]]> = [
      ["git", ["--version"]],
      ["docker", ["version", "--format", "{{.Server.Version}}"]],
    ];
    for (const [binary, args] of checks) {
      const result = await runCommand(binary, args);
      if (result.returncode !== 0) {
        cliLogger.error("cli", "doctor check failed", {
          event: "cli.doctor.check_failed",
          details: {
            binary,
            stderr: result.stderr,
          },
        });
        process.exitCode = 1;
      } else {
        cliLogger.info("cli", "doctor check passed", {
          event: "cli.doctor.check_passed",
          details: {
            binary,
            stdout: result.stdout.trim(),
          },
        });
      }
    }
    try {
      await ensureArcheReady();
      await db.get(sql`select 1 as value`);
      const config = await getConfig();
      const dockerSocketMounted = await pathExists("/var/run/docker.sock");
      const insideContainer = await pathExists("/.dockerenv");

      cliLogger.info("cli", "database reachable", {
        event: "cli.doctor.database_reachable",
      });

      const missingSecrets = listMissingExecutionProfileSecrets(config);
      if (missingSecrets.length > 0) {
        cliLogger.warn("cli", "execution profiles are missing secrets", {
          event: "cli.doctor.execution_profile_secrets_missing",
          details: {
            missingSecrets,
            recommendation:
              "Set the missing API key environment variables referenced by executors.profiles",
          },
        });
      } else {
        cliLogger.info("cli", "execution profile secrets are configured", {
          event: "cli.doctor.execution_profile_secrets_configured",
          details: {
            profiles: Object.keys(config.executors.profiles),
          },
        });
      }

      if (dockerSocketMounted && !isAbsolute(config.runtime.root_dir)) {
        cliLogger.warn("cli", "relative runtime root with host docker socket", {
          event: "cli.doctor.runtime_root_relative",
          details: {
            runtimeRoot: config.runtime.root_dir,
            recommendation:
              "Use an absolute ARCHE_RUNTIME_ROOT when a worker controls the host Docker daemon",
          },
        });
      }

      if (
        dockerSocketMounted &&
        !isAbsolute(process.env.ARCHE_CONFIG_PATH ?? "")
      ) {
        cliLogger.warn("cli", "relative config path with host docker socket", {
          event: "cli.doctor.config_path_relative",
          details: {
            configPath: process.env.ARCHE_CONFIG_PATH ?? "",
            recommendation:
              "Use an absolute ARCHE_CONFIG_PATH when running Arche in a container with docker.sock",
          },
        });
      }

      if (insideContainer && dockerSocketMounted) {
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

      const imageCheck = await runCommand("docker", [
        "image",
        "inspect",
        config.sandbox.image,
      ]);
      if (imageCheck.returncode !== 0) {
        cliLogger.warn("cli", "sandbox image is not available locally", {
          event: "cli.doctor.sandbox_image_missing",
          details: {
            image: config.sandbox.image,
            recommendation:
              "Build or pull the sandbox image before running Arche on this machine",
          },
        });
      } else {
        cliLogger.info("cli", "sandbox image is available locally", {
          event: "cli.doctor.sandbox_image_available",
          details: {
            image: config.sandbox.image,
          },
        });
      }
    } catch (error) {
      cliLogger.error("cli", "database check failed", {
        event: "cli.doctor.database_failed",
        details: {
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });
      process.exitCode = 1;
    }
  });

const repositories = program
  .command("repositories")
  .description("Manage repository registry");
const repoRules = program
  .command("repo-rules")
  .description("Manage repository routing rules");
const profiles = program
  .command("profiles")
  .description("Inspect configured execution profiles");

repositories.command("list").action(async () => {
  const [{ ensureArcheReady }, { listRepositories }] = await Promise.all([
    import("./lib/bootstrap"),
    import("./lib/arche/runs"),
  ]);
  await ensureArcheReady();
  printJson(await listRepositories());
});

repositories
  .command("add")
  .requiredOption("--name <name>")
  .requiredOption("--remote-url <url>")
  .requiredOption("--local-mirror-path <path>")
  .option("--default-branch <branch>", "default branch", "main")
  .option("--gitlab-project-id <id>")
  .action(async (options) => {
    const [{ ensureArcheReady }, { createRepository }] = await Promise.all([
      import("./lib/bootstrap"),
      import("./lib/arche/runs"),
    ]);
    await ensureArcheReady();
    const repository = await createRepository({
      name: options.name,
      gitProvider: "gitlab",
      remoteUrl: options.remoteUrl,
      localMirrorPath: options.localMirrorPath,
      defaultBranch: options.defaultBranch,
      enabled: true,
      gitlabProjectId: options.gitlabProjectId ?? null,
      allowedCommands: [],
      validationCommands: [],
    });
    printJson(repository);
  });

repoRules.command("list").action(async () => {
  const [{ ensureArcheReady }, { listRepoRules }] = await Promise.all([
    import("./lib/bootstrap"),
    import("./lib/arche/runs"),
  ]);
  await ensureArcheReady();
  printJson(await listRepoRules());
});

repoRules
  .command("add")
  .requiredOption("--name <name>")
  .requiredOption("--repository <idOrName>")
  .option("--jira-project-key <key>")
  .option("--label <label>")
  .option("--issue-type <type>")
  .option("--priority <priority>", "priority order", "100")
  .option("--disabled", "create the rule disabled", false)
  .action(async (options) => {
    const [{ ensureArcheReady }, { createRepoRule }] = await Promise.all([
      import("./lib/bootstrap"),
      import("./lib/arche/runs"),
    ]);
    await ensureArcheReady();
    const rule = await createRepoRule({
      name: options.name,
      repositoryName: options.repository,
      jiraProjectKey: options.jiraProjectKey ?? null,
      label: options.label ?? null,
      issueType: options.issueType ?? null,
      priority: Number(options.priority),
      enabled: !options.disabled,
    });
    printJson(rule);
  });

profiles.command("show").action(async () => {
  const [{ ensureArcheReady }, { listExecutionProfiles }] = await Promise.all([
    import("./lib/bootstrap"),
    import("./lib/arche/runs"),
  ]);
  await ensureArcheReady();
  printJson(await listExecutionProfiles());
});

const runs = program.command("runs").description("Inspect and create runs");

runs.command("list").action(async () => {
  const [{ ensureArcheReady }, { listRuns }] = await Promise.all([
    import("./lib/bootstrap"),
    import("./lib/arche/runs"),
  ]);
  await ensureArcheReady();
  printJson(await listRuns());
});

runs
  .command("manual")
  .argument("<ticketKey>")
  .option("--force", "bypass eligibility checks and active-run guard")
  .action(async (ticketKey, options: { force?: boolean }) => {
    const [{ ensureArcheReady }, { createManualRunForTicket }] =
      await Promise.all([
        import("./lib/bootstrap"),
        import("./lib/arche/runs"),
      ]);
    await ensureArcheReady();
    const run = await createManualRunForTicket({
      ticketKey,
      force: Boolean(options.force),
    });
    printJson(run);
  });

runs
  .command("retry")
  .argument("<runId>")
  .action(async (runId) => {
    const [{ ensureArcheReady }, { retryRun }] = await Promise.all([
      import("./lib/bootstrap"),
      import("./lib/arche/runs"),
    ]);
    await ensureArcheReady();
    printJson(await retryRun(runId));
  });

runs
  .command("cancel")
  .argument("<runId>")
  .action(async (runId) => {
    const [{ ensureArcheReady }, { cancelRun }] = await Promise.all([
      import("./lib/bootstrap"),
      import("./lib/arche/runs"),
    ]);
    await ensureArcheReady();
    printJson(await cancelRun(runId));
  });

runs
  .command("approve-plan")
  .argument("<runId>")
  .action(async (runId) => {
    const [{ ensureArcheReady }, { approvePlan }] = await Promise.all([
      import("./lib/bootstrap"),
      import("./lib/arche/runs"),
    ]);
    await ensureArcheReady();
    printJson(await approvePlan(runId));
  });

runs
  .command("respond")
  .argument("<runId>")
  .requiredOption("--message <message>")
  .action(async (runId, options: { message: string }) => {
    const [{ ensureArcheReady }, { respondToRun }] = await Promise.all([
      import("./lib/bootstrap"),
      import("./lib/arche/runs"),
    ]);
    await ensureArcheReady();
    printJson(await respondToRun(runId, options.message));
  });

runs
  .command("approve")
  .argument("<runId>")
  .action(async (runId) => {
    const [{ ensureArcheReady }, { approvePublish }] = await Promise.all([
      import("./lib/bootstrap"),
      import("./lib/arche/runs"),
    ]);
    await ensureArcheReady();
    printJson(await approvePublish(runId));
  });

runs
  .command("reject")
  .argument("<runId>")
  .action(async (runId) => {
    const [{ ensureArcheReady }, { rejectPublish }] = await Promise.all([
      import("./lib/bootstrap"),
      import("./lib/arche/runs"),
    ]);
    await ensureArcheReady();
    printJson(await rejectPublish(runId));
  });

runs
  .command("inspect")
  .argument("<runId>")
  .action(async (runId) => {
    const [{ ensureArcheReady }, runsModule] = await Promise.all([
      import("./lib/bootstrap"),
      import("./lib/arche/runs"),
    ]);
    await ensureArcheReady();
    const [detail, eventsPage] = await Promise.all([
      runsModule.getRunDetail(runId),
      runsModule.listRunEvents(runId, { limit: 100 }),
    ]);
    printJson({
      run: detail.run,
      tasks: detail.tasks,
      recentLogs: detail.logs.slice(-10),
      recentEvents: eventsPage.items.slice(-10),
    });
  });

runs
  .command("logs")
  .argument("<runId>")
  .option("--kind <kind>", "events|logs|commands|all", "all")
  .option("--follow", "poll for new log entries")
  .option("--json", "output structured JSON")
  .action(
    async (
      runId,
      options: { kind?: string; follow?: boolean; json?: boolean },
    ) => {
      const kind = validateLogKind(options.kind);
      const [{ ensureArcheReady }, runsModule, { sleep }] = await Promise.all([
        import("./lib/bootstrap"),
        import("./lib/arche/runs"),
        import("./lib/arche/utils"),
      ]);
      await ensureArcheReady();

      const cursors = {
        logs: 0,
        events: 0,
        commands: 0,
      };

      do {
        const batch = await loadLogEntries(runsModule, runId, kind, cursors);
        updateLogCursors(cursors, batch);

        if (options.json) {
          if (options.follow) {
            for (const entry of batch.entries) {
              process.stdout.write(`${JSON.stringify(entry)}\n`);
            }
          } else {
            printJson(batch.entries);
          }
        } else {
          for (const entry of batch.entries) {
            process.stdout.write(`${formatLogEntry(entry)}\n`);
          }
        }

        if (!options.follow) {
          break;
        }

        await sleep(1000);
      } while (true);
    },
  );

program
  .command("dashboard")
  .description("Start the Arche operator dashboard")
  .action(async () => {
    const [{ ensureArcheReady }, { startDashboard }] = await Promise.all([
      import("./lib/bootstrap"),
      import("./lib/arche/dashboard-ui"),
    ]);
    await ensureArcheReady();
    await startDashboard();
  });

program
  .command("serve")
  .option(
    "--host <host>",
    "host to bind",
    defaultInstallEnvValues.ARCHE_SERVER_HOST,
  )
  .option("--port <port>", "port to bind", "8787")
  .action(async (options) => {
    printArcheBanner();

    const { startServer } = await import("./server");
    await startServer({
      host: options.host,
      port: Number(options.port),
    });
  });

program
  .command("worker")
  .description("Start the Arche worker loop")
  .action(async () => {
    printArcheBanner();

    const { startWorker } = await import("./worker/main");
    await startWorker();
  });

await program.parseAsync(process.argv);

function guardPrompt<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Installation cancelled.");
    process.exit(0);
  }

  return value;
}

type LogKind = "events" | "logs" | "commands" | "all";
type LogCursorState = {
  logs: number;
  events: number;
  commands: number;
};
type TimelineEntry = {
  source: "event" | "log" | "command";
  id: number;
  timestamp: string | null;
  message: string;
  payload: Record<string, unknown>;
};

function validateLogKind(value: string | undefined): LogKind {
  if (
    value === "events" ||
    value === "logs" ||
    value === "commands" ||
    value === "all"
  ) {
    return value;
  }
  throw new Error(`Unsupported log kind: ${value ?? ""}`);
}

async function loadLogEntries(
  runsModule: {
    listRunLogsPage: (
      runId: string,
      options: { afterId?: number; limit?: number },
    ) => Promise<{ items: Array<Record<string, unknown>> }>;
    listRunEvents: (
      runId: string,
      options: { afterId?: number; limit?: number },
    ) => Promise<{ items: Array<Record<string, unknown>> }>;
    listRunCommands: (
      runId: string,
      options: { afterId?: number; limit?: number },
    ) => Promise<{ items: Array<Record<string, unknown>> }>;
  },
  runId: string,
  kind: LogKind,
  cursors: LogCursorState,
) {
  const [logsPage, eventsPage, commandsPage] = await Promise.all([
    kind === "logs" || kind === "all"
      ? runsModule.listRunLogsPage(runId, { afterId: cursors.logs })
      : Promise.resolve({ items: [] }),
    kind === "events" || kind === "all"
      ? runsModule.listRunEvents(runId, { afterId: cursors.events })
      : Promise.resolve({ items: [] }),
    kind === "commands" || kind === "all"
      ? runsModule.listRunCommands(runId, { afterId: cursors.commands })
      : Promise.resolve({ items: [] }),
  ]);

  const entries: TimelineEntry[] = [
    ...logsPage.items.map((log) => ({
      source: "log" as const,
      id: Number(log.id),
      timestamp: typeof log.timestamp === "string" ? log.timestamp : null,
      message: `${String(log.stream)}: ${String(log.message)}`,
      payload: log,
    })),
    ...eventsPage.items.map((event) => ({
      source: "event" as const,
      id: Number(event.id),
      timestamp: typeof event.timestamp === "string" ? event.timestamp : null,
      message: `event ${String(event.type)}`,
      payload: event,
    })),
    ...commandsPage.items.map((command) => ({
      source: "command" as const,
      id: Number(command.id),
      timestamp:
        typeof command.timestamp === "string" ? command.timestamp : null,
      message: `command [${String(command.phase)}] exit=${String(command.returncode)} ${String(command.command)}`,
      payload: command,
    })),
  ].sort((left, right) => {
    const leftTs = Date.parse(left.timestamp ?? "");
    const rightTs = Date.parse(right.timestamp ?? "");
    if (leftTs !== rightTs) {
      return leftTs - rightTs;
    }
    if (left.source !== right.source) {
      return left.source.localeCompare(right.source);
    }
    return left.id - right.id;
  });

  return {
    entries,
    latestIds: {
      logs:
        logsPage.items.length > 0
          ? Number(logsPage.items.at(-1)?.id ?? cursors.logs)
          : cursors.logs,
      events:
        eventsPage.items.length > 0
          ? Number(eventsPage.items.at(-1)?.id ?? cursors.events)
          : cursors.events,
      commands:
        commandsPage.items.length > 0
          ? Number(commandsPage.items.at(-1)?.id ?? cursors.commands)
          : cursors.commands,
    },
  };
}

function updateLogCursors(
  cursors: LogCursorState,
  batch: { latestIds: LogCursorState },
) {
  cursors.logs = batch.latestIds.logs;
  cursors.events = batch.latestIds.events;
  cursors.commands = batch.latestIds.commands;
}

function formatLogEntry(entry: TimelineEntry) {
  const timestamp = entry.timestamp ?? "-";
  return `${timestamp} ${entry.message}`;
}

async function promptInstallEnv(
  current: InstallEnvValues,
  hasExistingEnv: boolean,
) {
  if (hasExistingEnv) {
    p.note(
      "Review the values below and adjust only what changed.",
      "Existing configuration",
    );
  }

  const runtimeRoot = guardPrompt(
    await p.text({
      message: "Runtime root directory",
      initialValue: current.ARCHE_RUNTIME_ROOT,
      placeholder: defaultInstallEnvValues.ARCHE_RUNTIME_ROOT,
      validate: validateRequired,
    }),
  );
  const databaseUrl = databaseUrlForRuntimeRoot(runtimeRoot);

  const configPath = guardPrompt(
    await p.text({
      message: "Orchestrator config path",
      initialValue: current.ARCHE_CONFIG_PATH,
      placeholder: defaultInstallEnvValues.ARCHE_CONFIG_PATH,
      validate: validateRequired,
    }),
  );

  const logLevel = current.ARCHE_LOG_LEVEL;

  p.note(
    [
      `ARCHE_LOG_LEVEL stays on ${logLevel} by default.`,
      "Use debug only when you need more verbose server or worker troubleshooting logs.",
    ].join("\n"),
    "Logging",
  );

  p.note(
    [
      `ARCHE_SERVER_HOST stays on ${current.ARCHE_SERVER_HOST} by default.`,
      "Keep 127.0.0.1 for local-only access.",
      "If you later expose Arche on 0.0.0.0 or another non-loopback host, configure ARCHE_SERVER_AUTH_TOKEN too.",
    ].join("\n"),
    "Server API",
  );

  const updateServerAuthToken = guardPrompt(
    await p.confirm({
      message: "Configure or update ARCHE_SERVER_AUTH_TOKEN now?",
      initialValue: current.ARCHE_SERVER_AUTH_TOKEN.trim().length > 0,
    }),
  );

  const serverAuthToken = updateServerAuthToken
    ? guardPrompt(
        await p.password({
          message: "Server API auth token",
          mask: "*",
          validate: validateRequired,
        }),
      )
    : current.ARCHE_SERVER_AUTH_TOKEN;

  const currentOpenRouterKey = current[USER_OPENROUTER_API_KEY_ENV] ?? "";

  p.note(
    [
      "Arche uses OpenRouter for models (HTTPS OpenAI-compatible API at https://openrouter.ai/api/v1).",
      `Create a key at https://openrouter.ai/keys and set ${USER_OPENROUTER_API_KEY_ENV} here. orchestrator.yml maps api_key_env to that variable for the default profile.`,
      "Git/Jira/GitLab entries in this file also use USER_*; Arche runtime paths use ARCHE_* and DATABASE_URL.",
    ].join("\n"),
    "OpenRouter",
  );

  const updateOpenRouterApiKey = guardPrompt(
    await p.confirm({
      message: `Set or update ${USER_OPENROUTER_API_KEY_ENV} now? (from https://openrouter.ai/keys)`,
      initialValue: currentOpenRouterKey.trim().length === 0,
    }),
  );

  const openRouterApiKey = updateOpenRouterApiKey
    ? guardPrompt(
        await p.password({
          message: `${USER_OPENROUTER_API_KEY_ENV} — OpenRouter secret, never logged`,
          mask: "*",
          validate: validateRequired,
        }),
      )
    : currentOpenRouterKey;

  const sharedModel = guardPrompt(
    await p.select({
      message:
        "Choose the default OpenRouter model for planner/executor/reviewer (editable later in orchestrator.yml)",
      initialValue: "openai/gpt-5.4-mini",
      options: [
        { value: "openai/gpt-5.4-mini", label: "openai/gpt-5.4-mini", hint: "default balanced choice" },
        { value: "openai/gpt-5.4", label: "openai/gpt-5.4", hint: "stronger reasoning, higher cost" },
        { value: "anthropic/claude-3.7-sonnet", label: "anthropic/claude-3.7-sonnet", hint: "good coding reviewer profile" },
        { value: "google/gemini-2.5-pro", label: "google/gemini-2.5-pro", hint: "broad capabilities" },
        { value: "meta-llama/llama-4-maverick", label: "meta-llama/llama-4-maverick", hint: "alternative open model" },
      ],
    }),
  );

  const configureJira = guardPrompt(
    await p.confirm({
      message: "Configure Jira now?",
      initialValue: hasAnyValue(
        current.USER_JIRA_BASE_URL,
        current.USER_JIRA_EMAIL,
        current.USER_JIRA_API_TOKEN,
      ),
    }),
  );

  const jiraValues = configureJira
    ? await (async () => {
        const baseUrl = guardPrompt(
          await p.text({
            message: "Jira base URL",
            initialValue: current.USER_JIRA_BASE_URL,
            placeholder: "https://example.atlassian.net",
            validate: validateUrl,
          }),
        );

        const email = guardPrompt(
          await p.text({
            message: "Jira technical user email",
            initialValue: current.USER_JIRA_EMAIL,
            placeholder: "agent-dev@example.com",
            validate: validateRequired,
          }),
        );

        p.note(
          [
            "Generate the Jira API token from your Atlassian account security page:",
            "https://id.atlassian.com/manage-profile/security/api-tokens",
          ].join("\n"),
          "Jira API token",
        );

        const apiToken = guardPrompt(
          await p.password({
            message: "Jira API token",
            mask: "*",
            validate: validateRequired,
          }),
        );

        return {
          USER_JIRA_BASE_URL: baseUrl,
          USER_JIRA_EMAIL: email,
          USER_JIRA_API_TOKEN: apiToken,
        };
      })()
    : {
        USER_JIRA_BASE_URL: "",
        USER_JIRA_EMAIL: "",
        USER_JIRA_API_TOKEN: "",
      };

  const configureGitLab = guardPrompt(
    await p.confirm({
      message: "Configure GitLab now?",
      initialValue: hasAnyValue(
        current.USER_GITLAB_BASE_URL,
        current.USER_GITLAB_TOKEN,
      ),
    }),
  );

  const gitlabValues = configureGitLab
    ? {
        USER_GITLAB_BASE_URL: guardPrompt(
          await p.text({
            message: "GitLab base URL",
            initialValue: current.USER_GITLAB_BASE_URL,
            placeholder: "https://gitlab.example.com",
            validate: validateUrl,
          }),
        ),
        USER_GITLAB_TOKEN: guardPrompt(
          await p.password({
            message: "GitLab token",
            mask: "*",
            validate: validateRequired,
          }),
        ),
      }
    : {
        USER_GITLAB_BASE_URL: "",
        USER_GITLAB_TOKEN: "",
      };

  return {
    values: {
      ...current,
      DATABASE_URL: databaseUrl,
      ARCHE_CONFIG_PATH: configPath,
      ARCHE_RUNTIME_ROOT: runtimeRoot,
      ARCHE_SERVER_HOST: current.ARCHE_SERVER_HOST,
      ARCHE_SERVER_AUTH_TOKEN: serverAuthToken,
      ARCHE_LOG_LEVEL: logLevel,
      [USER_OPENROUTER_API_KEY_ENV]: openRouterApiKey,
      ...jiraValues,
      ...gitlabValues,
    },
    sharedModel,
  };
}

async function promptInitOrchestratorValues(
  current: InitOrchestratorValues,
  selectedSharedModel: string,
) {
  p.note(
    [
      "These values are stored in orchestrator.yml.",
      "The branch prefix is prepended to generated branches.",
    ].join("\n"),
    "Orchestrator defaults",
  );

  const branchPrefix = normalizeBranchPrefix(
    guardPrompt(
      await p.text({
        message: "Branch prefix for generated branches",
        initialValue: current.branchPrefix,
        placeholder: defaultInitOrchestratorValues.branchPrefix,
        validate: validateBranchPrefix,
      }),
    ),
  );

  return {
    branchPrefix,
    sharedModel: selectedSharedModel || current.sharedModel,
  };
}

function validateRequired(value: string | undefined) {
  if (!value?.trim()) {
    return "Value is required";
  }
}

function validateBranchPrefix(value: string | undefined) {
  const normalized = normalizeBranchPrefix(value ?? "");
  if (normalized.length === 0) {
    return;
  }
  if (!/^[A-Za-z0-9._/-]+\/$/.test(normalized)) {
    return "Use only letters, numbers, ., _, -, and /";
  }
  if (normalized.includes("//")) {
    return "Branch prefix cannot contain empty path segments";
  }
}

function validateUrl(value: string | undefined) {
  if (!value?.trim()) {
    return "Value is required";
  }

  try {
    new URL(value);
  } catch {
    return "Enter a valid URL";
  }
}

function hasAnyValue(...values: string[]) {
  return values.some((value) => value.trim().length > 0);
}
