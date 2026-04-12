import type { Command } from "commander";

import { printJson } from "../lib/cli-helpers";

export function register(program: Command) {
  const repoRules = program
    .command("repo-rules")
    .description("Manage repository routing rules");

  repoRules.command("list").action(async () => {
    const [{ ensureArcheReady }, { listRepoRules }] = await Promise.all([
      import("../lib/bootstrap"),
      import("../lib/arche/runs"),
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
        import("../lib/bootstrap"),
        import("../lib/arche/runs"),
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
}
