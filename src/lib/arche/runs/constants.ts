import type { RunStatus } from "../types";

export const DEFAULT_PAGE_LIMIT = 100;
export const COMMAND_EXCERPT_LIMIT = 4000;
export const RUN_LOG_MESSAGE_LIMIT = 1200;
export const RUN_MESSAGE_LIMIT = 1200;
export const COMMAND_STDOUT_LOG_LIMIT = 500;
export const COMMAND_STDERR_LOG_LIMIT = 800;
export const COMMAND_HISTORY_LIMIT = 50;
export const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
export const RETENTION_DAY_MS = 24 * 60 * 60 * 1000;

export const QUEUEABLE_RUN_STATES: RunStatus[] = ["pending", "publish_approved"];
