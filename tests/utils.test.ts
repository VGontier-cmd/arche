import { describe, expect, it } from "vitest";

import {
  createPathGuard,
  isCommandAllowed,
  parseCommand,
  slugifyBranchSegment,
} from "../src/lib/arche/utils";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("slugifyBranchSegment", () => {
  it("normalizes punctuation and casing", () => {
    expect(slugifyBranchSegment("Fix Popup / Header !!!")).toBe("fix-popup-header");
  });

  it("falls back when the string becomes empty", () => {
    expect(slugifyBranchSegment("###")).toBe("work");
  });
});

describe("isCommandAllowed", () => {
  it("accepts exact commands only", () => {
    expect(isCommandAllowed("pnpm test", ["pnpm test"])).toBe(true);
    expect(isCommandAllowed("git diff --stat", ["git diff"])).toBe(false);
  });

  it("rejects commands outside the allowlist", () => {
    expect(isCommandAllowed("rm -rf /", ["git diff", "pnpm test"])).toBe(false);
  });

  it("rejects shell operators during parsing", () => {
    expect(() => parseCommand("pnpm test && rm -rf /")).toThrow(/forbidden shell operators/i);
  });
});

describe("createPathGuard", () => {
  it("accepts files inside the repository and rejects symlink escapes", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "arche-utils-"));
    const repoRoot = join(workspace, "repo");
    const outsideFile = join(workspace, "outside.txt");

    await mkdir(join(repoRoot, "src"), { recursive: true });
    await writeFile(join(repoRoot, "src", "index.ts"), "console.log('ok');", "utf8");
    await writeFile(outsideFile, "secret", "utf8");
    await symlink(outsideFile, join(repoRoot, "src", "escape.txt"));

    const guard = await createPathGuard(repoRoot);
    const insideFile = await guard.resolveExistingFile("src/index.ts");
    const escapedFile = await guard.resolveExistingFile("src/escape.txt");

    expect(insideFile.status).toBe("ok");
    expect(escapedFile.status).toBe("invalid");
  });
});
