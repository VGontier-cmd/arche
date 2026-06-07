/**
 * Native SDK tool definitions for the executor role.
 * These replace the JSON-based action loop with OpenRouter's function-calling system.
 */
import { tool } from "@openrouter/sdk/lib/tool";

import { z } from "zod";

import type { OrchestratorConfig } from "../config";
import type { RepositoryRow, RunRow } from "../db/schema";
import { ExternalServiceError } from "./errors";
import { GitManager } from "./git";
import { redactText, truncateText } from "./logging";
import type { OpenRouterSdkProvider } from "./provider";
import { SandboxManager } from "./sandbox";
import type { ExecutorRoleOutput } from "./types";
import { isArgvAllowed, parseCommand } from "./utils";
import type { WorkflowHooks } from "./run-workflow";

const MAX_EMPTY_FINISH_RETRIES = 2;
const MAX_VALIDATION_RETRIES = 3;

export type ExecutorToolsState = {
  filesMutated: number;
  emptyFinishRetries: number;
  validationRetries: number;
  /** Running cost estimate updated after each turn — used by the maxCost stop condition */
  estimatedCostUsd: number;
  /** Set when the finish tool accepts — caller checks this after getResponse() */
  finishResult: Pick<ExecutorRoleOutput, "summary" | "implementedPlanDelta"> | null;
};

export type ExecutorToolsContext = {
  provider: OpenRouterSdkProvider;
  sandbox: SandboxManager;
  git: GitManager;
  config: OrchestratorConfig;
  run: RunRow;
  cycle: number;
  workerId: string;
  repository: RepositoryRow;
  worktreePath: string;
  sandboxId: string;
  hooks: WorkflowHooks;
  hasPendingFindings: boolean;
};

/**
 * Create all 7 executor tools bound to the given runtime context.
 * The returned `state` object is mutated during execution and can be read
 * after `getResponse()` resolves to determine the outcome.
 */
