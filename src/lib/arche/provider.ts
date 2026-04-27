/**
 * SDK-backed client for Arche model calls. Uses the OpenRouter SDK's callModel() API
 * (OpenResponses endpoint) for all LLM calls.
 */
import { dirname } from "node:path";
import { readFile, writeFile as fsWriteFile, unlink } from "node:fs/promises";

import { OpenRouter } from "@openrouter/sdk";
import type { EasyInputMessage } from "@openrouter/sdk/models";
import type { ReasoningConfig } from "@openrouter/sdk/models";
import type { OpenResponsesResult } from "@openrouter/sdk/models";
import type { OutputReasoningItem } from "@openrouter/sdk/models";
import {
  ConnectionError,
  OpenRouterError,
  RequestAbortedError,
  RequestTimeoutError,
} from "@openrouter/sdk/models/errors";
import { z, type ZodType } from "zod";

import { ExternalServiceError } from "./errors";
import { redactText } from "./logging";
import type { ProviderReadFileRequest } from "./types";
import { createPathGuard, ensureDirectory } from "./utils";

const MAX_READ_REQUESTS = 20;
const MAX_FILE_READ_BYTES = 64 * 1024;
const MAX_FILE_WRITE_BYTES = 256 * 1024;
const MAX_ACTION_READ_BYTES = 256 * 1024;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504, 524, 529]);
const JSON_REPAIR_MESSAGE =
  "Your previous response was invalid. Return only a corrected JSON object matching the requested schema.";

type ProviderReadResult = {
  path: string;
  offset: number;
  returned_bytes: number;
  truncated: boolean;
  next_offset?: number;
  content: string;
  missing?: boolean;
};


export type ProviderImageInput = { type: "image_url"; url: string };
export type ProviderMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  /**
   * Optional images to attach to a user message. The provider lifts them into
   * a multimodal `content` array on the user-role message before sending.
   */
  images?: ProviderImageInput[];
};

export type ProviderStreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "reasoning_delta"; delta: string }
  | { type: "tool_call_args_delta"; delta: string };

export type ProviderInvocation = {
  worktreePath?: string;
  modelName: string;
  fallbackModel?: string | null;
  baseUrl: string;
  apiKeyEnv: string;
  temperature?: number;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  thinkingEnabled?: boolean;
  thinkingBudgetTokens?: number;
  /** Used in HTTP headers for OpenRouter analytics ranking */
  role?: string;
  /**
   * Optional sink for live SDK events while the model talks. Caller wires
   * this to its dashboard channel so the planner / reviewer / researcher
   * also stream — not just the executor (which has its own stream loop).
   */
  onStreamEvent?: (event: ProviderStreamEvent) => void;
};

export type ProviderUsage = {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
};

export type ProviderAttempt = {
  requestBody: Record<string, unknown>;
  responseStatus?: number;
  responseBody?: unknown;
  responseText?: string;
  error?: string;
  usage?: ProviderUsage;
  thinkingText?: string | null;
};

function extractJsonCandidates(text: string) {
  const candidates = new Set<string>();
  const trimmed = text.trim();
  if (trimmed) {
    candidates.add(trimmed);
  }

  const codeBlockPattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (const match of trimmed.matchAll(codeBlockPattern)) {
    if (match[1]?.trim()) {
      candidates.add(match[1].trim());
    }
  }

  const inlineJson = extractFirstJsonObject(trimmed);
  if (inlineJson) {
    candidates.add(inlineJson);
  }

  return [...candidates];
}

