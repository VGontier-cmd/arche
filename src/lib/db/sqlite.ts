import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const URL_SCHEME_PATTERN = /^[a-z]+:\/\//i;

export function resolveSqliteDatabasePath(databaseUrl: string) {
  const value = databaseUrl.trim();

  if (!value) {
    throw new Error("DATABASE_URL cannot be empty");
  }

  if (value === ":memory:") {
    return value;
  }

  if (value.startsWith("file:")) {
    const [pathPart] = value.slice("file:".length).split("?", 1);
    if (!pathPart) {
      throw new Error(`Invalid SQLite database URL: ${databaseUrl}`);
    }
    return resolve(decodeURIComponent(pathPart));
  }

  if (URL_SCHEME_PATTERN.test(value)) {
    throw new Error(
      `Unsupported DATABASE_URL for SQLite: ${databaseUrl}. Use a filesystem path or file: URL.`,
    );
  }

  return resolve(value);
}

export function prepareSqliteDatabasePath(databaseUrl: string) {
  const databasePath = resolveSqliteDatabasePath(databaseUrl);
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }
  return databasePath;
}
