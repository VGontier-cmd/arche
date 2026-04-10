import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as p from "@clack/prompts";

export const HOST_PREREQS_MIN_NODE_MAJOR = 22;

export type HostPrereqsStatus = {
  gitOk: boolean;
  nodeOk: boolean;
  dockerOk: boolean;
};

function hostPrereqsScriptPath(packageRoot: string): string {
  return join(packageRoot, "scripts", "install-host-prereqs.sh");
}

/** Resolves the npm package / repo root that contains `scripts/install-host-prereqs.sh`. */
export function resolveArchePackageRootForScripts(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(join(here, "..", "..", "..")), resolve(join(here, ".."))];
  for (const root of candidates) {
    if (existsSync(hostPrereqsScriptPath(root))) {
      return root;
    }
  }
  return resolve(join(here, ".."));
}

export async function getHostPrereqsStatus(): Promise<HostPrereqsStatus> {
  const { runCommand } = await import("../arche/utils");
  const gitOk =
    (await runCommand("git", ["--version"], { label: "git --version" }))
      .returncode === 0;
  const nodeMajor = parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  const nodeOk =
    Number.isFinite(nodeMajor) && nodeMajor >= HOST_PREREQS_MIN_NODE_MAJOR;
  const dockerOk =
    (
      await runCommand("docker", ["version", "--format", "{{.Server.Version}}"], {
        label: "docker version (server)",
      })
    ).returncode === 0;
  return { gitOk, nodeOk, dockerOk };
}

function hostPrereqsScriptExists(packageRoot: string): boolean {
  return existsSync(hostPrereqsScriptPath(packageRoot));
}

export async function runHostPrereqsShellScript(
  packageRoot: string,
  args: string[],
): Promise<number> {
  const script = hostPrereqsScriptPath(packageRoot);
  return new Promise((resolveCode, reject) => {
    const child = spawn("bash", [script, ...args], {
      stdio: "inherit",
      cwd: packageRoot,
      env: process.env,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolveCode(code ?? 1);
    });
  });
}

/**
 * Interactive-only: check Git / Node / Docker with a Clack progress bar, then offer
 * `scripts/install-host-prereqs.sh --yes` if something is missing.
 */
export async function runInitHostPrereqsFlow(): Promise<void> {
  const packageRoot = resolveArchePackageRootForScripts();
  if (!hostPrereqsScriptExists(packageRoot)) {
    p.log.warn(
      "Host prerequisites script not found (install from the Arche repo or npm package with scripts/). Skipping.",
    );
    return;
  }

  const bar = p.progress({ max: 3 });
  bar.start("Checking host prerequisites");

  const { runCommand } = await import("../arche/utils");
  const gitOk =
    (await runCommand("git", ["--version"], { label: "git --version" }))
      .returncode === 0;
  bar.advance(1, gitOk ? "Git" : "Git missing");

  const nodeMajor = parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  const nodeOk =
    Number.isFinite(nodeMajor) && nodeMajor >= HOST_PREREQS_MIN_NODE_MAJOR;
  bar.advance(1, nodeOk ? "Node.js" : `Node.js (need ${HOST_PREREQS_MIN_NODE_MAJOR}+)`);

  const dockerOk =
    (
      await runCommand("docker", ["version", "--format", "{{.Server.Version}}"], {
        label: "docker version (server)",
      })
    ).returncode === 0;
  bar.advance(1, dockerOk ? "Docker daemon" : "Docker daemon unreachable");

  const allOk = gitOk && nodeOk && dockerOk;
  bar.stop(
    allOk
      ? "Host tools look good for Arche"
      : "Some host tools are missing or need attention",
  );

  if (allOk) {
    return;
  }

  const runInstall = await p.confirm({
    message:
      "Install or fix Git, Node 22+, and Docker now? (uses Homebrew on macOS; apt + sudo on Debian/Ubuntu)",
    initialValue: true,
  });
  if (p.isCancel(runInstall) || !runInstall) {
    p.note("Skipped. Later you can run: npm run install-prereqs", "Host prerequisites");
    return;
  }

  const spin = p.spinner();
  spin.start(
    "Running host prerequisites installer (may take several minutes, sudo on Linux)…",
  );
  const code = await runHostPrereqsShellScript(packageRoot, ["--yes"]);
  if (code === 0) {
    spin.stop("Host prerequisites installer finished");
  } else {
    spin.stop("Host prerequisites installer reported an error");
    p.log.warn(`Fix issues manually, then run: arche doctor`);
  }
}
