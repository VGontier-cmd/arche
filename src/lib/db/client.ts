import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { env } from "../env";
import * as schema from "./schema";
import { prepareSqliteDatabasePath } from "./sqlite";

type SQLiteDatabase = InstanceType<typeof Database>;

declare global {
  var __archeSqlite: SQLiteDatabase | undefined;
}

const SQLITE_WRITE_RETRY_WINDOW_MS = 2_000;
const SQLITE_BUSY_RETRY_BASE_MS = 25;

const database =
  globalThis.__archeSqlite ??
  new Database(prepareSqliteDatabasePath(env.DATABASE_URL), {
    timeout: 5000,
  });

if (!globalThis.__archeSqlite) {
  database.pragma("busy_timeout = 5000");
  database.pragma("foreign_keys = ON");
  try {
    // WAL is desirable for multi-process access, but another Arche process may
    // already be enabling it during concurrent startup.
    database.pragma("journal_mode = WAL");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("database is locked")) {
      throw error;
    }
  }
  globalThis.__archeSqlite = database;
}

export const db = drizzle(database, { schema });
export { database };

function isSqliteBusyError(error: unknown) {
  return (
    error instanceof Error &&
    (error.message.includes("database is locked") ||
      error.message.includes("SQLITE_BUSY") ||
      error.message.includes("database busy"))
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withSqliteWriteRetry<T>(operation: () => Promise<T> | T): Promise<T> {
  const startedAt = Date.now();
  let attempt = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (!isSqliteBusyError(error)) {
        throw error;
      }

      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= SQLITE_WRITE_RETRY_WINDOW_MS) {
        throw error;
      }

      attempt += 1;
      const maxDelay = Math.min(
        SQLITE_BUSY_RETRY_BASE_MS * 2 ** Math.max(attempt - 1, 0),
        SQLITE_WRITE_RETRY_WINDOW_MS - elapsedMs,
      );
      const delay = Math.max(10, Math.floor(Math.random() * Math.max(maxDelay, 10)));
      await sleep(delay);
    }
  }
}

export async function checkpointWal(mode: "PASSIVE" | "FULL" | "RESTART" | "TRUNCATE" = "PASSIVE") {
  await withSqliteWriteRetry(() => database.pragma(`wal_checkpoint(${mode})`));
}

export async function optimizeDatabase() {
  database.pragma("optimize");
}
