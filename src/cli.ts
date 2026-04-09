#!/usr/bin/env node

import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import * as p from "@clack/prompts";
import { Command } from "commander";
import { sql } from "drizzle-orm";

import { printArcheBanner } from "./lib/arche/banner";
import { createLogger } from "./lib/arche/logging";
import {
  applyEnvToProcess,
  databaseUrlForRuntimeRoot,
  defaultInstallEnvValues,
  preserveUnmanagedEnvValues,
  readEnvFile,
  resolveInstallEnvValues,
  writeInstallEnvFile,
  type InstallEnvValues,
} from "./lib/install";

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

program.name("arche").description("Arche self-hosted development agent orchestrator").version("0.1.0");

program
  .command("init")
  .description("Initialize runtime directories and local .env")
  .option("--yes", "skip prompts and accept inferred defaults")
  .option("--force", "overwrite existing .env")
  .action(async (options: { yes?: boolean; force?: boolean }) => {
    printArcheBanner();

    const envPath = resolve(".env");
    const examplePath = resolve(".env.example");
    const hasExistingEnv = await pathExists(envPath);
    const exampleValues = await readEnvFile(examplePath);
    const existingValues = await readEnvFile(envPath);
    const managedValues = resolveInstallEnvValues({
      exampleValues,
      existingValues,
      processValues: process.env as Partial<Record<keyof InstallEnvValues, string | undefined>>,
    });
    const preservedValues = preserveUnmanagedEnvValues({
      exampleValues,
      existingValues,
    });
    const extraEnvValues = { ...preservedValues };

    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY && !options.yes);
    let shouldWriteEnv = !hasExistingEnv || Boolean(options.force);

    if (interactive) {
      p.intro("Arche setup");
    }

    if (hasExistingEnv && !options.force) {
      if (interactive) {
        const shouldUpdate = await p.confirm({
          message: "Update the existing .env file?",
          initialValue: false,
        });
        shouldWriteEnv = guardPrompt(shouldUpdate);
      } else {
        shouldWriteEnv = false;
      }
    }

    let nextManagedValues = managedValues;
    if (shouldWriteEnv) {
      if (interactive) {
        nextManagedValues = await promptInstallEnv(managedValues, hasExistingEnv);
      }

      await writeInstallEnvFile(envPath, nextManagedValues, extraEnvValues);
      if (interactive) {
        p.note(envPath, "Wrote .env");
      } else {
        cliLogger.info("cli", "wrote environment file", {
          event: "cli.init.env_written",
          details: { envPath },
        });
      }
    } else if (interactive) {
      p.note(envPath, "Using existing .env");
    }

    applyEnvToProcess({
      ...extraEnvValues,
      ...nextManagedValues,
    });

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
          `Default API key configured: ${nextManagedValues.ARCHE_DEFAULT_API_KEY ? "yes" : "no"}`,
        ].join("\n"),
        "Runtime",
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

    const [{ runCommand }, { ensureArcheReady }, { db }, { getConfig }, { listMissingExecutionProfileSecrets }] = await Promise.all([
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
            recommendation: "Set the missing API key environment variables referenced by executors.profiles",
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

      if (dockerSocketMounted && !isAbsolute(process.env.ARCHE_CONFIG_PATH ?? "")) {
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
        cliLogger.warn("cli", "containerized process is controlling host docker", {
          event: "cli.doctor.container_host_docker_warning",
          details: {
            runtimeRoot: config.runtime.root_dir,
            configPath: process.env.ARCHE_CONFIG_PATH ?? "",
            recommendation:
              "Ensure runtime and config paths are absolute and mounted at the same host/container path",
          },
        });
      }

      const imageCheck = await runCommand("docker", ["image", "inspect", config.sandbox.image]);
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

const repositories = program.command("repositories").description("Manage repository registry");
const repoRules = program.command("repo-rules").description("Manage repository routing rules");
const profiles = program.command("profiles").description("Inspect configured execution profiles");

repositories
  .command("list")
  .action(async () => {
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

repoRules
  .command("list")
  .action(async () => {
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
    const [{ ensureArcheReady }, { createManualRunForTicket }] = await Promise.all([
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
  .action(async (runId, options: { kind?: string; follow?: boolean; json?: boolean }) => {
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
  });

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
  .option("--host <host>", "host to bind", defaultInstallEnvValues.ARCHE_SERVER_HOST)
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
  if (value === "events" || value === "logs" || value === "commands" || value === "all") {
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
      timestamp: typeof command.timestamp === "string" ? command.timestamp : null,
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
      logs: logsPage.items.length > 0 ? Number(logsPage.items.at(-1)?.id ?? cursors.logs) : cursors.logs,
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

function updateLogCursors(cursors: LogCursorState, batch: { latestIds: LogCursorState }) {
  cursors.logs = batch.latestIds.logs;
  cursors.events = batch.latestIds.events;
  cursors.commands = batch.latestIds.commands;
}

function formatLogEntry(entry: TimelineEntry) {
  const timestamp = entry.timestamp ?? "-";
  return `${timestamp} ${entry.message}`;
}

async function promptInstallEnv(current: InstallEnvValues, hasExistingEnv: boolean) {
  if (hasExistingEnv) {
    p.note("Review the values below and adjust only what changed.", "Existing configuration");
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
      "Arche V2 uses OpenAI-compatible HTTP profiles from orchestrator.yml.",
      "ARCHE_DEFAULT_API_KEY is a convenience secret for the default profile; other profiles can reference any env var.",
    ].join("\n"),
    "Execution profiles",
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

  const updateDefaultApiKey = guardPrompt(
    await p.confirm({
      message: "Configure or update ARCHE_DEFAULT_API_KEY now?",
      initialValue: current.ARCHE_DEFAULT_API_KEY.trim().length === 0,
    }),
  );

  const defaultApiKey = updateDefaultApiKey
    ? guardPrompt(
        await p.password({
          message: "Default API key",
          mask: "*",
          validate: validateRequired,
        }),
      )
    : current.ARCHE_DEFAULT_API_KEY;

  const configureJira = guardPrompt(
    await p.confirm({
      message: "Configure Jira now?",
      initialValue: hasAnyValue(
        current.ARCHE_JIRA_BASE_URL,
        current.ARCHE_JIRA_EMAIL,
        current.ARCHE_JIRA_API_TOKEN,
        current.ARCHE_JIRA_WEBHOOK_SECRET,
      ),
    }),
  );

  const jiraValues = configureJira
    ? await (async () => {
        const baseUrl = guardPrompt(
          await p.text({
            message: "Jira base URL",
            initialValue: current.ARCHE_JIRA_BASE_URL,
            placeholder: "https://jira.example.com",
            validate: validateUrl,
          }),
        );

        const email = guardPrompt(
          await p.text({
            message: "Jira technical user email",
            initialValue: current.ARCHE_JIRA_EMAIL,
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

        p.note(
          [
            "This is the shared secret Arche uses to verify incoming Jira webhook requests.",
            "Use the same value in Jira and send it as the x-arche-webhook-secret header.",
          ].join("\n"),
          "Jira webhook secret",
        );

        const webhookSecret = guardPrompt(
          await p.password({
            message: "Jira webhook secret",
            mask: "*",
            validate: validateRequired,
          }),
        );

        return {
          ARCHE_JIRA_BASE_URL: baseUrl,
          ARCHE_JIRA_EMAIL: email,
          ARCHE_JIRA_API_TOKEN: apiToken,
          ARCHE_JIRA_WEBHOOK_SECRET: webhookSecret,
        };
      })()
    : {
        ARCHE_JIRA_BASE_URL: "",
        ARCHE_JIRA_EMAIL: "",
        ARCHE_JIRA_API_TOKEN: "",
        ARCHE_JIRA_WEBHOOK_SECRET: "",
      };

  const configureGitLab = guardPrompt(
    await p.confirm({
      message: "Configure GitLab now?",
      initialValue: hasAnyValue(current.ARCHE_GITLAB_BASE_URL, current.ARCHE_GITLAB_TOKEN),
    }),
  );

  const gitlabValues = configureGitLab
    ? {
        ARCHE_GITLAB_BASE_URL: guardPrompt(
          await p.text({
            message: "GitLab base URL",
            initialValue: current.ARCHE_GITLAB_BASE_URL,
            placeholder: "https://gitlab.example.com",
            validate: validateUrl,
          }),
        ),
        ARCHE_GITLAB_TOKEN: guardPrompt(
          await p.password({
            message: "GitLab token",
            mask: "*",
            validate: validateRequired,
          }),
        ),
      }
    : {
        ARCHE_GITLAB_BASE_URL: "",
        ARCHE_GITLAB_TOKEN: "",
      };

  return {
    ...current,
    DATABASE_URL: databaseUrl,
    ARCHE_CONFIG_PATH: configPath,
    ARCHE_RUNTIME_ROOT: runtimeRoot,
    ARCHE_SERVER_HOST: current.ARCHE_SERVER_HOST,
    ARCHE_SERVER_AUTH_TOKEN: serverAuthToken,
    ARCHE_LOG_LEVEL: logLevel,
    ARCHE_DEFAULT_API_KEY: defaultApiKey,
    ...jiraValues,
    ...gitlabValues,
  };
}

function validateRequired(value: string | undefined) {
  if (!value?.trim()) {
    return "Value is required";
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
