import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OrchestratorConfig } from "../src/lib/config";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runCommandMock = vi.fn();

vi.mock("../src/lib/arche/utils", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/arche/utils")>(
    "../src/lib/arche/utils",
  );
  return {
    ...actual,
    runCommand: runCommandMock,
  };
});

function commandResult(returncode = 0, stdout = "", stderr = "") {
  return {
    command: "git",
    returncode,
    stdout,
    stderr,
    durationMs: 1,
  };
}

describe("GitManager", () => {
  beforeEach(() => {
    runCommandMock.mockReset();
    delete process.env.USER_GIT_AUTHOR_NAME;
    delete process.env.USER_GIT_AUTHOR_EMAIL;
    delete (globalThis as { __archeEnv?: unknown }).__archeEnv;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.USER_GIT_AUTHOR_NAME;
    delete process.env.USER_GIT_AUTHOR_EMAIL;
    delete (globalThis as { __archeEnv?: unknown }).__archeEnv;
  });

  it("uses the default git author identity on a clean machine", async () => {
    runCommandMock
      .mockResolvedValueOnce(commandResult())
      .mockResolvedValueOnce(commandResult())
      .mockResolvedValueOnce(commandResult())
      .mockResolvedValueOnce(commandResult(1))
      .mockResolvedValueOnce(commandResult())
      .mockResolvedValueOnce(commandResult());

    const { GitManager } = await import("../src/lib/arche/git");
    const manager = new GitManager({} as OrchestratorConfig);

    await manager.commitAndPush(
      {} as never,
      "/tmp/worktree",
      "jira/PROJ-123-fix-popup-alignment",
      {
        key: "PROJ-123",
        title: "Fix popup alignment",
      } as never,
    );

    expect(runCommandMock).toHaveBeenNthCalledWith(1, "git", [
      "-C",
      "/tmp/worktree",
      "config",
      "user.name",
      "arche-bot",
    ]);
    expect(runCommandMock).toHaveBeenNthCalledWith(2, "git", [
      "-C",
      "/tmp/worktree",
      "config",
      "user.email",
      "arche-bot@example.invalid",
    ]);
    expect(runCommandMock).toHaveBeenNthCalledWith(3, "git", ["-C", "/tmp/worktree", "add", "-A"]);
    expect(runCommandMock).toHaveBeenNthCalledWith(4, "git", [
      "-C",
      "/tmp/worktree",
      "diff",
      "--cached",
      "--quiet",
      "--exit-code",
    ]);
    expect(runCommandMock).toHaveBeenNthCalledWith(5, "git", [
      "-C",
      "/tmp/worktree",
      "commit",
      "-m",
      "PROJ-123: Fix popup alignment",
    ]);
    expect(runCommandMock).toHaveBeenNthCalledWith(6, "git", [
      "-C",
      "/tmp/worktree",
      "push",
      "-u",
      "origin",
      "jira/PROJ-123-fix-popup-alignment",
    ]);
  });

  it("uses the configured git author identity when provided", async () => {
    process.env.USER_GIT_AUTHOR_NAME = "release-bot";
    process.env.USER_GIT_AUTHOR_EMAIL = "release-bot@example.com";
    runCommandMock
      .mockResolvedValueOnce(commandResult())
      .mockResolvedValueOnce(commandResult())
      .mockResolvedValueOnce(commandResult())
      .mockResolvedValueOnce(commandResult(1))
      .mockResolvedValueOnce(commandResult())
      .mockResolvedValueOnce(commandResult());

    const { GitManager } = await import("../src/lib/arche/git");
    const manager = new GitManager({} as OrchestratorConfig);

    await manager.commitAndPush(
      {} as never,
      "/tmp/worktree",
      "jira/PROJ-123-fix-popup-alignment",
      {
        key: "PROJ-123",
        title: "Fix popup alignment",
      } as never,
    );

    expect(runCommandMock).toHaveBeenNthCalledWith(1, "git", [
      "-C",
      "/tmp/worktree",
      "config",
      "user.name",
      "release-bot",
    ]);
    expect(runCommandMock).toHaveBeenNthCalledWith(2, "git", [
      "-C",
      "/tmp/worktree",
      "config",
      "user.email",
      "release-bot@example.com",
    ]);
  });

  it("fails clearly when there is nothing to commit", async () => {
    runCommandMock
      .mockResolvedValueOnce(commandResult())
      .mockResolvedValueOnce(commandResult())
      .mockResolvedValueOnce(commandResult())
      .mockResolvedValueOnce(commandResult(0));

    const { GitManager } = await import("../src/lib/arche/git");
    const manager = new GitManager({} as OrchestratorConfig);

    await expect(
      manager.commitAndPush(
        {} as never,
        "/tmp/worktree",
        "jira/PROJ-123-fix-popup-alignment",
        {
          key: "PROJ-123",
          title: "Fix popup alignment",
        } as never,
      ),
    ).rejects.toMatchObject({
      code: "git_nothing_to_commit",
      message: "No changes to commit for PROJ-123",
    });

    expect(runCommandMock).toHaveBeenCalledTimes(4);
  });

  it("uses the configured branch prefix", async () => {
    const { GitManager } = await import("../src/lib/arche/git");
    const manager = new GitManager({
      git: {
        branch_prefix: "arche/",
      },
    } as OrchestratorConfig);

    expect(
      manager.buildBranchName({
        key: "PROJ-321",
        title: "Fix popup alignment",
      } as never),
    ).toBe("arche/PROJ-321-fix-popup-alignment");
  });

  it("supports an empty branch prefix", async () => {
    const { GitManager } = await import("../src/lib/arche/git");
    const manager = new GitManager({
      git: {
        branch_prefix: "",
      },
    } as OrchestratorConfig);

    expect(
      manager.buildBranchName({
        key: "PROJ-321",
        title: "Fix popup alignment",
      } as never),
    ).toBe("PROJ-321-fix-popup-alignment");
  });
});

