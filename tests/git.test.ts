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

describe("GitManager.commitAndPush", () => {
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
});