export function createExecutorTools(ctx: ExecutorToolsContext) {
  const { provider, sandbox, git, config, run, cycle, workerId, repository, worktreePath, sandboxId, hooks, hasPendingFindings } = ctx;

  const allowedCommands =
    repository.allowedCommands.length > 0
      ? repository.allowedCommands
      : config.defaults.allowed_commands;

  const state: ExecutorToolsState = {
    filesMutated: 0,
    emptyFinishRetries: 0,
    validationRetries: 0,
    estimatedCostUsd: 0,
    finishResult: null,
  };

  const readFilesTool = tool({
    name: "read_files",
    description:
      "Read one or more files from the repository. Use `paths` for simple full-file reads, or `files` for paginated reads with byte offset/limit.",
    inputSchema: z.object({
      paths: z.array(z.string()).optional(),
      files: z
        .array(
          z.object({
            path: z.string(),
            offset: z.number().int().min(0).optional(),
            limit: z.number().int().positive().optional(),
          }),
        )
        .optional(),
    }),
    execute: async (params) => {
      const targets = params.paths ?? params.files?.map((f) => f.path) ?? [];
      await hooks.appendRunMessage(
        run.id,
        "assistant",
        "action",
        `Reading ${targets.length} file(s): ${targets.slice(0, 5).join(", ")}${targets.length > 5 ? ", …" : ""}`,
      );
      const result = await provider.readFiles(params);
      return result;
    },
  });

  const writeFileTool = tool({
    name: "write_file",
    description:
      "Write content to a file. Creates parent directories as needed. `path` must be relative to the repository root. Always write the COMPLETE file content — never partial snippets.",
    inputSchema: z.object({
      path: z.string().min(1),
      content: z.string(),
    }),
    execute: async ({ path, content }) => {
      await hooks.appendRunMessage(run.id, "assistant", "action", `Writing file: ${path}`);
      const result = await provider.writeFile(path, content);
      state.filesMutated++;
      return result;
    },
  });

  const deleteFileTool = tool({
    name: "delete_file",
    description: "Delete a file from the repository. `path` must be relative to the repository root.",
    inputSchema: z.object({
      path: z.string().min(1),
    }),
    execute: async ({ path }) => {
      await hooks.appendRunMessage(run.id, "assistant", "action", `Deleting file: ${path}`);
      const result = await provider.deleteFile(path);
      state.filesMutated++;
      return result;
    },
  });

  const applyPatchTool = tool({
    name: "apply_patch",
    description:
      "Apply a unified diff patch to one or more files. Use standard `diff -u` / `git diff` format.",
    inputSchema: z.object({
      patch: z.string().min(1),
    }),
    execute: async ({ patch }) => {
      await hooks.appendRunMessage(run.id, "assistant", "action", "Applying patch");
      await git.applyPatch(worktreePath, patch);
      state.filesMutated++;
      return { result: "patch_applied" };
    },
  });

  const runCommandTool = tool({
    name: "run_command",
    description:
      "Run a shell command inside the repository sandbox. Only allowed commands may be executed. Use this to run tests, linters, or build scripts. Output streams as it arrives so you may see partial progress before the command finishes.",
    inputSchema: z.object({
      command: z.string().min(1),
    }),
    // Yields preliminary `stdout_chunk` / `stderr_chunk` events while the
    // command runs, then returns the final aggregated result. The SDK exposes
    // these via `getToolStream()` / `getFullResponsesStream()` so the dashboard
    // can render live output and the model can see partial progress.
    eventSchema: z.discriminatedUnion("type", [
      z.object({ type: z.literal("started"), command: z.string() }),
      z.object({ type: z.literal("stdout_chunk"), data: z.string() }),
      z.object({ type: z.literal("stderr_chunk"), data: z.string() }),
    ]),
    execute: async function* (params) {
      const command = String((params as { command: string }).command);
      let parsedCommand: ReturnType<typeof parseCommand> | null = null;
      try {
        parsedCommand = parseCommand(command);
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Command parsing failed" };
      }

      if (!isArgvAllowed(parsedCommand.argv, allowedCommands)) {
        await hooks.appendRunEvent(run.id, "provider.command_rejected", {
          cycle,
          command: parsedCommand.normalized,
        });
        return { error: `Command is not allowed: ${parsedCommand.normalized}` };
      }

      await hooks.setWorkerPhase(workerId, run, {
        status: "busy",
        activity: "running_command",
      });
      await hooks.appendRunMessage(
        run.id,
        "assistant",
        "action",
        `Running command: ${parsedCommand.normalized}`,
      );

      const stream = sandbox.runStreaming(
        sandboxId,
        parsedCommand.argv,
        config.worker.max_run_seconds * 1000,
      );
      yield { type: "started" as const, command: parsedCommand.normalized };
      for await (const ev of stream.events) {
        if (ev.type === "stdout") yield { type: "stdout_chunk" as const, data: ev.chunk };
        else if (ev.type === "stderr") yield { type: "stderr_chunk" as const, data: ev.chunk };
      }
      const commandResult = await stream.done;

      await hooks.recordRunCommand({
        runId: run.id,
        phase: "executor",
        result: commandResult,
      });

      // Restore waiting_provider phase after command completes
      await hooks.setWorkerPhase(workerId, run, {
        status: "waiting",
        activity: "waiting_provider",
      });

      return {
        returncode: commandResult.returncode,
        stdout: truncateText(redactText(commandResult.stdout), 8000),
        stderr: truncateText(redactText(commandResult.stderr), 8000),
      };
    },
  });

  const finishTool = tool({
    name: "finish",
    description:
      "Signal that you have finished implementing all planned changes. Only call this after writing every required file. You MUST have called write_file at least once before calling finish.",
    inputSchema: z.object({
      summary: z.string().min(1).describe("Short summary of what was implemented"),
      implementedPlanDelta: z
        .string()
        .min(1)
        .describe("Description of changes relative to the plan (what was done, skipped, or changed)"),
    }),
    execute: async (params) => {
      // Hard-fail: reviewer found issues but executor wrote nothing.
      if (state.filesMutated === 0 && hasPendingFindings) {
        throw new ExternalServiceError(
          `Executor completed cycle ${cycle} without writing any files despite reviewer findings. ` +
            `The reviewer's findings must be addressed by modifying files before calling finish.`,
        );
      }

      // Empty-finish guard: bounce back with a clear instruction to write code.
      if (state.filesMutated === 0 && state.emptyFinishRetries < MAX_EMPTY_FINISH_RETRIES) {
        state.emptyFinishRetries++;
        await hooks.appendSystemRunLog(
          run.id,
          `executor called finish without writing any files (attempt ${state.emptyFinishRetries}/${MAX_EMPTY_FINISH_RETRIES}), requesting implementation`,
        );
        await hooks.appendRunEvent(run.id, "provider.empty_finish_rejected", {
          cycle,
          attempt: state.emptyFinishRetries,
        });
        return {
          error:
            "You called finish but have not written any files yet. " +
            "Your job is to IMPLEMENT the approved plan by calling write_file to create or modify source files. " +
            "Read the plan again, identify the files that need to change, and use write_file to make those changes. " +
            "Do not call finish until you have written at least one file.",
        };
      }

      // Validation-gated finish: run validation suite before accepting.
      if (state.filesMutated > 0 && state.validationRetries < MAX_VALIDATION_RETRIES) {
        const validationResult = await hooks.runValidation(sandboxId);
        if (validationResult.findings.length > 0) {
          state.validationRetries++;
          await hooks.appendSystemRunLog(
            run.id,
            `validation failed after finish (attempt ${state.validationRetries}/${MAX_VALIDATION_RETRIES}), asking executor to fix`,
          );
          await hooks.appendRunEvent(run.id, "validation.findings_injected", {
            cycle,
            findingCount: validationResult.findings.length,
            attempt: state.validationRetries,
          });
          return {
            status: "validation_failed",
            findings: validationResult.findings,
            instruction:
              "Validation failed. Fix the issues listed above, then call finish again.",
          };
        }
      }

      // Accept the finish — record result, let caller detect it via state.finishResult.
      state.finishResult = {
        summary: params.summary,
        implementedPlanDelta: params.implementedPlanDelta,
      };
      await hooks.appendRunMessage(
        run.id,
        "assistant",
        "action",
        `Finished: ${params.summary}`,
      );
      return {
        ok: true,
        message:
          "Execution complete. Your changes have been recorded. Do not call any more tools.",
      };
    },
  });

  // Manual tool — SDK stops immediately when requested, no auto-execution.
  const needsHumanInputTool = tool({
    name: "needs_human_input",
    description:
      "Request human input when you are completely blocked and cannot proceed autonomously. Only use this if you lack credentials, access, or face a fundamental unresolvable ambiguity. Never use it to confirm work you can verify yourself.",
    inputSchema: z.object({
      question: z.string().min(1),
    }),
    execute: false,
  });

  // Skill loader: a thin tool that pulls a markdown skill from the runtime
  // skills directory and injects it into the SYSTEM instructions for every
  // subsequent turn (via SDK `nextTurnParams`). This keeps the initial system
  // prompt small and lets the model "load" domain-specific guidance only when
  // it actually needs it (e.g. "load_skill react-testing" before touching a
  // RTL-heavy codebase).
  const SKILLS_DIR = "runtime/skills";
  const loadSkillTool = tool({
    name: "load_skill",
    description:
      "Load a domain-specific skill (e.g. 'react-testing', 'sql-migrations') whose instructions are appended to your system prompt for all subsequent turns. Use this when the task requires specialised knowledge not already covered by the base prompt. Skill names are slug-style (a-z, 0-9, hyphens).",
    inputSchema: z.object({
      name: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/, "Skill name must be a slug (a-z, 0-9, hyphens)"),
    }),
    nextTurnParams: {
      instructions: async (params: unknown, ctx: { instructions?: string | null | undefined }) => {
        const skillName = (params as { name: string }).name;
        try {
          const { readFile } = await import("node:fs/promises");
          const { join } = await import("node:path");
          const skillBody = await readFile(join(SKILLS_DIR, `${skillName}.md`), "utf8");
          const base = typeof ctx.instructions === "string" ? ctx.instructions : "";
          return `${base}\n\n## Loaded skill: ${skillName}\n\n${skillBody.trim()}`;
        } catch {
          return ctx.instructions ?? "";
        }
      },
    },
    execute: async ({ name }: { name: string }) => {
      try {
        const { readFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        await readFile(join(SKILLS_DIR, `${name}.md`), "utf8");
        return { loaded: name, message: `Skill '${name}' loaded for subsequent turns.` };
      } catch {
        return { error: `Skill '${name}' not found in ${SKILLS_DIR}/${name}.md` };
      }
    },
  });

  const tools = [
    readFilesTool,
    writeFileTool,
    deleteFileTool,
    applyPatchTool,
    runCommandTool,
    finishTool,
    needsHumanInputTool,
    loadSkillTool,
  ] as const;

  return { tools, state };
}

/**
 * Extract `needs_human_input` function call from the final response output, if present.
 * When the model calls `needs_human_input` (execute: false), the SDK leaves the call
 * unexecuted and exposes it as a `function_call` item in `output`.
 */
export function extractHumanInputCall(
  output: Array<{ type?: string; name?: string; arguments?: string }>,
): { question: string } | null {
  for (const item of output) {
    if (item.type === "function_call" && item.name === "needs_human_input" && item.arguments) {
      try {
        const parsed = JSON.parse(item.arguments) as { question?: string };
        if (typeof parsed.question === "string") {
          return { question: parsed.question };
        }
      } catch {
        // malformed arguments — ignore
      }
    }
  }
  return null;
}
