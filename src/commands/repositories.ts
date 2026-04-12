import type { Command } from "commander";

import { printJson } from "../lib/cli-helpers";

export function register(program: Command) {
  const repositories = program
    .command("repositories")
    .description("Manage repository registry");

  repositories.command("list").action(async () => {
    const [{ ensureArcheReady }, { listRepositories }] = await Promise.all([
      import("../lib/bootstrap"),
      import("../lib/arche/runs"),
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
        import("../lib/bootstrap"),
        import("../lib/arche/runs"),
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
}
