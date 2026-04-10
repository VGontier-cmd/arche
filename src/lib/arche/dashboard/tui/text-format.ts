import type { DashboardSnapshot } from "../snapshot";

import { FAILED_RUN_STATUSES, PAL } from "./theme";

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

export function truncateToVisibleWidth(
  value: string,
  maxCols: number,
  ellipsis: "..." | "…" = "...",
): string {
  if (maxCols <= 0) {
    return "";
  }
  if (value.length <= maxCols) {
    return value;
  }
  const elen = ellipsis.length;
  const budget = maxCols - elen;
  if (budget <= 0) {
    return ellipsis.slice(0, maxCols);
  }
  return `${value.slice(0, budget)}${ellipsis}`;
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
  if (run.status === "success") {
    return PAL.done;
  }
  return PAL.borderCyan;
}

export function flowMixBarWidth(stdoutCols = process.stdout.columns ?? 80): number {
  return Math.max(4, Math.min(22, Math.floor(stdoutCols * 0.12)));
}

