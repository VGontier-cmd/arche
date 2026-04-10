/**
 * SDK-backed client for Arche model calls. The default deployment targets **OpenRouter**
 * (`https://openrouter.ai/api/v1`, chat/completions) while the config driver stays generic
 * because the selected profile still uses the OpenAI-compatible request shape.
 */
import { readFile } from "node:fs/promises";

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
import { createPathGuard } from "./utils";

const MAX_READ_REQUESTS = 20;
const MAX_FILE_READ_BYTES = 64 * 1024;
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
};

export type ProviderAttempt = {
  requestBody: Record<string, unknown>;
  responseStatus?: number;
  responseBody?: unknown;
  responseText?: string;
  error?: string;
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

function extractAssistantText(content: unknown) {
  if (Array.isArray(content)) {
    return content
      .flatMap((item) => (isTextContentItem(item) ? [item.text] : []))
      .join("");
  }

  return typeof content === "string" ? content : "";
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
    return {
      ...extraBody,
      model: this.invocation.modelName,
      messages: messages.map((message) => ({ ...message })) as ChatMessages[],
      temperature: typeof this.invocation.temperature === "number" ? this.invocation.temperature : 0.1,
      stream: false,
    } as ChatRequest & Record<string, unknown>;
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

        return extractAssistantText(response.choices[0]?.message?.content);
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

  async completeStructured<T>(messages: ProviderMessage[], schema: ZodType<T>) {
    const attempts: ProviderAttempt[] = [];
    const firstText = await this.requestText(messages, attempts);

    try {
      return {
        output: parseJsonWithSchema(firstText, schema),
        attempts,
        responseText: firstText,
      };
    } catch (error) {
      if (!(error instanceof ExternalServiceError) || error.code !== "provider_output_invalid") {
        throw error;
      }
    }

    const repairedText = await this.requestText(
      [
        ...messages,
        { role: "assistant", content: firstText },
        { role: "user", content: JSON_REPAIR_MESSAGE },
      ],
      attempts,
    );

    return {
      output: parseJsonWithSchema(repairedText, schema),
      attempts,
      responseText: repairedText,
    };
  }

  async completeAction(messages: ProviderMessage[]) {
    const attempts: ProviderAttempt[] = [];
    const firstText = await this.requestText(messages, attempts);

    try {
      return {
        action: parseJsonWithSchema(firstText, providerActionSchema),
        attempts,
        responseText: firstText,
      };
    } catch (error) {
      if (!(error instanceof ExternalServiceError) || error.code !== "provider_output_invalid") {
        throw error;
      }
    }

    const repairedText = await this.requestText(
      [
        ...messages,
        { role: "assistant", content: firstText },
        { role: "user", content: JSON_REPAIR_MESSAGE },
      ],
      attempts,
    );

    return {
      action: parseJsonWithSchema(repairedText, providerActionSchema),
      attempts,
      responseText: repairedText,
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
