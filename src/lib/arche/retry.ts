export type RetryOptions = {
  maxAttempts?: number;
  backoffMs?: number;
  retryableStatuses?: number[];
};

const DEFAULT_RETRYABLE_STATUSES = [408, 429, 500, 502, 503, 504];

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const backoffMs = options.backoffMs ?? 1000;
  const retryableStatuses = options.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= maxAttempts) {
        break;
      }

      if (!isRetryableError(error, retryableStatuses)) {
        break;
      }

      const delay = backoffMs * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

function isRetryableError(error: unknown, retryableStatuses: number[]): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  for (const status of retryableStatuses) {
    if (error.message.includes(String(status))) {
      return true;
    }
  }

  if (
    error.message.includes("fetch failed") ||
    error.message.includes("ECONNRESET") ||
    error.message.includes("ECONNREFUSED") ||
    error.message.includes("ETIMEDOUT") ||
    error.message.includes("UND_ERR_CONNECT_TIMEOUT")
  ) {
    return true;
  }

  return false;
}
