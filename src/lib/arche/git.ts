import { dirname, resolve } from "node:path";
import { access, rm } from "node:fs/promises";
import { constants } from "node:fs";

import type { OrchestratorConfig } from "../config";
import type { RepositoryRow } from "../db/schema";
import { env } from "../env";
import { ExternalServiceError } from "./errors";
import type { JiraIssue } from "./types";
import {
  ensureDirectory,
  resolvePathInsideRoot,
  runCommand,
  slugifyBranchSegment,
  writeTempFile,
} from "./utils";

function normalizePatchPath(path: string) {
  const trimmed = path.trim().replace(/^"(.*)"$/, "$1");
  if (trimmed === "/dev/null") {
    return null;
  }
  const withoutPrefix = trimmed.replace(/^[ab]\//, "");
  const withoutMetadata = withoutPrefix.split("\t")[0]?.trim() ?? withoutPrefix;
  return withoutMetadata;
}

function extractPatchPaths(patch: string) {
  const paths: string[] = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      if (match) {
        paths.push(match[1], match[2]);
      }
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const candidate = normalizePatchPath(line.slice(4));
      if (candidate) {
        paths.push(candidate);
      }
      continue;
    }
    if (line.startsWith("rename from ") || line.startsWith("rename to ")) {
      const candidate = normalizePatchPath(line.replace(/^rename (from|to)\s+/, ""));
      if (candidate) {
        paths.push(candidate);
      }
      continue;
    }
  }
  return paths;
}

export class GitManager {
  constructor(private readonly config: OrchestratorConfig) {}

  private async configureCommitIdentity(worktreePath: string) {
    const commands = [
      ["-C", worktreePath, "config", "user.name", env.ARCHE_GIT_AUTHOR_NAME],
      ["-C", worktreePath, "config", "user.email", env.ARCHE_GIT_AUTHOR_EMAIL],
    ];

    for (const args of commands) {
      const result = await runCommand("git", args);
      if (result.returncode !== 0) {
        throw new ExternalServiceError(result.stderr || result.stdout || "Git identity configuration failed");
      }
    }
  }

  private async ensureChangesReadyToCommit(worktreePath: string, issue: JiraIssue) {
    const result = await runCommand("git", ["-C", worktreePath, "diff", "--cached", "--quiet", "--exit-code"]);
    if (result.returncode === 1) {
      return;
    }
    if (result.returncode === 0) {
      throw new ExternalServiceError(`No changes to commit for ${issue.key}`, "git_nothing_to_commit");
    }
    throw new ExternalServiceError(result.stderr || result.stdout || "Git diff failed");
  }

  async ensureLocalClone(repository: RepositoryRow) {
    await ensureDirectory(dirname(repository.localMirrorPath));
    let cloned = true;
    try {
      await access(resolve(repository.localMirrorPath, ".git"), constants.F_OK);
    } catch {
      cloned = false;
    }
    if (!cloned) {
      const clone = await runCommand("git", ["clone", repository.remoteUrl, repository.localMirrorPath]);
      if (clone.returncode !== 0) {
        throw new ExternalServiceError(clone.stderr || "Repository clone failed");
      }
    }
    const fetchResult = await runCommand("git", ["-C", repository.localMirrorPath, "fetch", "origin"]);
    if (fetchResult.returncode !== 0) {
      throw new ExternalServiceError(fetchResult.stderr || "Repository fetch failed");
    }
    return repository.localMirrorPath;
  }

  buildBranchName(issue: JiraIssue) {
    return `jira/${issue.key}-${slugifyBranchSegment(issue.title)}`;
  }

