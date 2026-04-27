import { execFile, fork, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import * as p from "@clack/prompts";
import type { Command } from "commander";

import { printArcheBanner } from "../lib/arche/banner";
import {
  archePackageRootDir,
  bundledEnvTemplatePath,
  bundledSandboxDockerfilePath,
  guardPrompt,
  pathExists,
  validateRequired,
  validateUrl,
} from "../lib/cli-helpers";
import { inferProvider, inferRepoName } from "../lib/git-utils";
import {
  applyEnvToProcess,
  databaseUrlForRuntimeRoot,
  defaultInstallEnvValues,
  mergeInitOrchestratorConfig,
  preserveUnmanagedEnvValues,
  readEnvFile,
  readInitOrchestratorConfig,
  resolveArcheProjectEnvPath,
  resolveInstallEnvValues,
  USER_OPENROUTER_API_KEY_ENV,
  writeInitOrchestratorConfig,
  writeInstallEnvFile,
  type InstallEnvValues,
} from "../lib/install";

const execFileAsync = promisify(execFile);

const SANDBOX_IMAGE = "arche-app:local";

export function register(program: Command) {
  program
    .command("onboard")
    .description(
      "One-command setup: configure Arche and register the current git repository",
    )
    .action(async () => {
      printArcheBanner();
      p.intro("Onboard a repository to Arche");

      // ── Step 1: detect current git repo ──────────────────────────────────
      const detected = await detectGitRepo();
      if (!detected) {
        p.log.error(
          "No git repository with a remote 'origin' found in the current directory.\n" +
            "Run this command from the root of a git repository.",
        );
        process.exit(1);
      }

      const { remoteUrl, defaultBranch } = detected;
      const repoName = inferRepoName(remoteUrl);
      const provider = inferProvider(remoteUrl);

      p.log.info(
        `Detected: ${repoName} · ${remoteUrl} · branch: ${defaultBranch} · provider: ${provider}`,
      );

      // ── Step 2: init Arche if not already configured ─────────────────────
      const envPath = resolveArcheProjectEnvPath();
      const alreadyInitialized = await pathExists(envPath);

      if (!alreadyInitialized) {
        await runQuickInit(provider);
      } else {
        p.log.step("Arche environment found — skipping configuration.");
        const existingValues = await readEnvFile(envPath);
        applyEnvToProcess(existingValues);
      }

      // ── Step 3: initialize runtime (dirs + DB) ───────────────────────────
      const runtimeSpinner = p.spinner();
      runtimeSpinner.start("Initializing Arche runtime");
      const { ensureArcheReady } = await import("../lib/bootstrap");
      await ensureArcheReady();
      runtimeSpinner.stop("Runtime ready");

      // ── Step 4: ensure sandbox image ─────────────────────────────────────
      await ensureSandboxImage();

      // ── Step 5: register repo in DB ───────────────────────────────────────
      await registerRepo({ repoName, remoteUrl, defaultBranch, provider });

      // ── Step 6: start services ────────────────────────────────────────────
      // ── Step 6: offer to create .arche/instructions.md ───────────────────────
      await ensureInstructionsFile(repoName);

      const startNow = guardPrompt(
        await p.confirm({
          message: "Start Arche now?",
          initialValue: true,
        }),
      );

      p.outro(
        startNow
          ? "Starting Arche…"
          : 'Run "arche up" when ready. Trigger a run with: arche runs manual <JIRA-KEY>',
      );

      if (startNow) {
        await startArche();
      }
    });
}

async function ensureInstructionsFile(repoName: string) {
  const filePath = join(process.cwd(), ".arche", "instructions.md");
  if (await pathExists(filePath)) {
    p.log.step(".arche/instructions.md already exists — agent will use it as context.");
    return;
  }
  const create = guardPrompt(
    await p.confirm({
      message: "Create .arche/instructions.md? (agent conventions, coding style, SOPs)",
      initialValue: true,
    }),
  );
  if (!create) return;
  const template = `# Agent Instructions for ${repoName}

## Code style
<!-- e.g. Always use Tailwind, never CSS modules -->

## Testing
<!-- e.g. Every new function must have at least one test -->

## Conventions
<!-- e.g. Go errors: wrap with fmt.Errorf("context: %w", err) -->
`;
  await mkdir(join(process.cwd(), ".arche"), { recursive: true });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(filePath, template, "utf8");
  p.log.success(`.arche/instructions.md created — edit it to guide the agent.`);
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function detectGitRepo(): Promise<{
  remoteUrl: string;
  defaultBranch: string;
} | null> {
  try {
    const { stdout: remoteRaw } = await execFileAsync("git", [
      "remote",
      "get-url",
      "origin",
    ]);
    const remoteUrl = remoteRaw.trim();
    if (!remoteUrl) return null;

    let defaultBranch = "main";
    try {
      const { stdout: branchRaw } = await execFileAsync("git", [
        "symbolic-ref",
        "--short",
        "HEAD",
      ]);
      defaultBranch = branchRaw.trim() || "main";
    } catch {
      // keep "main"
    }

    return { remoteUrl, defaultBranch };
  } catch {
    return null;
  }
}


async function runQuickInit(provider: "github" | "gitlab") {
  p.log.step("Configuring Arche (first-time setup)");

  const templatePath = bundledEnvTemplatePath();
  const exampleValues = await readEnvFile(templatePath);
  const managedValues = resolveInstallEnvValues({ exampleValues });

  // ── OpenRouter API key ───────────────────────────────────────────────────
  p.note(
    "Arche uses OpenRouter to call LLM models.\nCreate a free key at https://openrouter.ai/keys",
    "OpenRouter",
  );
  const openRouterKey = guardPrompt(
    await p.password({
      message: `${USER_OPENROUTER_API_KEY_ENV} — paste your OpenRouter key`,
      mask: "*",
      validate: validateRequired,
    }),
  );

  // ── Provider token ───────────────────────────────────────────────────────
  const providerLabel = provider === "github" ? "GitHub" : "GitLab";
  const providerEnvKey =
    provider === "github" ? "USER_GITHUB_TOKEN" : "USER_GITLAB_TOKEN";
  p.note(
    provider === "github"
      ? "Needed to clone, push, and open pull requests.\nCreate a PAT with repo scope at https://github.com/settings/tokens"
      : "Used for clone/push (HTTPS) and merge request creation via API.\nCreate a token at https://gitlab.com/-/user_settings/personal_access_tokens",
    `${providerLabel} token`,
  );
  const providerToken = guardPrompt(
    await p.password({
      message: `${providerLabel} personal access token`,
      mask: "*",
      validate: validateRequired,
    }),
  );

  // ── Jira (optional) ──────────────────────────────────────────────────────
  const configureJira = guardPrompt(
    await p.confirm({
      message: "Configure Jira now? (skip if you want to trigger runs manually)",
      initialValue: false,
    }),
  );

  let jiraValues = {
    USER_JIRA_BASE_URL: "",
    USER_JIRA_EMAIL: "",
    USER_JIRA_API_TOKEN: "",
  };

  if (configureJira) {
    const baseUrl = guardPrompt(
      await p.text({
        message: "Jira base URL",
        placeholder: "https://yourcompany.atlassian.net",
        validate: validateUrl,
      }),
    );
    const email = guardPrompt(
      await p.text({
        message: "Jira user email",
        placeholder: "agent-dev@yourcompany.com",
        validate: validateRequired,
      }),
    );
    p.note(
      "Generate at https://id.atlassian.com/manage-profile/security/api-tokens",
      "Jira API token",
    );
    const apiToken = guardPrompt(
      await p.password({
        message: "Jira API token",
        mask: "*",
        validate: validateRequired,
      }),
    );
    jiraValues = {
      USER_JIRA_BASE_URL: baseUrl,
      USER_JIRA_EMAIL: email,
      USER_JIRA_API_TOKEN: apiToken,
    };
  }

  // ── Assemble and write env ────────────────────────────────────────────────
  const nextValues: InstallEnvValues = {
    ...managedValues,
    [USER_OPENROUTER_API_KEY_ENV]: openRouterKey,
    ...(provider === "github"
      ? { USER_GITHUB_TOKEN: providerToken }
      : { USER_GITLAB_TOKEN: providerToken }),
    ...jiraValues,
  };

  const envPath = resolveArcheProjectEnvPath();
  await mkdir(dirname(envPath), { recursive: true });
  const preserved = preserveUnmanagedEnvValues({ exampleValues });
  await writeInstallEnvFile(envPath, nextValues, preserved);
  applyEnvToProcess({ ...preserved, ...nextValues });
  p.log.success(`Environment written: ${envPath}`);

  // ── Write orchestrator.yml ────────────────────────────────────────────────
  const orchestratorPath = resolve(
    nextValues.ARCHE_CONFIG_PATH || "./orchestrator.yml",
  );
  if (!(await pathExists(orchestratorPath))) {
    const { rawConfig, values: orchValues } =
      await readInitOrchestratorConfig(orchestratorPath);
    const nextConfig = mergeInitOrchestratorConfig(rawConfig, orchValues);
    await mkdir(dirname(orchestratorPath), { recursive: true });
    await writeInitOrchestratorConfig(orchestratorPath, nextConfig);
    p.log.success(`Orchestrator config written: ${orchestratorPath}`);
  }
}

async function sandboxImageExists(): Promise<boolean> {
  try {
    await execFileAsync("docker", ["image", "inspect", SANDBOX_IMAGE]);
    return true;
  } catch {
    return false;
  }
}

async function ensureSandboxImage() {
  if (await sandboxImageExists()) {
    p.log.step(`Sandbox image ${SANDBOX_IMAGE} already present — skipping build.`);
    return;
  }

  const build = guardPrompt(
    await p.confirm({
      message: `Build the default sandbox image (${SANDBOX_IMAGE})? This takes ~3 minutes and only runs once.`,
      initialValue: true,
    }),
  );

  if (!build) {
    p.log.warn(
      `Sandbox image skipped. Runs will fail until you provide a Docker image tagged "${SANDBOX_IMAGE}".\n` +
        `Build later: docker build -t ${SANDBOX_IMAGE} -f ${bundledSandboxDockerfilePath()} --no-cache /tmp`,
    );
    return;
  }

  p.log.step(`Building ${SANDBOX_IMAGE} (streaming Docker output below)…`);

  const dockerfilePath = bundledSandboxDockerfilePath();
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      "docker",
      ["build", "-t", SANDBOX_IMAGE, "-f", dockerfilePath, "/tmp"],
      { stdio: "inherit" },
    );
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`docker build exited with code ${code}`));
      }
    });
    proc.on("error", reject);
  });

  p.log.success(`Sandbox image ${SANDBOX_IMAGE} built successfully.`);
}

