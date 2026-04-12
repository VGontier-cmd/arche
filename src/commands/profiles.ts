import type { Command } from "commander";

import { printJson } from "../lib/cli-helpers";

export function register(program: Command) {
  const profiles = program
    .command("profiles")
    .description("Inspect configured execution profiles");

  profiles.command("show").action(async () => {
    const [{ ensureArcheReady }, { listExecutionProfiles }] = await Promise.all(
      [import("../lib/bootstrap"), import("../lib/arche/runs")],
    );
    await ensureArcheReady();
    printJson(await listExecutionProfiles());
  });
}
