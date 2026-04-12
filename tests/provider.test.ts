import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { OpenRouterSdkProvider } from "../src/lib/arche/provider";

function chatCompletionResponse(content: string) {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-test",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content,
          },
        },
      ],
      created: 1,
      model: "test-model",
      object: "chat.completion",
      system_fingerprint: null,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

describe("OpenRouterSdkProvider", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "arche-provider-"));
    process.env.TEST_PROVIDER_KEY = "provider-token";
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

  it("accepts raw JSON, fenced JSON, and noisy JSON payloads for executor actions", async () => {
    const provider = makeProvider();
    const payloads = [
      `{"action":"finish","summary":"raw","implementedPlanDelta":"delta"}`,
      "```json\n{\"action\":\"finish\",\"summary\":\"fenced\",\"implementedPlanDelta\":\"delta\"}\n```",
      "I looked at it.\n{\"action\":\"finish\",\"summary\":\"noisy\",\"implementedPlanDelta\":\"delta\"}\nDone.",
    ];

    for (const payload of payloads) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(chatCompletionResponse(payload)));

      const result = await provider.completeAction([{ role: "user", content: "return an action" }]);
      expect(result.action).toMatchObject({
        action: "finish",
        implementedPlanDelta: "delta",
      });
    }
  });

  it("captures request and response artifacts for each attempt", async () => {
    const provider = makeProvider();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(chatCompletionResponse(`{"action":"finish","summary":"ok","implementedPlanDelta":"delta"}`)),
    );

    const result = await provider.completeAction([{ role: "user", content: "return an action" }]);

    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({
      requestBody: {
        model: "test-model",
        messages: [{ role: "user", content: "return an action" }],
        temperature: 0.1,
        stream: false,
      },
      responseStatus: 200,
    });
    expect(result.attempts[0]?.responseText).toContain(`"id":"chatcmpl-test"`);
    expect(result.attempts[0]?.responseBody).toMatchObject({
      id: "chatcmpl-test",
      model: "test-model",
    });
  });

  it("keeps requests non-streaming even when extraBody asks for streaming", async () => {
    const provider = makeProviderWithOverrides({
      extraBody: {
        stream: true,
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(chatCompletionResponse(`{"action":"finish","summary":"ok","implementedPlanDelta":"delta"}`)),
    );

    const result = await provider.completeAction([{ role: "user", content: "return an action" }]);

    expect(result.attempts[0]?.requestBody).toMatchObject({
      stream: false,
    });
  });

  it("retries one time on retryable provider failures", async () => {
    const provider = makeProvider();

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("upstream error", { status: 500, headers: { "Content-Type": "text/plain" } }))
        .mockResolvedValueOnce(
          chatCompletionResponse(`{"action":"finish","summary":"retried","implementedPlanDelta":"delta"}`),
        ),
    );

    const result = await provider.completeAction([{ role: "user", content: "return an action" }]);
    expect(result.action).toMatchObject({
      action: "finish",
      summary: "retried",
    });
  });

  it("retries one time on rate-limited OpenRouter responses", async () => {
    const provider = makeProvider();

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                message: "rate limited",
                code: 429,
              },
            }),
            {
              status: 429,
              headers: { "Content-Type": "application/json" },
            },
          ),
        )
        .mockResolvedValueOnce(
          chatCompletionResponse(`{"action":"finish","summary":"retried-after-429","implementedPlanDelta":"delta"}`),
        ),
    );

    const result = await provider.completeAction([{ role: "user", content: "return an action" }]);

    expect(result.action).toMatchObject({
      action: "finish",
      summary: "retried-after-429",
    });
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

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(chatCompletionResponse("not valid json"))
        .mockResolvedValueOnce(
          chatCompletionResponse(
            JSON.stringify({
              planMarkdown: "1. Inspect popup\n2. Ship fix",
              risks: [],
              openQuestions: [],
              needsHumanInput: false,
            }),
          ),
        ),
    );

    const result = await provider.completeStructured([{ role: "user", content: "return plan json" }], schema);
    expect(result.output.planMarkdown).toContain("Inspect popup");
    expect(result.attempts).toHaveLength(2);
  });

  it("rejects invalid provider actions after parsing", async () => {
    const provider = makeProvider();

    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => chatCompletionResponse(`{"action":"unknown"}`)));

    await expect(provider.completeAction([{ role: "user", content: "return an action" }])).rejects.toMatchObject({
      code: "provider_output_invalid",
    });
  });

  it("maps SDK timeout errors to provider_request_timeout", async () => {
    const provider = makeProvider();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(
        Object.assign(new Error("Request timed out"), {
          name: "TimeoutError",
        }),
      ),
    );

    await expect(provider.completeAction([{ role: "user", content: "return an action" }])).rejects.toMatchObject({
      code: "provider_request_timeout",
    });
  });

  it("maps non-retryable HTTP errors to provider_request_failed", async () => {
    const provider = makeProvider();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("bad request", {
          status: 400,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );

    await expect(provider.completeAction([{ role: "user", content: "return an action" }])).rejects.toMatchObject({
      code: "provider_request_failed",
    });
  });

  it("supports partial file reads with truncation metadata", async () => {
    const provider = makeProvider();
    await writeFile(join(workspace, "large.txt"), "a".repeat(80_000), "utf8");

    const result = await provider.readFiles({
      files: [{ path: "large.txt", offset: 1024, limit: 4096 }],
    });

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

    const first = await provider.readFiles({
      files: [{ path: "dedup.txt", offset: 0, limit: 32 }],
    });
    await rm(filePath, { force: true });
    const second = await provider.readFiles({
      files: [{ path: "dedup.txt", offset: 0, limit: 32 }],
    });

    expect(first).toEqual(second);
  });

  it("writes a new file inside the worktree", async () => {
    const provider = makeProvider();
    const result = await provider.writeFile("new-file.txt", "hello world");

    expect(result).toMatchObject({
      result: "file_written",
      path: "new-file.txt",
      created: true,
    });
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