async function registerRepo(options: {
  repoName: string;
  remoteUrl: string;
  defaultBranch: string;
  provider: "github" | "gitlab";
}) {
  const { createRepository, createRepoRule, listRepositories } = await import(
    "../lib/arche/runs"
  );

  // Check if repo already registered
  const existing = await listRepositories();
  const alreadyRegistered = existing.some(
    (r) => r.name === options.repoName || r.remoteUrl === options.remoteUrl,
  );

  if (alreadyRegistered) {
    p.log.step(`Repository "${options.repoName}" already registered — skipping.`);
    return;
  }

  const { getConfig } = await import("../lib/config");
  const config = await getConfig();

  const localMirrorPath = resolve(config.runtime.repos_dir, options.repoName);

  const repo = await createRepository({
    name: options.repoName,
    gitProvider: options.provider === "github" ? "github" : "gitlab",
    remoteUrl: options.remoteUrl,
    localMirrorPath,
    defaultBranch: options.defaultBranch,
    enabled: true,
    gitlabProjectId: null,
    allowedCommands: [],
    validationCommands: [],
    instructions: null,
    enabledTools: null,
  });

  p.log.success(`Repository registered: ${repo.name}`);

  // Create a default catch-all routing rule
  const rule = await createRepoRule({
    name: `${options.repoName}-default`,
    repositoryId: repo.id,
    jiraProjectKey: null,
    label: null,
    issueType: null,
    priority: 100,
    enabled: true,
  });

  p.log.success(`Default routing rule created: ${rule.name}`);
}

