import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { OpenResponsesResult } from "@openrouter/sdk/models";
import {
  ConnectionError,
  OpenRouterError,
  RequestTimeoutError,
} from "@openrouter/sdk/models/errors";

import { OpenRouterSdkProvider } from "../src/lib/arche/provider";

// Mock the @openrouter/sdk module so tests don't make real HTTP calls.
// We mock callModel() directly — this is cleaner than faking SSE streams.
const mockCallModel = vi.fn();
vi.mock("@openrouter/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openrouter/sdk")>();
  return {
    ...actual,
    // Regular function (not arrow) so `new OpenRouter(...)` works as a constructor.
    OpenRouter: vi.fn().mockImplementation(function () {
      return {
        callModel: mockCallModel,
        models: { list: vi.fn().mockResolvedValue({ data: [] }) },
        credits: { getCredits: vi.fn().mockResolvedValue({ data: { totalCredits: 0, totalUsage: 0 } }) },
      };
    }),
  };
});

/** Build a minimal OpenResponsesResult for a given text content. */
function responsesResult(text: string): OpenResponsesResult {
  return {
    id: "resp_test",
    object: "response",
    createdAt: 1700000000,
    model: "test-model",
    status: "completed",
    completedAt: 1700000000,
    output: [
      {
        type: "message",
        id: "msg_test",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      } as OpenResponsesResult["output"][number],
    ],
    outputText: text,
    usage: {
      inputTokens: 10,
      inputTokensDetails: { cachedTokens: 0 },
      outputTokens: text.length,
      outputTokensDetails: { reasoningTokens: 0 },
      totalTokens: 10 + text.length,
    },
    error: null,
    incompleteDetails: null,
    instructions: null,
    metadata: {},
    tools: [],
    toolChoice: "none" as never,
    parallelToolCalls: false,
    temperature: 0.1,
    topP: 1.0,
    presencePenalty: 0,
    frequencyPenalty: 0,
  };
}

/** Configure callModel mock to return the given text. */
function mockLlmResponse(text: string) {
  mockCallModel.mockReturnValue({
    getResponse: vi.fn().mockResolvedValue(responsesResult(text)),
    getText: vi.fn().mockResolvedValue(text),
    getTextStream: (async function* () {})(),
    getToolCallsStream: (async function* () {})(),
  });
}

/** Configure callModel mock to throw on first call, succeed on second. */
function mockLlmRetry(firstError: unknown, successText: string) {
  mockCallModel
    .mockReturnValueOnce({
      getResponse: vi.fn().mockRejectedValue(firstError),
    })
    .mockReturnValue({
      getResponse: vi.fn().mockResolvedValue(responsesResult(successText)),
    });
}

