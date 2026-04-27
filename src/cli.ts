#!/usr/bin/env node

import { Command } from "commander";

import { register as registerOnboard } from "./commands/onboard";
import { register as registerUp } from "./commands/up";
import { register as registerRun } from "./commands/run";
import { register as registerDoctor } from "./commands/doctor";

// Advanced / power-user commands (hidden from --help)
import { register as registerInit } from "./commands/init";
import { register as registerSetup } from "./commands/setup";
import { register as registerRepositories } from "./commands/repositories";
import { register as registerRepoRules } from "./commands/repo-rules";
import { register as registerProfiles } from "./commands/profiles";
import { register as registerRuns } from "./commands/runs";
import { register as registerServe } from "./commands/serve";
import { register as registerWorker } from "./commands/worker";
import { register as registerDashboard } from "./commands/dashboard";

const program = new Command();

program
  .name("arche")
  .description("Arche self-hosted development agent orchestrator")
  .version("0.1.0");

// ── Primary commands ─────────────────────────────────────────────────────────
registerOnboard(program);
registerUp(program);
registerRun(program);
registerDoctor(program);

// ── Advanced commands (hidden) ────────────────────────────────────────────────
registerInit(program);
registerSetup(program);
registerRepositories(program);
registerRepoRules(program);
registerProfiles(program);
registerRuns(program);
registerServe(program);
registerWorker(program);
registerDashboard(program);

// Hide advanced commands from --help
const primaryCommands = new Set(["onboard", "up", "run", "doctor"]);
for (const cmd of program.commands) {
  if (!primaryCommands.has(cmd.name())) {
    // commander stores visibility in _hidden (not exposed in TS types)
    (cmd as unknown as { _hidden: boolean })._hidden = true;
  }
}

await program.parseAsync(process.argv);
