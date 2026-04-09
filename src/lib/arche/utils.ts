import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { ExternalServiceError } from "./errors";

const execFileAsync = promisify(execFile);
const forbiddenCommandPattern = /[\n\r`$;&|<>]/;

export type CommandResult = {
  command: string;
  returncode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export type ParsedCommand = {
  raw: string;
  argv: string[];
  normalized: string;
};

export type GuardedFilePath =
  | {
      status: "ok";
      logicalPath: string;
      realPath: string;
    }
  | {
      status: "missing";
      logicalPath: string;
    }
  | {
      status: "invalid";
    };

export function makeId() {
  return randomUUID();
}

export function slugifyBranchSegment(value: string, maxLength = 48) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return slug.slice(0, maxLength) || "work";
}

export async function ensureDirectory(path: string) {
  await mkdir(path, { recursive: true });
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatCommandArgv(argv: string[]) {
  return argv.join(" ");
}

export function parseCommand(command: string): ParsedCommand {
  const raw = command.trim();
  if (!raw) {
    throw new ExternalServiceError("Command must not be empty", "command_invalid");
  }
  if (forbiddenCommandPattern.test(raw)) {
    throw new ExternalServiceError(
      "Command contains forbidden shell operators or variable expansion",
      "command_invalid",
    );
  }

  const argv: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        argv.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new ExternalServiceError("Command contains an unterminated quote", "command_invalid");
  }
  if (current) {
    argv.push(current);
  }
  if (argv.length === 0) {
    throw new ExternalServiceError("Command must not be empty", "command_invalid");
  }

  return {
    raw,
    argv,
    normalized: formatCommandArgv(argv),
  };
}

export function isArgvAllowed(argv: string[], allowedCommands: string[]) {
  return allowedCommands.some((allowed) => {
    try {
      const parsedAllowed = parseCommand(allowed);
      return (
        parsedAllowed.argv.length === argv.length &&
        parsedAllowed.argv.every((token, index) => token === argv[index])
      );
    } catch {
      return false;
    }
  });
}

export function isCommandAllowed(command: string, allowedCommands: string[]) {
  try {
    return isArgvAllowed(parseCommand(command).argv, allowedCommands);
  } catch {
    return false;
  }
}

export function isPathInsideRoot(rootPath: string, candidatePath: string) {
  const relativePath = relative(rootPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

export function resolvePathInsideRoot(rootPath: string, relativePath: string) {
  const logicalRoot = resolve(rootPath);
  const logicalPath = resolve(logicalRoot, relativePath);
  if (!isPathInsideRoot(logicalRoot, logicalPath)) {
    return null;
  }
  return logicalPath;
}

export async function createPathGuard(rootPath: string) {
  const logicalRoot = resolve(rootPath);
  const realRoot = await realpath(logicalRoot);

  return {
    logicalRoot,
    realRoot,
    resolveLogical(relativePath: string) {
      return resolvePathInsideRoot(logicalRoot, relativePath);
    },
    async resolveExistingFile(relativePath: string): Promise<GuardedFilePath> {
      const logicalPath = resolvePathInsideRoot(logicalRoot, relativePath);
      if (!logicalPath) {
        return { status: "invalid" };
      }

      try {
        const realPath = await realpath(logicalPath);
        if (!isPathInsideRoot(realRoot, realPath)) {
          return { status: "invalid" };
        }
        const fileStats = await stat(realPath);
        if (!fileStats.isFile()) {
          return { status: "invalid" };
        }
        return {
          status: "ok",
          logicalPath,
          realPath,
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return {
            status: "missing",
            logicalPath,
          };
        }
        throw error;
      }
    },
  };
}

export async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
    label?: string;
  } = {},
): Promise<CommandResult> {
  const startedAt = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      timeout: options.timeout,
      maxBuffer: 10 * 1024 * 1024,
    });
    return {
      command: options.label ?? [command, ...args].join(" "),
      returncode: 0,
      stdout,
      stderr,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const failed = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    return {
      command: options.label ?? [command, ...args].join(" "),
      returncode: typeof failed.code === "number" ? failed.code : 1,
      stdout: failed.stdout ?? "",
      stderr: failed.stderr ?? failed.message,
      durationMs: Date.now() - startedAt,
    };
  }
}

export async function writeTempFile(directory: string, suffix: string, content: string) {
  await ensureDirectory(directory);
  const path = `${directory}/.${makeId()}${suffix}`;
  await writeFile(path, content, "utf8");
  return path;
}

export function serializeDate(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}
