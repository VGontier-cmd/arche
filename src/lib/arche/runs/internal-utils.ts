import { join } from "node:path";

import { redactObject, redactText, truncateText } from "../logging";

export function sanitizePayload(payload: Record<string, unknown>) {
  return JSON.parse(
    JSON.stringify(redactObject(payload), (_key, value) => value ?? null),
  ) as Record<string, unknown>;
}

export function buildExcerpt(value: string, maxLength: number) {
  const redacted = redactText(value);
  if (!redacted.trim()) {
    return null;
  }
  return truncateText(redacted, maxLength);
}

export function buildRunArtifactsPath(logsDir: string, runId: string) {
  return join(logsDir, "runs", runId);
}