function extractFirstJsonObject(text: string) {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (char === "\\") { escaped = true; continue; }
      if (char === '"') { inString = false; }
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === "}") {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

/**
 * Strip JSON Schema fields that strict provider validators (Anthropic in
 * particular) reject: zod-v4 internals (`~standard`, `_zod`), `$schema`,
 * `default` (which providers don't honour anyway), and any property whose
 * name starts with `~` or `_`. Recurses through nested schemas.
 */
function stripUnsupportedJsonSchemaFields(input: unknown): Record<string, unknown> {
  if (Array.isArray(input)) {
    return input.map((item) => stripUnsupportedJsonSchemaFields(item)) as unknown as Record<string, unknown>;
  }
  if (input === null || typeof input !== "object") {
    return input as Record<string, unknown>;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (key.startsWith("~") || key.startsWith("_")) continue;
    if (key === "$schema" || key === "default" || key === "$id") continue;
    if (value && typeof value === "object") {
      out[key] = stripUnsupportedJsonSchemaFields(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function parseJsonWithSchema<T>(text: string, schema: ZodType<T>): T {
  for (const candidate of extractJsonCandidates(text)) {
    try {
      return schema.parse(JSON.parse(candidate));
    } catch {
      continue;
    }
  }
  throw new ExternalServiceError(
    `Provider output invalid: ${redactText(text).slice(0, 500)}`,
    "provider_output_invalid",
  );
}

function parseResponseBody(rawText: string): unknown {
  if (!rawText) return null;
  try {
    return JSON.parse(rawText);
  } catch {
    return rawText;
  }
}

function extractTextFromResponse(response: OpenResponsesResult): string {
  // outputText is pre-computed by the SDK from all message output items
  if (response.outputText != null) return response.outputText;
  // Fallback: iterate output items
  return response.output
    .flatMap((item) => {
      if (item.type !== "message") return [];
      const content = (item as { content?: unknown }).content;
      if (typeof content === "string") return [content];
      if (Array.isArray(content)) {
        return content.flatMap((c: unknown) =>
          typeof c === "object" && c !== null && "type" in c && (c as { type: string }).type === "output_text" && "text" in c
            ? [(c as { text: string }).text]
            : [],
        );
      }
      return [];
    })
    .join("");
}

function extractReasoningFromResponse(response: OpenResponsesResult): string | null {
  const reasoningItem = response.output.find(
    (item): item is OutputReasoningItem => item.type === "reasoning",
  );
  if (!reasoningItem?.summary?.length) return null;
  return reasoningItem.summary.map((s) => s.text).join("");
}

export function extractLastThinking(attempts: ProviderAttempt[]): string | null {
  for (let i = attempts.length - 1; i >= 0; i--) {
    if (attempts[i].thinkingText) return attempts[i].thinkingText ?? null;
  }
  return null;
}

export class OpenRouterSdkProvider {
  private readonly readCache = new Map<string, ProviderReadResult>();

  constructor(private readonly invocation: ProviderInvocation) {}

  private get apiKey() {
    const apiKey = process.env[this.invocation.apiKeyEnv];
    if (!apiKey) {
      throw new ExternalServiceError(
        `Missing API key environment variable referenced by ${this.invocation.apiKeyEnv}`,
      );
    }
    return apiKey;
  }

  private buildReasoningConfig(): ReasoningConfig | undefined {
    if (!this.invocation.thinkingEnabled) return undefined;
    const budget = this.invocation.thinkingBudgetTokens ?? 5000;
    const isAnthropic = this.invocation.modelName.startsWith("anthropic/");
    const isOSeries = /\/(o1|o3|o4)/.test(this.invocation.modelName);
    if (isAnthropic) return { enabled: true, maxTokens: budget };
    if (isOSeries) return { effort: "medium" };
    return undefined;
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      "HTTP-Referer": "https://github.com/anthropics/arche",
      "X-Title": this.invocation.role ? `Arche-${this.invocation.role}` : "Arche",
      ...(extra ?? {}),
    };
  }

  /**
   * Build the OpenResponses `text.format` config for native structured outputs.
   * When provided, the model is constrained to emit valid JSON matching the
   * schema — no manual repair pass needed.
   *
   * Zod v4's `toJSONSchema` injects a `~standard` marker (and friends) that
   * Anthropic's strict schema validator rejects with a 400. We strip every
   * `~`-prefixed key and the standard JSON Schema metadata that providers
   * routinely refuse before handing the schema off.
   */
  private buildJsonSchemaFormat<T>(schema: ZodType<T>, name: string) {
    try {
      const raw = z.toJSONSchema(schema, { target: "draft-7" });
      // CRITICAL: zod v4's `toJSONSchema` attaches `~standard` (Standard
      // Schema marker) as a NON-ENUMERABLE property via Object.defineProperty.
      // It's invisible to JSON.stringify and Object.entries, but the
      // Speakeasy outbound serializer in @openrouter/sdk picks it up via
      // Reflect.ownKeys and forwards it to Anthropic, which rejects it. The
      // JSON round-trip below produces a clean plain object with only
      // enumerable own properties — no hidden traps.
      const cleaned = stripUnsupportedJsonSchemaFields(
        JSON.parse(JSON.stringify(raw)) as Record<string, unknown>,
      );
      return {
        format: {
          type: "json_schema" as const,
          name,
          schema: cleaned,
          strict: false,
        },
      };
    } catch {
      // Some Zod constructs (preprocess, transforms) can't be serialised.
      // Falling back to no format means we keep the legacy repair pass.
      return undefined;
    }
  }

  private async requestText(
    messages: ProviderMessage[],
    attempts: ProviderAttempt[],
    options: { jsonSchema?: ZodType<unknown>; jsonSchemaName?: string } = {},
  ) {
    const timeoutMs =
      typeof this.invocation.timeoutMs === "number" && this.invocation.timeoutMs > 0
        ? this.invocation.timeoutMs
        : 60_000;

    const isAnthropic = this.invocation.modelName.startsWith("anthropic/");
    // When thinking is enabled for Claude, temperature must be 1.0
    const temperature = this.invocation.thinkingEnabled && isAnthropic
      ? 1.0
      : typeof this.invocation.temperature === "number" ? this.invocation.temperature : 0.1;

    const reasoning = this.buildReasoningConfig();
    const extraBody = this.invocation.extraBody ?? {};

    // Split system prompt out — callModel takes it as `instructions`
    const systemMsg = messages.find((m) => m.role === "system");
    const inputMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        // When images are attached to a user message, lift the content into a
        // multimodal array so the planner / executor can actually see them.
        if (m.role === "user" && m.images && m.images.length > 0) {
          return {
            role: m.role,
            content: [
              { type: "input_text" as const, text: m.content },
              ...m.images.map((img) => ({
                type: "input_image" as const,
                detail: "auto" as const,
                imageUrl: img.url,
              })),
            ],
          };
        }
        return { role: m.role, content: m.content };
      }) as EasyInputMessage[];

    // Build the list of models to try in order: primary, then fallback (if any).
    const modelsToTry: string[] = [this.invocation.modelName];
    if (
      this.invocation.fallbackModel &&
      this.invocation.fallbackModel !== this.invocation.modelName
    ) {
      modelsToTry.push(this.invocation.fallbackModel);
    }

    // Stripped after a 400 that names format.schema — providers vary on which
    // JSON Schema fields they accept, and the cheapest fix is to disable our
    // structured-output hint and fall through to the legacy repair pass.
    //
    // Anthropic's strict mode rejects every JSON Schema we generate (zod's
    // `~standard` non-enumerable marker leaks through Speakeasy's outbound
    // serializer no matter how we sanitize), so skip the wasted attempt up
    // front for that family. Other providers (OpenAI gpt-5.x, Mistral, etc.)
    // accept our schemas fine.
    let disableJsonSchema = this.invocation.modelName.startsWith("anthropic/");

    let lastFatalError: unknown = null;
    for (let modelIdx = 0; modelIdx < modelsToTry.length; modelIdx++) {
      const modelName = modelsToTry[modelIdx]!;
      const isFallback = modelIdx > 0;

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const textFormat = options.jsonSchema && !disableJsonSchema
          ? this.buildJsonSchemaFormat(options.jsonSchema, options.jsonSchemaName ?? "structured_output")
          : undefined;
        const callParams = {
          ...extraBody,
          model: modelName,
          ...(systemMsg ? { instructions: systemMsg.content } : {}),
          ...(inputMessages.length > 0 ? { input: inputMessages } : {}),
          temperature,
          ...(reasoning ? { reasoning } : {}),
          ...(textFormat ? { text: textFormat } : {}),
        };
        const attemptRecord: ProviderAttempt = { requestBody: callParams };
        attempts.push(attemptRecord);

        try {
          const client = new OpenRouter({
            apiKey: this.apiKey,
            serverURL: this.invocation.baseUrl,
          });
          const result = client.callModel(callParams, {
            headers: this.buildHeaders(this.invocation.extraHeaders),
            timeoutMs,
            retries: { strategy: "none" },
          });

          // Optional concurrent stream consumer for the dashboard. Pumps text
          // / reasoning / tool-args deltas to the caller's sink so planner,
          // reviewer and researcher light up the live "agent typing" panel
          // exactly like the executor does. Best-effort — a stream failure
          // never blocks getResponse().
          const sink = this.invocation.onStreamEvent;
          const streamPump = sink
            ? (async () => {
                try {
                  for await (const ev of result.getFullResponsesStream()) {
                    const t = (ev as { type: string }).type;
                    if (t === "response.output_text.delta") {
                      sink({ type: "text_delta", delta: (ev as { delta: string }).delta });
                    } else if (t === "response.reasoning_summary_text.delta") {
                      sink({ type: "reasoning_delta", delta: (ev as { delta: string }).delta });
                    } else if (t === "response.function_call_arguments.delta") {
                      sink({ type: "tool_call_args_delta", delta: (ev as { delta: string }).delta });
                    }
                  }
                } catch {
                  // ignored — best-effort
                }
              })()
            : null;

          const response = await result.getResponse();
          if (streamPump) await streamPump.catch(() => undefined);

          attemptRecord.responseStatus = 200;
          attemptRecord.responseBody = response;
          if (response.usage) {
            const usage = response.usage as {
              inputTokens: number;
              outputTokens: number;
              cachedTokens?: number;
              cacheReadInputTokens?: number;
            };
            attemptRecord.usage = {
              promptTokens: usage.inputTokens,
              completionTokens: usage.outputTokens,
              cachedTokens: usage.cachedTokens ?? usage.cacheReadInputTokens,
            };
          }

          const text = extractTextFromResponse(response);
          attemptRecord.thinkingText = extractReasoningFromResponse(response);
          if (isFallback) {
            console.warn(
              `[provider] using fallback model ${modelName} after primary ${this.invocation.modelName} failed`,
            );
          }
          return text;
        } catch (error) {
          if (error instanceof OpenRouterError) {
            attemptRecord.responseStatus ??= error.statusCode;
            attemptRecord.responseText ??= error.body;
            attemptRecord.responseBody ??= parseResponseBody(error.body);

            // Strict-schema rejection: the provider doesn't support some
            // field in our JSON Schema (Anthropic in particular has a narrow
            // subset). Disable the schema and retry without it — the legacy
            // repair pass in completeStructured handles malformed JSON.
            const errorBody = error.body ?? "";
            if (
              error.statusCode === 400 &&
              !disableJsonSchema &&
              /format\.schema|is not supported|invalid_request_error|~standard/i.test(errorBody)
            ) {
              disableJsonSchema = true;
              attemptRecord.error = `JSON Schema rejected by provider, retrying without: ${redactText(errorBody).slice(0, 200)}`;
              console.warn(
                `[provider] schema rejected (model=${modelName}, attempt=${attempt}), retrying without text.format`,
              );
              // Don't increment `attempt` for this case — the schema-rejection
              // doesn't count against the per-call retry budget. We rewind so
              // the no-schema attempt gets full chances to retry on transient
              // network errors.
              attempt -= 1;
              continue;
            }

            if (RETRYABLE_STATUS_CODES.has(error.statusCode) && attempt < 2) {
              continue;
            }
            // Switch to fallback model on terminal model-availability errors.
            const isModelUnavailable =
              error.statusCode === 404 ||
              error.statusCode === 503 ||
              (error.statusCode >= 500 && error.statusCode < 600);
            if (isModelUnavailable && modelIdx + 1 < modelsToTry.length) {
              lastFatalError = error;
              break; // break attempt loop, advance to next model
            }
            throw new ExternalServiceError(
              `Inference server request failed: ${error.statusCode} ${redactText(error.body).slice(0, 500)}`,
              "provider_request_failed",
            );
          }

          const timedOut = error instanceof RequestTimeoutError || error instanceof RequestAbortedError;
          const retryable = timedOut || error instanceof ConnectionError;
          attemptRecord.error ??= error instanceof Error ? error.message : "Unknown provider error";

          if (retryable && attempt < 2) {
            continue;
          }
          // Connection-level failures: try fallback model before giving up.
          if (
            (error instanceof ConnectionError || timedOut) &&
            modelIdx + 1 < modelsToTry.length
          ) {
            lastFatalError = error;
            break; // break attempt loop, advance to next model
          }
          if (timedOut) {
            throw new ExternalServiceError(
              `Inference server request timed out after ${timeoutMs}ms`,
              "provider_request_timeout",
            );
          }
          if (error instanceof ConnectionError) {
            throw new ExternalServiceError(
              "Inference server request failed without a provider response",
              "provider_request_failed",
            );
          }
          throw error;
        }
      }
    }

    if (lastFatalError instanceof OpenRouterError) {
      throw new ExternalServiceError(
        `Inference server request failed (all models exhausted): ${lastFatalError.statusCode} ${redactText(lastFatalError.body).slice(0, 500)}`,
        "provider_request_failed",
      );
    }
    throw new ExternalServiceError(
      "Inference server request failed without a provider response",
      "provider_request_failed",
    );
  }

  async completeStructured<T>(
    messages: ProviderMessage[],
    schema: ZodType<T>,
    schemaHint?: string,
    options: { schemaName?: string } = {},
  ) {
    const attempts: ProviderAttempt[] = [];
    // Native structured outputs first: pass the JSON Schema so OpenRouter
    // forces the model's response into the expected shape. For supported
    // providers (OpenAI gpt-5.x, Anthropic Claude, etc.) this eliminates
    // malformed JSON entirely and makes the legacy repair pass dead code.
    const firstText = await this.requestText(messages, attempts, {
      jsonSchema: schema as ZodType<unknown>,
      jsonSchemaName: options.schemaName ?? "structured_output",
    });

    try {
      return {
        output: parseJsonWithSchema(firstText, schema),
        attempts,
        responseText: firstText,
        usage: aggregateUsage(attempts),
      };
    } catch (error) {
      if (!(error instanceof ExternalServiceError) || error.code !== "provider_output_invalid") {
        throw error;
      }
    }

    const repairMessage = schemaHint
      ? `${JSON_REPAIR_MESSAGE}\n\nExpected JSON format:\n${schemaHint}`
      : JSON_REPAIR_MESSAGE;

    const repairedText = await this.requestText(
      [
        ...messages,
        { role: "assistant", content: firstText },
        { role: "user", content: repairMessage },
      ],
      attempts,
    );

    return {
      output: parseJsonWithSchema(repairedText, schema),
      attempts,
      responseText: repairedText,
      usage: aggregateUsage(attempts),
    };
  }

  async readFiles(
    input: string[] | { paths?: string[]; files?: ProviderReadFileRequest[] },
  ) {
    if (!this.invocation.worktreePath) {
      throw new ExternalServiceError("Provider file reads require a worktree path");
    }

    const requests = normalizeReadRequests(input).slice(0, MAX_READ_REQUESTS);
    const files: ProviderReadResult[] = [];
    const guard = await createPathGuard(this.invocation.worktreePath);
    let remainingBytes = MAX_ACTION_READ_BYTES;

    for (const request of requests) {
      const normalized = normalizeReadRequest(request, remainingBytes);
      if (!normalized) break;

      const cacheKey = `${normalized.path}:${normalized.offset}:${normalized.limit}`;
      const cached = this.readCache.get(cacheKey);
      if (cached) {
        const fitted = fitReadResultToBudget(cached, remainingBytes);
        files.push(fitted);
        remainingBytes -= fitted.returned_bytes;
        continue;
      }

      const resolved = await guard.resolveExistingFile(normalized.path);
      if (resolved.status === "invalid") continue;
      if (resolved.status === "missing") {
        const missing: ProviderReadResult = {
          path: normalized.path,
          offset: normalized.offset,
          returned_bytes: 0,
          truncated: false,
          content: "<missing>",
          missing: true,
        };
        this.readCache.set(cacheKey, missing);
        files.push(missing);
        continue;
      }

      const buffer = await readFile(resolved.realPath);
      const boundedOffset = Math.min(normalized.offset, buffer.length);
      const boundedLimit = Math.min(normalized.limit, MAX_FILE_READ_BYTES);
      const slice = buffer.subarray(boundedOffset, boundedOffset + boundedLimit);
      const result: ProviderReadResult = {
        path: normalized.path,
        offset: boundedOffset,
        returned_bytes: slice.length,
        truncated: boundedOffset + boundedLimit < buffer.length,
        ...(boundedOffset + boundedLimit < buffer.length
          ? { next_offset: boundedOffset + boundedLimit }
          : {}),
        content: slice.toString("utf8"),
      };
      this.readCache.set(cacheKey, result);
      const fitted = fitReadResultToBudget(result, remainingBytes);
      files.push(fitted);
      remainingBytes -= fitted.returned_bytes;
    }

    return {
      files,
      total_returned_bytes: files.reduce((total, item) => total + item.returned_bytes, 0),
    };
  }

  async writeFile(path: string, content: string) {
    if (!this.invocation.worktreePath) {
      throw new ExternalServiceError("Provider file writes require a worktree path");
    }
    const guard = await createPathGuard(this.invocation.worktreePath);
    const resolvedPath = guard.resolveLogical(path);
    if (!resolvedPath) {
      throw new ExternalServiceError(`Path escapes repository root: ${path}`);
    }
    const byteLength = Buffer.byteLength(content, "utf8");
    if (byteLength > MAX_FILE_WRITE_BYTES) {
      throw new ExternalServiceError(
        `File content exceeds limit: ${byteLength} bytes > ${MAX_FILE_WRITE_BYTES} bytes`,
      );
    }
    const existing = await guard.resolveExistingFile(path);
    const created = existing.status !== "ok";
    await ensureDirectory(dirname(resolvedPath));
    await fsWriteFile(resolvedPath, content, "utf8");
    this.invalidateReadCache(path);
    return { result: "file_written", path, bytes_written: byteLength, created };
  }

  async deleteFile(path: string) {
    if (!this.invocation.worktreePath) {
      throw new ExternalServiceError("Provider file deletes require a worktree path");
    }
    const guard = await createPathGuard(this.invocation.worktreePath);
    const existing = await guard.resolveExistingFile(path);
    if (existing.status === "invalid") {
      throw new ExternalServiceError(`Path escapes repository root or is not a file: ${path}`);
    }
    if (existing.status === "missing") {
      throw new ExternalServiceError(`File does not exist: ${path}`);
    }
    await unlink(existing.realPath);
    this.invalidateReadCache(path);
    return { result: "file_deleted", path };
  }

  invalidateReadCache(path: string) {
    for (const key of this.readCache.keys()) {
      if (key.startsWith(`${path}:`)) {
        this.readCache.delete(key);
      }
    }
  }
}

function normalizeReadRequests(input: string[] | { paths?: string[]; files?: ProviderReadFileRequest[] }) {
  if (Array.isArray(input)) return input.map((path) => ({ path }));
  if (Array.isArray(input.files) && input.files.length > 0) return input.files;
  return Array.isArray(input.paths) ? input.paths.map((path) => ({ path })) : [];
}

function normalizeReadRequest(
  request: ProviderReadFileRequest,
  remainingBytes: number,
): { path: string; offset: number; limit: number } | null {
  if (remainingBytes <= 0) return null;
  return {
    path: request.path,
    offset: typeof request.offset === "number" && request.offset >= 0 ? request.offset : 0,
    limit: Math.max(
      1,
      Math.min(
        typeof request.limit === "number" && request.limit > 0 ? request.limit : MAX_FILE_READ_BYTES,
        MAX_FILE_READ_BYTES,
        remainingBytes,
      ),
    ),
  };
}

function fitReadResultToBudget(result: ProviderReadResult, remainingBytes: number) {
  if (result.returned_bytes <= remainingBytes) return result;
  const buffer = Buffer.from(result.content, "utf8");
  const slice = buffer.subarray(0, Math.max(0, remainingBytes));
  return {
    ...result,
    returned_bytes: slice.length,
    truncated: true,
    next_offset: result.offset + slice.length,
    content: slice.toString("utf8"),
  };
}

export function aggregateUsage(attempts: ProviderAttempt[]): ProviderUsage {
  let promptTokens = 0;
  let completionTokens = 0;
  let cachedTokens = 0;
  for (const attempt of attempts) {
    if (attempt.usage) {
      promptTokens += attempt.usage.promptTokens;
      completionTokens += attempt.usage.completionTokens;
      cachedTokens += attempt.usage.cachedTokens ?? 0;
    }
  }
  return { promptTokens, completionTokens, cachedTokens };
}
