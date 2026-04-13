/**
 * SDK-backed client for Arche model calls. The default deployment targets **OpenRouter**
 * (`https://openrouter.ai/api/v1`, chat/completions) while the config driver stays generic
 * because the selected profile still uses the OpenAI-compatible request shape.
 */
import { dirname } from "node:path";
import { readFile, writeFile as fsWriteFile, unlink } from "node:fs/promises";

import { HTTPClient, OpenRouter } from "@openrouter/sdk";
import type { ChatMessages, ChatRequest, ChatResult } from "@openrouter/sdk/models";
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

const readFilesActionSchema = z
  .object({
    action: z.literal("read_files"),
    paths: z.array(z.string()).optional(),
    files: z
      .array(
        z.object({
          path: z.string(),
          offset: z.number().int().min(0).optional(),
          limit: z.number().int().positive().optional(),
        }),
      )
      .optional(),
    notes: z.string().optional(),
  })
  .superRefine((value, context) => {
    if ((value.paths?.length ?? 0) === 0 && (value.files?.length ?? 0) === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "read_files requires paths or files",
      });
    }
  });

export const providerActionSchema = z.union([
  readFilesActionSchema,
  z.object({
    action: z.literal("run_command"),
    command: z.string().min(1),
    notes: z.string().optional(),
  }),
  z.object({
    action: z.literal("write_file"),
    path: z.string().min(1),
    content: z.string(),
    notes: z.string().optional(),
  }),
  z.object({
    action: z.literal("delete_file"),
    path: z.string().min(1),
    notes: z.string().optional(),
  }),
  z.object({
    action: z.literal("apply_patch"),
    patch: z.string().min(1),
    notes: z.string().optional(),
  }),
  z.object({
    action: z.literal("finish"),
    summary: z.string().min(1),
    implementedPlanDelta: z.string().min(1),
    notes: z.string().optional(),
  }),
  z.object({
    action: z.literal("needs_human_input"),
    question: z.string().min(1),
    notes: z.string().optional(),
  }),
]);

export type ProviderMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ProviderInvocation = {
  worktreePath?: string;
  modelName: string;
  baseUrl: string;
  apiKeyEnv: string;
  temperature?: number;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  thinkingEnabled?: boolean;
  thinkingBudgetTokens?: number;
};

export type ProviderUsage = {
  promptTokens: number;
  completionTokens: number;
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

function extractFirstJsonObject(text: string) {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }
    if (char === "}") {
      if (depth === 0) {
        continue;
      }
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

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
  if (!rawText) {
    return null;
  }

  try {
    return JSON.parse(rawText);
  } catch {
    return rawText;
  }
}

function isTextContentItem(value: unknown): value is { type: "text"; text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "text" &&
    "text" in value &&
    typeof value.text === "string"
  );
}

function isThinkingContentItem(value: unknown): value is { type: "thinking"; thinking: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "thinking" &&
    "thinking" in value &&
    typeof (value as { thinking: unknown }).thinking === "string"
  );
}

