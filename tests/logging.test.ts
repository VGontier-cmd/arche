import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createLogger,
  redactText,
  truncateText,
} from "../src/lib/arche/logging";

describe("logging", () => {
  const originalApiKey = process.env.ARCHE_DEFAULT_API_KEY;
  const originalLogLevel = process.env.ARCHE_LOG_LEVEL;
  const originalNoColor = process.env.NO_COLOR;

  beforeEach(() => {
    process.env.ARCHE_DEFAULT_API_KEY = "super-secret-token";
    process.env.ARCHE_LOG_LEVEL = "debug";
    delete process.env.NO_COLOR;
  });

  afterEach(() => {
    process.env.ARCHE_DEFAULT_API_KEY = originalApiKey;
    process.env.ARCHE_LOG_LEVEL = originalLogLevel;
    process.env.NO_COLOR = originalNoColor;
  });

  it("redacts configured secrets and generic bearer tokens", () => {
    expect(redactText("Bearer abc123")).toBe("Bearer [REDACTED]");
    expect(redactText("token=super-secret-token")).toContain("[REDACTED]");
    expect(redactText("token=super-secret-token")).not.toContain("super-secret-token");
  });

  it("writes pretty logs with correlation fields and redacted details", () => {
    let output = "";
    const stream = {
      write(chunk: string) {
        output += chunk;
        return true;
      },
    } as unknown as NodeJS.WritableStream;
    const logger = createLogger({
      service: "worker",
      stream,
    });

    logger.info("provider", "request failed", {
      runId: "run-123",
      ticketKey: "PROJ-123",
      event: "provider.request_failed",
      details: {
        token: "super-secret-token",
        auth: "Bearer abc123",
      },
    });

    expect(output).toContain("worker/provider");
    expect(output).toContain("provider.request_failed");
    expect(output).toContain("run=run-123");
    expect(output).toContain("ticket=PROJ-123");
    expect(output).toContain('token="[REDACTED]"');
    expect(output).toContain('auth="Bearer [REDACTED]"');
    expect(output).not.toContain("super-secret-token");
  });

  it("writes colored pretty logs on TTY streams", () => {
    let output = "";
    const stream = {
      isTTY: true,
      write(chunk: string) {
        output += chunk;
        return true;
      },
    } as unknown as NodeJS.WritableStream;
    const logger = createLogger({
      service: "server",
      stream,
    });

    logger.info("api", "server listening", {
      event: "server.started",
      details: {
        host: "0.0.0.0",
        port: 8787,
      },
    });

    expect(output).toContain("server/api");
    expect(output).toContain("server.started");
    expect(output).toContain('host="0.0.0.0"');
    expect(output).toContain("port=8787");
    expect(output).toContain("\u001B[");
    expect(output).not.toContain('{"ts"');
  });

  it("truncates long messages", () => {
    expect(truncateText("abcdef", 3)).toBe("abc...");
    expect(truncateText("abc", 3)).toBe("abc");
  });
});
