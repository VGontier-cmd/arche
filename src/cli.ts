#!/usr/bin/env node

import { Command } from "commander";

import { register as registerInit } from "./commands/init";
import { register as registerDoctor } from "./commands/doctor";
import { register as registerSetup } from "./commands/setup";
import { register as registerRepositories } from "./commands/repositories";
import { register as registerRepoRules } from "./commands/repo-rules";
import { register as registerProfiles } from "./commands/profiles";
import { register as registerRuns } from "./commands/runs";
import { register as registerServe } from "./commands/serve";
import { register as registerWorker } from "./commands/worker";
import { register as registerDashboard } from "./commands/dashboard";
import { register as registerUp } from "./commands/up";

const program = new Command();

program
  .name("arche")
  .description("Arche self-hosted development agent orchestrator")
  .version("0.1.0");

registerInit(program);
registerDoctor(program);
registerSetup(program);
registerRepositories(program);
registerRepoRules(program);
registerProfiles(program);
registerRuns(program);
registerServe(program);
registerWorker(program);
registerDashboard(program);
registerUp(program);

await program.parseAsync(process.argv);
