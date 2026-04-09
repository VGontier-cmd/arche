import { describe, expect, it, vi } from "vitest";

import { resolveSqliteDatabasePath } from "../src/lib/db/sqlite";

describe("resolveSqliteDatabasePath", () => {
  it("resolves relative filesystem paths", () => {
    expect(resolveSqliteDatabasePath("./runtime/arche.db")).toMatch(/runtime\/arche\.db$/);
  });

  it("supports file URLs", () => {
    expect(resolveSqliteDatabasePath("file:./runtime/arche.db")).toMatch(/runtime\/arche\.db$/);
  });

  it("rejects non-sqlite URL schemes", () => {
    expect(() => resolveSqliteDatabasePath("postgres://localhost/arche")).toThrow(
      /Unsupported DATABASE_URL/,
    );
  });

  it("retries transient SQLITE_BUSY write failures", async () => {
    const { withSqliteWriteRetry } = await import("../src/lib/db/client");
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("SQLITE_BUSY: database is locked"))
      .mockResolvedValueOnce("ok");

    await expect(withSqliteWriteRetry(operation)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