function extractAssistantContent(content: unknown): { text: string; thinking: string | null } {
  if (Array.isArray(content)) {
    const text = content.flatMap((item) => (isTextContentItem(item) ? [item.text] : [])).join("");
    const thinkingParts = content.flatMap((item) => (isThinkingContentItem(item) ? [item.thinking] : []));
    return { text, thinking: thinkingParts.length > 0 ? thinkingParts.join("") : null };
  }
  return { text: typeof content === "string" ? content : "", thinking: null };
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

  private buildPayload(messages: ProviderMessage[]) {
    const extraBody = this.invocation.extraBody ?? {};
    const isAnthropic = this.invocation.modelName.startsWith("anthropic/");
    const isOSeries = /\/(o1|o3|o4)/.test(this.invocation.modelName);

    // When thinking is enabled for Claude models, temperature must be 1.0
    const temperature = this.invocation.thinkingEnabled && isAnthropic
      ? 1.0
      : typeof this.invocation.temperature === "number" ? this.invocation.temperature : 0.1;

    const payload: ChatRequest & Record<string, unknown> = {
      ...extraBody,
      model: this.invocation.modelName,
      messages: messages.map((message) => ({ ...message })) as ChatMessages[],
      temperature,
      stream: false,
    };

    if (this.invocation.thinkingEnabled) {
      const budget = this.invocation.thinkingBudgetTokens ?? 5000;
      if (isAnthropic) {
        payload.thinking = { type: "enabled", budget_tokens: budget };
      } else if (isOSeries) {
        payload.reasoning = { effort: "medium" };
      }
    }

    return payload;
  }

  private createClient(attemptRecord: ProviderAttempt, timeoutMs: number) {
    const httpClient = new HTTPClient({
      fetcher: async (input, init) => {
        try {
          const response = await fetch(input, init);
          attemptRecord.responseStatus = response.status;
          const rawText = await response.clone().text();
          attemptRecord.responseText = rawText;
          attemptRecord.responseBody = parseResponseBody(rawText);
          return response;
        } catch (error) {
          attemptRecord.error = error instanceof Error ? error.message : "Unknown provider error";
          throw error;
        }
      },
    });

    return new OpenRouter({
      apiKey: this.apiKey,
      serverURL: this.invocation.baseUrl,
      timeoutMs,
      httpClient,
    });
  }

  private async requestText(
    messages: ProviderMessage[],
    attempts: ProviderAttempt[],
  ) {
    const timeoutMs =
      typeof this.invocation.timeoutMs === "number" && this.invocation.timeoutMs > 0
        ? this.invocation.timeoutMs
        : 60_000;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const requestBody = this.buildPayload(messages);
      const attemptRecord: ProviderAttempt = {
        requestBody,
      };
      attempts.push(attemptRecord);

      try {
        const client = this.createClient(attemptRecord, timeoutMs);
        const response = await client.chat.send(
          { chatRequest: requestBody },
          {
            headers: this.invocation.extraHeaders,
            retries: { strategy: "none" },
            timeoutMs,
          },
        ) as ChatResult;

        // Extract usage from OpenRouter response
        const usage = (response as Record<string, unknown>).usage as
          | { prompt_tokens?: number; completion_tokens?: number }
          | undefined;
        if (usage) {
          attemptRecord.usage = {
            promptTokens: usage.prompt_tokens ?? 0,
            completionTokens: usage.completion_tokens ?? 0,
          };
        }

        const { text, thinking } = extractAssistantContent(response.choices[0]?.message?.content);
        attemptRecord.thinkingText = thinking;
        return text;
      } catch (error) {
        if (error instanceof OpenRouterError) {
          attemptRecord.responseStatus ??= error.statusCode;
          attemptRecord.responseText ??= error.body;
          attemptRecord.responseBody ??= parseResponseBody(error.body);

          if (RETRYABLE_STATUS_CODES.has(error.statusCode) && attempt < 2) {
            continue;
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

    throw new ExternalServiceError(
      "Inference server request failed without a provider response",
      "provider_request_failed",
    );
  }

  async completeStructured<T>(messages: ProviderMessage[], schema: ZodType<T>, schemaHint?: string) {
    const attempts: ProviderAttempt[] = [];
    const firstText = await this.requestText(messages, attempts);

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

  async completeAction(messages: ProviderMessage[], schemaHint?: string) {
    const attempts: ProviderAttempt[] = [];
    const firstText = await this.requestText(messages, attempts);

    try {
      return {
        action: parseJsonWithSchema(firstText, providerActionSchema),
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
      action: parseJsonWithSchema(repairedText, providerActionSchema),
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
      if (!normalized) {
        break;
      }

      const cacheKey = `${normalized.path}:${normalized.offset}:${normalized.limit}`;
      const cached = this.readCache.get(cacheKey);
      if (cached) {
        const fitted = fitReadResultToBudget(cached, remainingBytes);
        files.push(fitted);
        remainingBytes -= fitted.returned_bytes;
        continue;
      }

      const resolved = await guard.resolveExistingFile(normalized.path);
      if (resolved.status === "invalid") {
        continue;
      }
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
  if (Array.isArray(input)) {
    return input.map((path) => ({ path }));
  }
  if (Array.isArray(input.files) && input.files.length > 0) {
    return input.files;
  }
  return Array.isArray(input.paths) ? input.paths.map((path) => ({ path })) : [];
}

function normalizeReadRequest(
  request: ProviderReadFileRequest,
  remainingBytes: number,
): { path: string; offset: number; limit: number } | null {
  if (remainingBytes <= 0) {
    return null;
  }
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

function fitReadResultToBudget(
  result: ProviderReadResult,
  remainingBytes: number,
) {
  if (result.returned_bytes <= remainingBytes) {
    return result;
  }

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
  for (const attempt of attempts) {
    if (attempt.usage) {
      promptTokens += attempt.usage.promptTokens;
      completionTokens += attempt.usage.completionTokens;
    }
  }
  return { promptTokens, completionTokens };
}
