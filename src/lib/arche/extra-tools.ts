/**
 * Optional executor tools activated per-repo via .arche/tools.json or DB enabledTools field.
 * These run in the worker process (not the sandbox) and can access external services.
 */
import { tool } from "@openrouter/sdk/lib/tool";
import { z } from "zod";

import { truncateText } from "./logging";

export const AVAILABLE_EXTRA_TOOLS = ["web_search", "fetch_url"] as const;
export type ExtraToolName = (typeof AVAILABLE_EXTRA_TOOLS)[number];

export type ExtraToolsOptions = {
  fetchUrlTimeoutMs?: number;
  webSearchTimeoutMs?: number;
};

const DEFAULT_FETCH_URL_TIMEOUT_MS = 12_000;
const DEFAULT_WEB_SEARCH_TIMEOUT_MS = 10_000;

function makeFetchUrlTool(timeoutMs: number) {
  return tool({
    name: "fetch_url",
    description:
      "Fetch the text content of a URL — useful to read documentation, API specs, changelogs, or any public resource relevant to the task.",
    inputSchema: z.object({
      url: z.string().url().describe("The URL to fetch"),
    }),
    execute: async ({ url }) => {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "User-Agent": "Arche-Agent/1.0" },
      });
      const text = await res.text();
      return {
        url,
        status: res.status,
        content: truncateText(text, 6000),
        truncated: text.length > 6000,
      };
    },
  });
}

function makeWebSearchTool(timeoutMs: number) {
  return tool({
    name: "web_search",
    description:
      "Search the web for up-to-date information — library docs, error messages, API references, best practices.",
    inputSchema: z.object({
      query: z.string().describe("Search query"),
    }),
    execute: async ({ query }) => {
      const apiKey = process.env.SERPER_API_KEY ?? process.env.BRAVE_API_KEY ?? "";
      if (!apiKey) {
        return { error: "No web search API key configured (SERPER_API_KEY or BRAVE_API_KEY)" };
      }

      // Serper (Google results) — 2500 free req/month at serper.dev
      if (process.env.SERPER_API_KEY) {
        const res = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: {
            "X-API-KEY": process.env.SERPER_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ q: query, num: 6 }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const data = await res.json() as { organic?: Array<{ title: string; link: string; snippet: string }> };
        return {
          results: (data.organic ?? []).slice(0, 6).map((r) => ({
            title: r.title,
            url: r.link,
            snippet: r.snippet,
          })),
        };
      }

      // Brave Search fallback
      const res = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=6`,
        {
          headers: { "X-Subscription-Token": process.env.BRAVE_API_KEY ?? "" },
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
      const data = await res.json() as { web?: { results?: Array<{ title: string; url: string; description: string }> } };
      return {
        results: (data.web?.results ?? []).slice(0, 6).map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.description,
        })),
      };
    },
  });
}

/** Return tool instances for the requested tool names. Skips unknown names silently. */
export function buildExtraTools(names: string[], options: ExtraToolsOptions = {}) {
  const fetchUrlMs = options.fetchUrlTimeoutMs ?? DEFAULT_FETCH_URL_TIMEOUT_MS;
  const webSearchMs = options.webSearchTimeoutMs ?? DEFAULT_WEB_SEARCH_TIMEOUT_MS;

  const TOOL_MAP: Record<ExtraToolName, ReturnType<typeof tool>> = {
    fetch_url: makeFetchUrlTool(fetchUrlMs),
    web_search: makeWebSearchTool(webSearchMs),
  };

  return names
    .filter((n): n is ExtraToolName => n in TOOL_MAP)
    .map((n) => TOOL_MAP[n]);
}