  async createWorktree(repository: RepositoryRow, branchName: string, issueKey: string) {
    await this.ensureLocalClone(repository);
    const worktreePath = resolve(this.config.runtime.runs_dir, issueKey, branchName.replaceAll("/", "-"));
    await ensureDirectory(dirname(worktreePath));
    await this.cleanupWorktree(repository, worktreePath);
    const result = await runCommand("git", [
      "-C",
      repository.localMirrorPath,
      "worktree",
      "add",
      worktreePath,
      "-b",
      branchName,
      `origin/${repository.defaultBranch}`,
    ]);
    if (result.returncode !== 0) {
      throw new ExternalServiceError(result.stderr || "Worktree creation failed");
    }
    return worktreePath;
  }

  async cleanupWorktree(repository: RepositoryRow, worktreePath: string) {
    await runCommand("git", [
      "-C",
      repository.localMirrorPath,
      "worktree",
      "remove",
      worktreePath,
      "--force",
    ]);
    await rm(worktreePath, { recursive: true, force: true });
  }

  async applyPatch(worktreePath: string, patch: string) {
    for (const patchPath of extractPatchPaths(patch)) {
      if (!resolvePathInsideRoot(worktreePath, patchPath)) {
        throw new ExternalServiceError(
          `Patch path escapes repository root: ${patchPath}`,
          "patch_path_invalid",
        );
      }
    }
    const patchFile = await writeTempFile(worktreePath, ".patch", patch);
    const check = await runCommand("git", ["-C", worktreePath, "apply", "--check", patchFile]);
    if (check.returncode !== 0) {
      throw new ExternalServiceError(check.stderr || "Patch validation failed");
    }
    const apply = await runCommand("git", ["-C", worktreePath, "apply", patchFile]);
    if (apply.returncode !== 0) {
      throw new ExternalServiceError(apply.stderr || "Patch application failed");
    }
  }

  async diffExcerpt(worktreePath: string) {
    const result = await runCommand("git", ["-C", worktreePath, "diff", "--stat", "--patch"]);
    if (result.returncode !== 0) {
      throw new ExternalServiceError(result.stderr || "Git diff failed");
    }
    return result.stdout.slice(0, 20000);
  }

  async diffStats(worktreePath: string) {
    const result = await runCommand("git", ["-C", worktreePath, "diff", "--numstat"]);
    if (result.returncode !== 0) {
      throw new ExternalServiceError(result.stderr || "Diff stats failed");
    }

    let changedFiles = 0;
    let changedLines = 0;

    for (const line of result.stdout.split("\n")) {
      if (!line.trim()) continue;
      const [added, removed] = line.split("\t");
      changedFiles += 1;
      changedLines += (added === "-" ? 0 : Number(added)) + (removed === "-" ? 0 : Number(removed));
    }

    return { changedFiles, changedLines };
  }

  async commitAndPush(
    repository: RepositoryRow,
    worktreePath: string,
    branchName: string,
    issue: JiraIssue,
  ) {
    await this.configureCommitIdentity(worktreePath);

    const addResult = await runCommand("git", ["-C", worktreePath, "add", "-A"]);
    if (addResult.returncode !== 0) {
      throw new ExternalServiceError(addResult.stderr || addResult.stdout || "Git publish failed");
    }

    await this.ensureChangesReadyToCommit(worktreePath, issue);

    const commands = [
      ["-C", worktreePath, "commit", "-m", `${issue.key}: ${issue.title}`],
      ["-C", worktreePath, "push", "-u", "origin", branchName],
    ];

    for (const args of commands) {
      const result = await runCommand("git", args);
      if (result.returncode !== 0) {
        if ((result.stderr || result.stdout).toLowerCase().includes("nothing to commit")) {
          throw new ExternalServiceError(`No changes to commit for ${issue.key}`, "git_nothing_to_commit");
        }
        throw new ExternalServiceError(result.stderr || result.stdout || "Git publish failed");
      }
    }
  }

  async trackedFiles(worktreePath: string) {
    const result = await runCommand("git", ["-C", worktreePath, "ls-files"]);
    if (result.returncode !== 0) {
      return [];
    }
    return result.stdout.split("\n").filter(Boolean);
  }
}
