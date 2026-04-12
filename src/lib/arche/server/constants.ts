export const PUBLIC_PATHS = new Set([
  "/health",
  "/v1/health",
  "/ready",
  "/v1/ready",
  "/dashboard",
  "/v1/webhooks/jira",
]);
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 120;
