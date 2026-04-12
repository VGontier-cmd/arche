import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import * as p from "@clack/prompts";
import type { Command } from "commander";

import { printArcheBanner } from "../lib/arche/banner";
import {
  bundledEnvTemplatePath,
  cliLogger,
  guardPrompt,
  hasAnyValue,
  pathExists,
  printJson,
  validateRequired,
  validateUrl,
} from "../lib/cli-helpers";
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
} from "../lib/install";
import { runInitHostPrereqsFlow } from "../lib/install/host-prereqs";

export function register(program: Command) {
  program
    .command("init")
    .description(
      "Initialize runtime directories and project environment (.arche/environment)",
    )
    .option("--yes", "skip prompts and accept inferred defaults")
    .option("--force", "overwrite existing .arche/environment")
    .option(
      "--skip-host-prereqs",
      "skip Git / Node 22+ / Docker check and optional installer",
    )
    .action(
      async (options: {
        yes?: boolean;
        force?: boolean;
        skipHostPrereqs?: boolean;
      }) => {
        printArcheBanner();

        const envPath = resolveArcheProjectEnvPath();
        const templatePath = bundledEnvTemplatePath();
        const hasExistingProjectEnv =
          (await pathExists(envPath)) &&
          envFileHasNonEmptyValues(await readEnvFile(envPath));
        const exampleValues = await readEnvFile(templatePath);
        const existingValues = await readEnvFile(envPath);
        const hadPriorEnvOnDisk = envFileHasNonEmptyValues(existingValues);
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
          p.intro("Initialize Arche");
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
        let selectedSharedModel: string =
          defaultInitOrchestratorValues.sharedModel;
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
        const hasExistingOrchestratorConfig =
          await pathExists(orchestratorPath);
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

        if (interactive && !options.skipHostPrereqs) {
          await runInitHostPrereqsFlow();
        }

        const spinner = interactive ? p.spinner() : null;
        spinner?.start("Preparing Arche runtime");

        const [{ ensureArcheReady }, { getConfig }] = await Promise.all([
          import("../lib/bootstrap"),
          import("../lib/config"),
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
              "2) Register a repository (and optional Jira routing rule)",
              "   arche setup wizard",
              "   # or: arche repositories add … then arche repo-rules add …",
              "",
              "3) Start services",
              "   arche up",
              "",
              "4) Trigger a run manually",
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
      },
    );
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
        {
          value: "openai/gpt-5.4-mini",
          label: "openai/gpt-5.4-mini",
          hint: "default balanced choice",
        },
        {
          value: "openai/gpt-5.4",
          label: "openai/gpt-5.4",
          hint: "stronger reasoning, higher cost",
        },
        {
          value: "anthropic/claude-3.7-sonnet",
          label: "anthropic/claude-3.7-sonnet",
          hint: "good coding reviewer profile",
        },
        {
          value: "google/gemini-2.5-pro",
          label: "google/gemini-2.5-pro",
          hint: "broad capabilities",
        },
        {
          value: "meta-llama/llama-4-maverick",
          label: "meta-llama/llama-4-maverick",
          hint: "alternative open model",
        },
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
    ? await (async () => {
        const baseUrl = guardPrompt(
          await p.text({
            message: "GitLab base URL",
            initialValue: current.USER_GITLAB_BASE_URL,
            placeholder: "https://gitlab.example.com",
            validate: validateUrl,
          }),
        );
        p.note(
          [
            "Same token is used for GitLab REST API (e.g. merge requests) and for git clone/fetch/push",
            "over HTTPS when the repository remote URL matches this base URL (no token in the DB).",
          ].join("\n"),
          "GitLab token",
        );
        const token = guardPrompt(
          await p.password({
            message: "GitLab token (API + private Git HTTPS)",
            mask: "*",
            validate: validateRequired,
          }),
        );
        return {
          USER_GITLAB_BASE_URL: baseUrl,
          USER_GITLAB_TOKEN: token,
        };
      })()
    : {
        USER_GITLAB_BASE_URL: "",
        USER_GITLAB_TOKEN: "",
      };

  const configureGitHub = guardPrompt(
    await p.confirm({
      message:
        "Configure a GitHub.com token for private HTTPS Git (optional)?",
      initialValue: Boolean(current.USER_GITHUB_TOKEN?.trim()),
    }),
  );

  const githubValues = configureGitHub
    ? {
        USER_GITHUB_TOKEN: guardPrompt(
          await p.password({
            message:
              "GitHub personal access token (repo scope for private clone/push)",
            mask: "*",
            validate: validateRequired,
          }),
        ),
      }
    : {
        USER_GITHUB_TOKEN: "",
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
      ...githubValues,
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