describe("Begin/End patch conversion", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "arche-patch-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("detects Begin Patch format", async () => {
    const { isBeginEndPatchFormat } = await import("../src/lib/arche/git");
    expect(
      isBeginEndPatchFormat('*** Begin Patch\n*** Update File: package.json\n@@\n+new\n*** End Patch'),
    ).toBe(true);
    expect(
      isBeginEndPatchFormat('diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new'),
    ).toBe(false);
  });

  it("converts an Update File block to unified diff", async () => {
    const { convertBeginEndPatchToUnifiedDiff } = await import("../src/lib/arche/git");

    await writeFile(
      join(workspace, "package.json"),
      [
        '{',
        '  "name": "test",',
        '  "version": "0.1.0",',
        '  "private": true,',
        '  "type": "module"',
        '}',
      ].join("\n"),
      "utf8",
    );

    const beginEndPatch = [
      "*** Begin Patch",
      "*** Update File: package.json",
      "@@",
      '   "version": "0.1.0",',
      '   "private": true,',
      '+  "author": "VGontier-cmd",',
      '   "type": "module"',
      "*** End Patch",
    ].join("\n");

    const result = await convertBeginEndPatchToUnifiedDiff(workspace, beginEndPatch);
    expect(result).toContain("diff --git a/package.json b/package.json");
    expect(result).toContain("--- a/package.json");
    expect(result).toContain("+++ b/package.json");
    expect(result).toContain('+  "author": "VGontier-cmd",');
  });

  it("converts an Add File block to unified diff", async () => {
    const { convertBeginEndPatchToUnifiedDiff } = await import("../src/lib/arche/git");

    const beginEndPatch = [
      "*** Begin Patch",
      "*** Add File: src/new-file.ts",
      "+export const hello = 'world';",
      "*** End Patch",
    ].join("\n");

    const result = await convertBeginEndPatchToUnifiedDiff(workspace, beginEndPatch);
    expect(result).toContain("new file mode 100644");
    expect(result).toContain("+export const hello = 'world';");
  });
});
