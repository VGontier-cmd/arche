import { dirname, resolve } from "node:path";
import { access, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";

import type { OrchestratorConfig } from "../config";
import type { RepositoryRow } from "../db/schema";
import { env } from "../env";
import { resolveAuthenticatedRemoteUrl } from "./git-remote-auth";
import { ExternalServiceError } from "./errors";
import type { JiraIssue } from "./types";
import {
  ensureDirectory,
  slugifyBranchSegment,
  resolvePathInsideRoot,
  runCommand,
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

/**
 * Detects the "*** Begin Patch / *** End Patch" format commonly produced by
 * LLMs (Codex, GPT, etc.) instead of standard unified diff.
 */
export function isBeginEndPatchFormat(patch: string) {
  return /\*\*\*\s*(Begin Patch|Update File|Add File|Delete File)/i.test(patch);
}

type PatchFileBlock = {
  action: "update" | "add" | "delete";
  path: string;
  lines: string[];
};

function parseBeginEndPatch(patch: string): PatchFileBlock[] {
  const blocks: PatchFileBlock[] = [];
  const lines = patch.split("\n");
  let current: PatchFileBlock | null = null;

  for (const line of lines) {
    const updateMatch = /^\*\*\*\s*Update File:\s*(.+)/i.exec(line);
    if (updateMatch) {
      current = { action: "update", path: updateMatch[1].trim(), lines: [] };
      blocks.push(current);
      continue;
    }
    const addMatch = /^\*\*\*\s*Add File:\s*(.+)/i.exec(line);
    if (addMatch) {
      current = { action: "add", path: addMatch[1].trim(), lines: [] };
      blocks.push(current);
      continue;
    }
    const deleteMatch = /^\*\*\*\s*Delete File:\s*(.+)/i.exec(line);
    if (deleteMatch) {
      current = { action: "delete", path: deleteMatch[1].trim(), lines: [] };
      blocks.push(current);
      continue;
    }
    if (/^\*\*\*\s*(Begin Patch|End Patch)/i.test(line)) {
      continue;
    }
    if (current && line !== "@@") {
      current.lines.push(line);
    }
  }
  return blocks;
}

/**
 * Converts a "Begin Patch" format patch to unified diff by reading the
 * original files from the worktree to produce correct context and line numbers.
 */
export async function convertBeginEndPatchToUnifiedDiff(
  worktreePath: string,
  patch: string,
): Promise<string> {
  const blocks = parseBeginEndPatch(patch);
  const diffs: string[] = [];

  for (const block of blocks) {
    const filePath = block.path;
    const aPath = `a/${filePath}`;
    const bPath = `b/${filePath}`;

    if (block.action === "delete") {
      let originalLines: string[] = [];
      try {
        const content = await readFile(resolve(worktreePath, filePath), "utf8");
        originalLines = content.split("\n");
      } catch {
        // File missing — skip this block.
        continue;
      }
      diffs.push(
        `diff --git ${aPath} ${bPath}`,
        `deleted file mode 100644`,
        `--- ${aPath}`,
        `+++ /dev/null`,
        `@@ -1,${originalLines.length} +0,0 @@`,
        ...originalLines.map((l) => `-${l}`),
      );
      continue;
    }

    if (block.action === "add") {
      const newLines = block.lines.map((l) =>
        l.startsWith("+") ? l.slice(1) : l,
      );
      diffs.push(
        `diff --git ${aPath} ${bPath}`,
        `new file mode 100644`,
        `--- /dev/null`,
        `+++ ${bPath}`,
        `@@ -0,0 +1,${newLines.length} @@`,
        ...newLines.map((l) => `+${l}`),
      );
      continue;
    }

    // "update" — match context lines against the original file to find the
    // right position, then emit a proper unified diff hunk.
    let originalLines: string[] = [];
    try {
      const content = await readFile(resolve(worktreePath, filePath), "utf8");
      originalLines = content.split("\n");
    } catch {
      continue;
    }

    // Build hunks by finding context anchors in the original file.
    const patchLines = block.lines;
    const hunks = buildHunksFromContextPatch(originalLines, patchLines);

    if (hunks.length === 0) {
      continue;
    }

    diffs.push(
      `diff --git ${aPath} ${bPath}`,
      `--- ${aPath}`,
      `+++ ${bPath}`,
    );
    for (const hunk of hunks) {
      diffs.push(
        `@@ -${hunk.origStart},${hunk.origCount} +${hunk.newStart},${hunk.newCount} @@`,
        ...hunk.lines,
      );
    }
  }

  return diffs.join("\n") + "\n";
}

type DiffHunk = {
  origStart: number;
  origCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
};

function buildHunksFromContextPatch(
  originalLines: string[],
  patchLines: string[],
): DiffHunk[] {
  // Find the first context line in the patch to anchor the position.
  const firstContext = patchLines.find(
    (l) => l.startsWith(" ") || (!l.startsWith("+") && !l.startsWith("-") && l.length > 0),
  );

  let searchStart = 0;
  if (firstContext) {
    const contextText = firstContext.startsWith(" ") ? firstContext.slice(1) : firstContext;
    const trimmedContext = contextText.trim();
    for (let i = 0; i < originalLines.length; i++) {
      if (originalLines[i].trim() === trimmedContext) {
        searchStart = i;
        break;
      }
    }
  }

  // Walk through the patch lines and build the hunk.
  const hunkLines: string[] = [];
  let origPos = searchStart;
  let origCount = 0;
  let newCount = 0;

  for (const patchLine of patchLines) {
    if (patchLine.startsWith("+")) {
      hunkLines.push(`+${patchLine.slice(1)}`);
      newCount++;
    } else if (patchLine.startsWith("-")) {
      hunkLines.push(`-${patchLine.slice(1)}`);
      origCount++;
    } else {
      // Context line — match against original to stay aligned.
      const contextText = patchLine.startsWith(" ") ? patchLine.slice(1) : patchLine;
      const trimmedContext = contextText.trim();

      // Scan forward in the original to find this context line.
      let found = false;
      for (let i = origPos; i < originalLines.length && i < origPos + 50; i++) {
        if (originalLines[i].trim() === trimmedContext) {
          // Emit any skipped original lines as context too.
          const skipped = i - origPos;
          if (skipped > 0 && hunkLines.length > 0) {
            // Gap between hunks — skip silently (we only emit the nearby context).
          }
          origPos = i;
          found = true;
          break;
        }
      }
      if (found) {
        hunkLines.push(` ${originalLines[origPos]}`);
        origPos++;
        origCount++;
        newCount++;
      } else {
        // Context line not found — treat as literal context.
        hunkLines.push(` ${contextText}`);
        origCount++;
        newCount++;
      }
    }
  }

  if (hunkLines.length === 0) {
    return [];
  }

  return [
    {
      origStart: searchStart + 1, // 1-based
      origCount,
      newStart: searchStart + 1,
      newCount,
      lines: hunkLines,
    },
  ];
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
      ["-C", worktreePath, "config", "user.name", env.USER_GIT_AUTHOR_NAME],
      ["-C", worktreePath, "config", "user.email", env.USER_GIT_AUTHOR_EMAIL],
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
    const authRemote = resolveAuthenticatedRemoteUrl(repository.remoteUrl);
    let cloned = true;
    try {
      await access(resolve(repository.localMirrorPath, ".git"), constants.F_OK);
    } catch {
      cloned = false;
    }
    if (!cloned) {
      const clone = await runCommand("git", ["clone", authRemote, repository.localMirrorPath]);
      if (clone.returncode !== 0) {
        const stderr = clone.stderr || "";
        const isAuthError = stderr.includes("403") || stderr.includes("401") || stderr.includes("Authentication failed");
        const isGitHub = repository.remoteUrl.includes("github.com");
        const isGitLab = repository.remoteUrl.includes("gitlab");
        let hint = "";
        if (isAuthError && isGitHub) {
          hint = " — set USER_GITHUB_TOKEN in .arche/environment (needs repo scope)";
        } else if (isAuthError && isGitLab) {
          hint = " — set USER_GITLAB_TOKEN in .arche/environment";
        } else if (isAuthError) {
          hint = " — check your Git credentials or access token";
        }
        throw new ExternalServiceError(
          `Repository clone failed for ${repository.remoteUrl}${hint}: ${stderr}`.trim(),
        );
      }
    }
    const setUrl = await runCommand("git", [
      "-C",
      repository.localMirrorPath,
      "remote",
      "set-url",
      "origin",
      authRemote,
    ]);
    if (setUrl.returncode !== 0) {
      throw new ExternalServiceError(setUrl.stderr || "Git remote set-url failed");
    }
    const fetchResult = await runCommand("git", ["-C", repository.localMirrorPath, "fetch", "origin"]);
    if (fetchResult.returncode !== 0) {
      throw new ExternalServiceError(fetchResult.stderr || "Repository fetch failed");
    }
    return repository.localMirrorPath;
  }

  buildBranchName(issue: JiraIssue) {
    const normalizedPrefix = this.config.git.branch_prefix
      .trim()
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
    const branchBase = `${issue.key}-${slugifyBranchSegment(issue.title)}`;
    return normalizedPrefix ? `${normalizedPrefix}/${branchBase}` : branchBase;
  }

  async createWorktree(repository: RepositoryRow, branchName: string, issueKey: string) {
    await this.ensureLocalClone(repository);
    const worktreePath = resolve(this.config.runtime.runs_dir, issueKey, branchName.replaceAll("/", "-"));
    await ensureDirectory(dirname(worktreePath));
    await this.cleanupWorktree(repository, worktreePath);

    // Delete the local branch if it already exists (e.g. from a previous failed run).
    // This is safe because cleanupWorktree already detached the worktree above.
    await runCommand("git", [
      "-C",
      repository.localMirrorPath,
      "branch",
      "-D",
      branchName,
    ]);

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
    const normalizedPatch = isBeginEndPatchFormat(patch)
      ? await convertBeginEndPatchToUnifiedDiff(worktreePath, patch)
      : patch;

    for (const patchPath of extractPatchPaths(normalizedPatch)) {
      if (!resolvePathInsideRoot(worktreePath, patchPath)) {
        throw new ExternalServiceError(
          `Patch path escapes repository root: ${patchPath}`,
          "patch_path_invalid",
        );
      }
    }
    const patchFile = await writeTempFile(worktreePath, ".patch", normalizedPatch);
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
    // Stage intent-to-add for untracked files so they appear in diff
    await runCommand("git", ["-C", worktreePath, "add", "-N", "."]);
    const result = await runCommand("git", ["-C", worktreePath, "diff", "HEAD", "--stat", "--patch"]);
    if (result.returncode !== 0) {
      throw new ExternalServiceError(result.stderr || "Git diff failed");
    }
    return result.stdout.slice(0, 20000);
  }

  async diffStats(worktreePath: string) {
    await runCommand("git", ["-C", worktreePath, "add", "-N", "."]);
    const result = await runCommand("git", ["-C", worktreePath, "diff", "HEAD", "--numstat"]);
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
      ["-C", worktreePath, "push", "--force-with-lease", "-u", "origin", branchName],
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

  async isWorktreeValid(worktreePath: string) {
    try {
      await access(resolve(worktreePath, ".git"), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async trackedFiles(worktreePath: string) {
    const result = await runCommand("git", ["-C", worktreePath, "ls-files"]);
    if (result.returncode !== 0) {
      return [];
    }
    return result.stdout.split("\n").filter(Boolean);
  }

  async getRecentCommits(worktreePath: string, limit = 20): Promise<string[]> {
    const result = await runCommand("git", [
      "-C", worktreePath,
      "log", "--oneline", `-${limit}`,
    ]);
    if (result.returncode !== 0) return [];
    return result.stdout.trim().split("\n").filter(Boolean);
  }
}
