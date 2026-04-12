import type { Command } from "commander";

import { printArcheBanner } from "../lib/arche/banner";
import { printJson } from "../lib/cli-helpers";

export function register(program: Command) {
  const setup = program
    .command("setup")
    .description("Guided configuration (interactive flows)");

  setup
    .command("wizard")
    .description(
      "Register a repository and optionally a Jira routing rule (repositories add + repo-rules add)",
    )
    .action(async () => {
      printArcheBanner();
      const { runSetupWizard } = await import("../lib/arche/routing-wizard");
      const result = await runSetupWizard();
      printJson(result);
    });
}
