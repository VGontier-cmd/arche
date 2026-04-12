import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("server auth", () => {
  let workspace: string;
  let runtimeRoot: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "arche-server-auth-"));
    runtimeRoot = join(workspace, "runtime");

    process.env.DATABASE_URL = join(runtimeRoot, "arche.db");
    process.env.ARCHE_CONFIG_PATH = join(workspace, "orchestrator.yml");
    process.env.ARCHE_RUNTIME_ROOT = runtimeRoot;
    process.env.ARCHE_SERVER_AUTH_TOKEN = "server-token";
    process.env.ARCHE_LOG_LEVEL = "error";

    const sqlite = (globalThis as { __archeSqlite?: { close: () => void } }).__archeSqlite;
    sqlite?.close();
    delete (globalThis as { __archeSqlite?: unknown }).__archeSqlite;
    delete (globalThis as { __archeEnv?: unknown }).__archeEnv;
    vi.resetModules();
  });

  afterEach(async () => {
    const sqlite = (globalThis as { __archeSqlite?: { close: () => void } }).__archeSqlite;
    sqlite?.close();
    delete (globalThis as { __archeSqlite?: unknown }).__archeSqlite;
    delete (globalThis as { __archeEnv?: unknown }).__archeEnv;
    delete process.env.ARCHE_SERVER_AUTH_TOKEN;
    await rm(workspace, { recursive: true, force: true });
  });

  it("keeps public endpoints unauthenticated while protecting the management API", async () => {
    const { startServer } = await import("../src/server");
    const server = await startServer({ host: "127.0.0.1", port: 0 });

    try {
      const address = server.server.address();
      expect(address).not.toBeNull();
      const port = typeof address === "object" && address ? address.port : 0;

      const [health, ready, profilesUnauthorized, profilesAuthorized, webhook] = await Promise.all([
        fetch(`http://127.0.0.1:${port}/health`),
        fetch(`http://127.0.0.1:${port}/ready`),
        fetch(`http://127.0.0.1:${port}/v1/profiles`),
        fetch(`http://127.0.0.1:${port}/v1/profiles`, {
          headers: {
            authorization: "Bearer server-token",
          },
        }),
        fetch(`http://127.0.0.1:${port}/v1/webhooks/jira`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            issue: {
              key: "PROJ-1",
              fields: {
                summary: "Webhook test",
                description: "A description long enough to pass the minimum length requirement.",
                status: { name: "In Progress" },
                issuetype: { name: "Bug" },
                labels: ["agent-ready"],
                assignee: { displayName: "agent-dev" },
                project: { key: "PROJ" },
              },
            },
          }),
        }),
      ]);

      expect(health.status).toBe(200);
      expect(ready.status).toBe(200);
      expect(profilesUnauthorized.status).toBe(401);
      expect(profilesAuthorized.status).toBe(200);
      expect(webhook.status).toBe(400);
      expect(health.headers.get("x-request-id")).toBeTruthy();
      expect(profilesAuthorized.headers.get("x-request-id")).toBeTruthy();
    } finally {
      await server.close();
    }
  });

  it("rejects non-loopback binds when no server auth token is configured", async () => {
    delete process.env.ARCHE_SERVER_AUTH_TOKEN;
    delete (globalThis as { __archeEnv?: unknown }).__archeEnv;
    vi.resetModules();

    const { startServer } = await import("../src/server");
    await expect(startServer({ host: "0.0.0.0", port: 0 })).rejects.toMatchObject({
      code: "server_auth_required",
    });
  });
});
