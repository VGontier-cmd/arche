import { renderArcheBanner } from "../../banner";

export const POLL_INTERVAL_MS = 1_000;
export const HEADER_BANNER_LINES = renderArcheBanner().split("\n");
export const HEADER_HEIGHT = 8;
export const FOOTER_HEIGHT = 1;
export const MAIN_VERTICAL_TRIM = HEADER_HEIGHT + FOOTER_HEIGHT;

/** Share of main area (below header, above footer) for Run Radar + Ops Detail; rest is Activity Feed. */
export const TOP_BAND_HEIGHT_RATIO = 0.55;

export const FAILED_RUN_STATUSES = new Set([
  "failed",
  "cancelled",
  "publish_rejected",
]);
export const SUCCESS_RUN_STATUS = "success";
export const INBOX_RUN_STATUSES = new Set([
  "awaiting_plan_approval",
  "needs_human_input",
  "awaiting_publish_approval",
]);

/** Semantic palette (blessed `{#rrggbb-fg}` tags) */
export const PAL = {
  inbox: "#00d7ff",
  active: "#ffd700",
  failedFg: "#ff5f5f",
  failedBg: "#5f0000",
  done: "#87ff87",
  grey: "#808080",
  dimWhite: "#a8a8a8",
  magenta: "#d787ff",
  branchBlue: "#5f87ff",
  borderCyan: "#00d7ff",
  white: "#ffffff",
} as const;