async function startArche() {
  const root = archePackageRootDir();
  const distServer = join(root, "dist", "server.js");
  const isBundled = existsSync(distServer);

  const serverPath = isBundled
    ? distServer
    : join(root, "src", "bin", "server.ts");
  const workerPath = isBundled
    ? join(root, "dist", "worker", "main.js")
    : join(root, "src", "bin", "worker.ts");

  const forkOptions = {
    stdio: "inherit" as const,
    env: { ...process.env },
    execArgv: isBundled ? [] : ["--import", "tsx"],
  };

  const children: ReturnType<typeof fork>[] = [];

  process.on("SIGINT", () => {
    for (const child of children) child.kill("SIGTERM");
  });
  process.on("SIGTERM", () => {
    for (const child of children) child.kill("SIGTERM");
  });

  console.log("Starting Arche server on 127.0.0.1:8787…");
  children.push(fork(serverPath, [], forkOptions));

  console.log("Starting Arche worker…");
  children.push(fork(workerPath, [], forkOptions));

  await new Promise((resolve) => setTimeout(resolve, 2000));

  const dashboardUrl = "http://127.0.0.1:8787/dashboard";
  console.log(`\nDashboard: ${dashboardUrl}`);
  console.log("Trigger a run:  arche runs manual <JIRA-KEY>\n");

  const { exec } = await import("node:child_process");
  const { platform } = await import("node:os");
  const openCmd =
    platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  exec(`${openCmd} ${dashboardUrl}`);

  await Promise.all(
    children.map(
      (child) => new Promise<void>((resolve) => child.on("exit", () => resolve())),
    ),
  );
}
