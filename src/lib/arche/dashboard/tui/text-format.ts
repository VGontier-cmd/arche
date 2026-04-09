import type { DashboardSnapshot } from "../snapshot";

import {
  FAILED_RUN_STATUSES,
  INBOX_RUN_STATUSES,
  PAL,
  SUCCESS_RUN_STATUS,
} from "./theme";

export function stripBlessedTags(value: string): string {
  return value.replace(/\{[^}]*\}/g, "");
}

export function truncateLine(
  value: string,
  maxWidth: number,
  ellipsis: "..." | "…" = "...",
) {
  if (maxWidth <= 0 || value.length <= maxWidth) {
    return value;
  }
  if (maxWidth <= 1) {
    return ellipsis === "…" ? "…" : ".";
  }
  const elen = ellipsis.length;
  if (maxWidth <= elen) {
    return value.slice(0, maxWidth);
  }
  return `${value.slice(0, maxWidth - elen)}${ellipsis}`;
}

export function truncateUnicode(
  value: string,
  maxWidth: number,
  ellipsis: "..." | "…" = "…",
) {
  if (value.length <= maxWidth) {
    return value;
  }
  if (maxWidth <= 1) {
    return ellipsis;
  }
  const elen = ellipsis.length;
  if (maxWidth <= elen) {
    return value.slice(0, maxWidth);
  }
  return `${value.slice(0, maxWidth - elen)}${ellipsis}`;
}

/** Truncate using visible column count (tags excluded). Avoids cutting inside `{#…-fg}`. */
export function truncateToVisibleWidth(
  value: string,
  maxCols: number,
  ellipsis: "..." | "…" = "...",
): string {
  const visible = stripBlessedTags(value);
  if (maxCols <= 0) {
    return "";
  }
  if (visible.length <= maxCols) {
    return value;
  }
  const elen = ellipsis.length;
  const budget = maxCols - elen;
  if (budget <= 0) {
    return ellipsis.slice(0, maxCols);
  }
  return `${visible.slice(0, budget)}${ellipsis}`;
}

export function seg(hex: string, content: string, bold = false): string {
  if (bold) {
    return `{${hex}-fg}{bold}${content}{/}`;
  }
  return `{${hex}-fg}${content}{/}`;
}

export function tItalicGrey(content: string): string {
  return `{grey-fg}${content}{/}`;
}

export function tDimWhite(content: string): string {
  return `{${PAL.dimWhite}-fg}${content}{/}`;
}

export function semanticStat(
  n: number,
  kind: "inbox" | "active" | "failed" | "done",
): string {
  if (n === 0) {
    return seg(PAL.grey, String(n));
  }
  if (kind === "inbox") {
    return seg(PAL.inbox, String(n));
  }
  if (kind === "active") {
    return seg(PAL.active, String(n), true);
  }
  if (kind === "failed") {
    return seg(PAL.failedFg, String(n), true);
  }
  return seg(PAL.done, String(n));
}

export function semanticCounterLetter(
  prefix: string,
  n: number,
  kind: "inbox" | "active" | "failed" | "done",
): string {
  return `{grey-fg}${prefix}{/}${semanticStat(n, kind)}`;
}

export function formatRunStatusForHeader(status: string): string {
  if (FAILED_RUN_STATUSES.has(status)) {
    return seg(PAL.failedFg, status, true);
  }
  if (status === SUCCESS_RUN_STATUS) {
    return seg(PAL.done, status);
  }
  if (INBOX_RUN_STATUSES.has(status)) {
    return seg(PAL.inbox, status);
  }
  return seg(PAL.active, status, true);
}

/** Same semantics as header formatting, using blessed `{hex-fg}` tags for mixed layouts. */
export function formatRunStatusColored(status: string): string {
  if (FAILED_RUN_STATUSES.has(status)) {
    return `{${PAL.failedFg}-fg}{bold}${status}{/}`;
  }
  if (status === SUCCESS_RUN_STATUS) {
    return `{${PAL.done}-fg}${status}{/}`;
  }
  if (INBOX_RUN_STATUSES.has(status)) {
    return `{${PAL.inbox}-fg}${status}{/}`;
  }
  return `{${PAL.active}-fg}{bold}${status}{/}`;
}

export function headerBorderColor(snapshot: DashboardSnapshot): string {
  if (snapshot.summary.failedCount > 0) {
    return PAL.failedFg;
  }
  if (
    snapshot.summary.inboxCount === 0 &&
    snapshot.summary.activeCount === 0 &&
    snapshot.summary.failedCount === 0
  ) {
    return PAL.done;
  }
  return PAL.borderCyan;
}

export function opsDetailBorderColor(run: DashboardSnapshot["selectedRun"]): string {
  if (!run) {
    return PAL.borderCyan;
  }
  if (FAILED_RUN_STATUSES.has(run.status)) {
    return PAL.failedFg;
  }
  if (run.status === SUCCESS_RUN_STATUS) {
    return PAL.done;
  }
  return PAL.borderCyan;
}

export function formatWorkflowStateBadge(state: string): string {
  let hex: string = PAL.grey;
  let bold = false;
  if (state === "STOP") {
    hex = PAL.failedFg;
    bold = true;
  } else if (state === "WAIT" || state === "HOLD") {
    hex = PAL.active;
    bold = true;
  } else if (state === "LIVE" || state === "DONE") {
    hex = PAL.done;
    bold = state === "LIVE";
  }
  return seg(hex, `[${state}]`, bold);
}

export function flowMixBarWidth(): number {
  const cols = process.stdout.columns ?? 80;
  return Math.max(4, Math.min(22, Math.floor(cols * 0.12)));
}

export function renderFlowMixBar(
  value: number,
  maxValue: number,
  width: number,
  kind: "inbox" | "active" | "failed" | "done",
): string {
  if (width <= 0) {
    return "";
  }
  const safeMax = Math.max(1, maxValue);
  const filled =
    value <= 0
      ? 0
      : Math.max(1, Math.min(width, Math.round((value / safeMax) * width)));
  const empty = Math.max(0, width - filled);
  const hex =
    kind === "inbox"
      ? PAL.inbox
      : kind === "active"
        ? PAL.active
        : kind === "failed"
          ? PAL.failedFg
          : PAL.done;
  const filledSeg = filled > 0 ? seg(hex, "█".repeat(filled)) : "";
  const emptySeg = empty > 0 ? seg(PAL.grey, "░".repeat(empty)) : "";
  return `${filledSeg}${emptySeg}`;
}

export function centerPlainLine(line: string, innerWidth: number): string {
  const len = line.length;
  if (len >= innerWidth) {
    return truncateLine(line, innerWidth);
  }
  const pad = Math.max(0, Math.floor((innerWidth - len) / 2));
  return `${" ".repeat(pad)}${line}`;
}

export function formatCenteredPaneLabel(outerWidth: number, innerText: string): string {
  const borderBudget = 4;
  const slot = Math.max(8, outerWidth - borderBudget);
  const text = innerText.trim();
  if (text.length >= slot) {
    return ` ${truncateLine(text, slot - 2)} `;
  }
  const pad = Math.max(0, Math.floor((slot - text.length) / 2));
  return `${" ".repeat(pad)}${text}${" ".repeat(Math.max(0, slot - text.length - pad))}`;
}

export function padLabel(label: string, w: number): string {
  return label.length >= w ? label.slice(0, w) : label.padEnd(w, " ");
}

export function indentBlock(value: string) {
  return value.split("\n").map((line) => `  ${tDimWhite(line)}`);
}
