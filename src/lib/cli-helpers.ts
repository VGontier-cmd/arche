import { constants, existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as p from "@clack/prompts";

import { createLogger } from "./arche/logging";

/**
 * Walks up from the current file to find the nearest directory containing
 * `package.json`. Works identically whether running from `src/` (dev/tsx)
 * or `dist/` (bundled by tsup).
 */
export function archePackageRootDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "package.json"))) return dir;
    dir = dirname(dir);
  }
  return dir;
}

export function bundledEnvTemplatePath(): string {
  return join(archePackageRootDir(), "install", "env.default");
}

export function printJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export const cliLogger = createLogger({ service: "cli", stream: process.stderr });

export async function pathExists(path: string) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function guardPrompt<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Installation cancelled.");
    process.exit(0);
  }
  return value;
}

export function validateRequired(value: string | undefined) {
  if (!value?.trim()) {
    return "Value is required";
  }
}

export function validateUrl(value: string | undefined) {
  if (!value?.trim()) {
    return "Value is required";
  }
  try {
    new URL(value);
  } catch {
    return "Enter a valid URL";
  }
}

export function hasAnyValue(...values: string[]) {
  return values.some((value) => value.trim().length > 0);
}
