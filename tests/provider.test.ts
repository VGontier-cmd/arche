import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { OpenAICompatibleProvider } from "../src/lib/arche/provider";

describe("OpenAICompatibleProvider", () => {
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
    return new OpenAICompatibleProvider({
      worktreePath: workspace,
      modelName: "test-model",
      baseUrl: "https://llm.example.com/v1",
      apiKeyEnv: "TEST_PROVIDER_KEY",
      timeoutMs: 500,
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
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: payload } }],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
      );

      const result = await provider.completeAction([{ role: "user", content: "return an action" }]);
      expect(result.action).toMatchObject({
        action: "finish",
        implementedPlanDelta: "delta",
      });
    }
  });

  it("retries one time on retryable provider failures", async () => {
    const provider = makeProvider();

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("upstream error", { status: 500 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: `{"action":"finish","summary":"retried","implementedPlanDelta":"delta"}`,
                  },
                },
              ],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
    );

    const result = await provider.completeAction([{ role: "user", content: "return an action" }]);
    expect(result.action).toMatchObject({
      action: "finish",
      summary: "retried",
    });
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
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "not valid json" } }],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      planMarkdown: "1. Inspect popup\n2. Ship fix",
                      risks: [],
                      openQuestions: [],
                      needsHumanInput: false,
                    }),
                  },
                },
              ],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
    );

    const result = await provider.completeStructured([{ role: "user", content: "return plan json" }], schema);
    expect(result.output.planMarkdown).toContain("Inspect popup");
    expect(result.attempts).toHaveLength(2);
  });

  it("rejects invalid provider actions after parsing", async () => {
    const provider = makeProvider();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: `{"action":"unknown"}` } }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    await expect(provider.completeAction([{ role: "user", content: "return an action" }])).rejects.toMatchObject({
      code: "provider_output_invalid",
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
});