describe("OpenRouterSdkProvider", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "arche-provider-"));
    process.env.TEST_PROVIDER_KEY = "provider-token";
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.TEST_PROVIDER_KEY;
    await rm(workspace, { recursive: true, force: true });
  });

  function makeProvider() {
    return new OpenRouterSdkProvider({
      worktreePath: workspace,
      modelName: "test-model",
      baseUrl: "https://llm.example.com/v1",
      apiKeyEnv: "TEST_PROVIDER_KEY",
      timeoutMs: 500,
    });
  }

  function makeProviderWithOverrides(overrides: Partial<ConstructorParameters<typeof OpenRouterSdkProvider>[0]>) {
    return new OpenRouterSdkProvider({
      worktreePath: workspace,
      modelName: "test-model",
      baseUrl: "https://llm.example.com/v1",
      apiKeyEnv: "TEST_PROVIDER_KEY",
      timeoutMs: 500,
      ...overrides,
    });
  }

  it("captures request and response artifacts for each attempt", async () => {
    const provider = makeProvider();
    const schema = z.object({ text: z.string() });
    mockLlmResponse(`{"text":"ok"}`);

    const result = await provider.completeStructured([{ role: "user", content: "return json" }], schema);

    expect(result.attempts).toHaveLength(1);
    // requestBody contains callModel params (Responses API / OpenResponses format)
    expect(result.attempts[0]).toMatchObject({
      requestBody: {
        model: "test-model",
        input: [{ role: "user", content: "return json" }],
        temperature: 0.1,
      },
      responseStatus: 200,
    });
    // responseBody is the parsed OpenResponsesResult
    expect(result.attempts[0]?.responseBody).toMatchObject({
      id: "resp_test",
      model: "test-model",
      outputText: expect.stringContaining("ok"),
    });
  });

  it("callModel params are unaffected by stream key in extraBody", async () => {
    const provider = makeProviderWithOverrides({ extraBody: { stream: true } });
    const schema = z.object({ ok: z.boolean() });
    mockLlmResponse(`{"ok":true}`);

    const result = await provider.completeStructured([{ role: "user", content: "return json" }], schema);
    expect(result.output.ok).toBe(true);
  });

  it("retries one time on retryable provider failures", async () => {
    const provider = makeProvider();
    const schema = z.object({ text: z.string() });
    const retryableError = new OpenRouterError("upstream error", {
      response: new Response("upstream error", { status: 500 }),
      request: new Request("https://dummy.test"),
      body: "upstream error",
    });
    mockLlmRetry(retryableError, `{"text":"retried"}`);

    const result = await provider.completeStructured([{ role: "user", content: "return json" }], schema);
    expect(result.output.text).toBe("retried");
    expect(result.attempts).toHaveLength(2);
  });

  it("retries one time on rate-limited OpenRouter responses", async () => {
    const provider = makeProvider();
    const schema = z.object({ text: z.string() });
    const rateLimitError = new OpenRouterError("rate limited", {
      response: new Response('{"error":{"code":429}}', { status: 429 }),
      request: new Request("https://dummy.test"),
      body: '{"error":{"code":429}}',
    });
    mockLlmRetry(rateLimitError, `{"text":"retried-after-429"}`);

    const result = await provider.completeStructured([{ role: "user", content: "return json" }], schema);
    expect(result.output.text).toBe("retried-after-429");
    expect(result.attempts).toHaveLength(2);
  });

  it("repairs invalid structured JSON once for planner or reviewer calls", async () => {
    const provider = makeProvider();
    const schema = z.object({
      planMarkdown: z.string(),
      risks: z.array(z.string()),
      openQuestions: z.array(z.string()),
      needsHumanInput: z.boolean(),
    });

    mockCallModel
      .mockReturnValueOnce({ getResponse: vi.fn().mockResolvedValue(responsesResult("not valid json")) })
      .mockReturnValue({
        getResponse: vi.fn().mockResolvedValue(
          responsesResult(JSON.stringify({
            planMarkdown: "1. Inspect popup\n2. Ship fix",
            risks: [],
            openQuestions: [],
            needsHumanInput: false,
          })),
        ),
      });

    const result = await provider.completeStructured([{ role: "user", content: "return plan json" }], schema);
    expect(result.output.planMarkdown).toContain("Inspect popup");
    expect(result.attempts).toHaveLength(2);
  });

  it("rejects invalid structured JSON after repair attempt", async () => {
    const provider = makeProvider();
    const schema = z.object({ required: z.string() });
    mockCallModel
      .mockReturnValue({ getResponse: vi.fn().mockResolvedValue(responsesResult("not valid json at all")) });

    await expect(
      provider.completeStructured([{ role: "user", content: "return json" }], schema),
    ).rejects.toMatchObject({
      code: "provider_output_invalid",
    });
  });

  it("maps SDK timeout errors to provider_request_timeout", async () => {
    const provider = makeProvider();
    const schema = z.object({ text: z.string() });
    const timeoutError = new RequestTimeoutError("timed out");
    mockCallModel.mockReturnValue({ getResponse: vi.fn().mockRejectedValue(timeoutError) });

    await expect(
      provider.completeStructured([{ role: "user", content: "return json" }], schema),
    ).rejects.toMatchObject({
      code: "provider_request_timeout",
    });
  });

  it("maps non-retryable HTTP errors to provider_request_failed", async () => {
    const provider = makeProvider();
    const schema = z.object({ text: z.string() });
    const badRequestError = new OpenRouterError("bad request", {
      response: new Response("bad request", { status: 400 }),
      request: new Request("https://dummy.test"),
      body: "bad request",
    });
    mockCallModel.mockReturnValue({ getResponse: vi.fn().mockRejectedValue(badRequestError) });

    await expect(
      provider.completeStructured([{ role: "user", content: "return json" }], schema),
    ).rejects.toMatchObject({
      code: "provider_request_failed",
    });
  });

  it("supports partial file reads with truncation metadata", async () => {
    const provider = makeProvider();
    await writeFile(join(workspace, "large.txt"), "a".repeat(80_000), "utf8");

    const result = await provider.readFiles({ files: [{ path: "large.txt", offset: 1024, limit: 4096 }] });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      path: "large.txt",
      offset: 1024,
      returned_bytes: 4096,
      truncated: true,
      next_offset: 5120,
    });
    expect(result.files[0]?.content).toHaveLength(4096);
  });

  it("deduplicates identical read requests within a provider session", async () => {
    const provider = makeProvider();
    const filePath = join(workspace, "dedup.txt");
    await writeFile(filePath, "cached content", "utf8");

    const first = await provider.readFiles({ files: [{ path: "dedup.txt", offset: 0, limit: 32 }] });
    await rm(filePath, { force: true });
    const second = await provider.readFiles({ files: [{ path: "dedup.txt", offset: 0, limit: 32 }] });

    expect(first).toEqual(second);
  });

  it("writes a new file inside the worktree", async () => {
    const provider = makeProvider();
    const result = await provider.writeFile("new-file.txt", "hello world");

    expect(result).toMatchObject({ result: "file_written", path: "new-file.txt", created: true });
    expect(result.bytes_written).toBeGreaterThan(0);

    const content = await readFile(join(workspace, "new-file.txt"), "utf8");
    expect(content).toBe("hello world");
  });

  it("overwrites an existing file and reports created=false", async () => {
    const provider = makeProvider();
    await writeFile(join(workspace, "existing.txt"), "old content", "utf8");

    const result = await provider.writeFile("existing.txt", "new content");
    expect(result.created).toBe(false);

    const content = await readFile(join(workspace, "existing.txt"), "utf8");
    expect(content).toBe("new content");
  });

  it("creates parent directories for nested file writes", async () => {
    const provider = makeProvider();
    const result = await provider.writeFile("deep/nested/dir/file.ts", "export default 1;");

    expect(result.created).toBe(true);
    const content = await readFile(join(workspace, "deep/nested/dir/file.ts"), "utf8");
    expect(content).toBe("export default 1;");
  });

  it("rejects file writes that escape the worktree root", async () => {
    const provider = makeProvider();
    await expect(provider.writeFile("../escape.txt", "bad")).rejects.toThrow("escapes repository root");
  });

  it("rejects file writes exceeding the size limit", async () => {
    const provider = makeProvider();
    const hugeContent = "x".repeat(300 * 1024);
    await expect(provider.writeFile("huge.txt", hugeContent)).rejects.toThrow("exceeds limit");
  });

  it("deletes an existing file", async () => {
    const provider = makeProvider();
    await writeFile(join(workspace, "to-delete.txt"), "bye", "utf8");

    const result = await provider.deleteFile("to-delete.txt");
    expect(result).toMatchObject({ result: "file_deleted", path: "to-delete.txt" });

    await expect(readFile(join(workspace, "to-delete.txt"))).rejects.toThrow();
  });

  it("rejects deleting a file that does not exist", async () => {
    const provider = makeProvider();
    await expect(provider.deleteFile("ghost.txt")).rejects.toThrow("does not exist");
  });

  it("invalidates read cache after writing a file", async () => {
    const provider = makeProvider();
    await writeFile(join(workspace, "cached.txt"), "original", "utf8");

    const firstRead = await provider.readFiles({ paths: ["cached.txt"] });
    expect(firstRead.files[0]?.content).toBe("original");

    await provider.writeFile("cached.txt", "updated");

    const secondRead = await provider.readFiles({ paths: ["cached.txt"] });
    expect(secondRead.files[0]?.content).toBe("updated");
  });
});
