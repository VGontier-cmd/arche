import type { Key } from "ink";

import type { DashboardSnapshot } from "../snapshot";

import type { ProjectSummary } from "./layout-types";
import { SUCCESS_RUN_STATUS } from "./theme";

export function collectProjectSummary(snapshot: DashboardSnapshot): ProjectSummary[] {
  const buckets = new Map<string, ProjectSummary>();

  const ensureProject = (key: string) => {
    const existing = buckets.get(key);
    if (existing) {
      return existing;
    }
    const created: ProjectSummary = {
      key,
      total: 0,
      inbox: 0,
      active: 0,
      failed: 0,
      done: 0,
    };
    buckets.set(key, created);
    return created;
  };

  for (const run of snapshot.inboxRuns) {
    const project = ensureProject(run.ticketProjectKey ?? "UNKNOWN");
    project.total += 1;
    project.inbox += 1;
  }

  for (const run of snapshot.activeRuns) {
    const project = ensureProject(run.ticketProjectKey ?? "UNKNOWN");
    project.total += 1;
    project.active += 1;
  }

  for (const run of snapshot.recentRuns) {
    const project = ensureProject(run.ticketProjectKey ?? "UNKNOWN");
    project.total += 1;
    if (run.status === SUCCESS_RUN_STATUS) {
      project.done += 1;
    } else {
      project.failed += 1;
    }
  }

  return [...buckets.values()].sort((left, right) => {
    if (right.total !== left.total) {
      return right.total - left.total;
    }
    return left.key.localeCompare(right.key);
  });
}

export function sliceWindow(lines: string[], focusIndex: number, maxLines: number) {
  if (lines.length <= maxLines) {
    return lines;
  }
  const half = Math.max(0, Math.floor(maxLines / 2));
  let start = Math.max(0, focusIndex - half);
  let end = start + maxLines;
  if (end > lines.length) {
    end = lines.length;
    start = Math.max(0, end - maxLines);
  }
  return lines.slice(start, end);
}

/** Map Ink `useInput` payload to dashboard controller keys (blessed-style names). */
export function mapInkToDashboardKey(input: string, key: Key): string | null {
  if (key.ctrl && input.toLowerCase() === "c") {
    return "q";
  }
  if (key.ctrl && input.toLowerCase() === "s") {
    return "C-s";
  }
  if (key.return) {
    return "enter";
  }
  if (key.escape) {
    return "escape";
  }
  if (key.tab) {
    return "tab";
  }
  if (key.upArrow) {
    return "up";
  }
  if (key.downArrow) {
    return "down";
  }
  if (key.backspace) {
    return "backspace";
  }
  if (input.length > 0) {
    return input;
  }
  return null;
}

export function renderBar(value: number, maxValue: number, width: number) {
  if (width <= 0) {
    return "";
  }
  const safeMax = Math.max(1, maxValue);
  const filled =
    value <= 0
      ? 0
      : Math.max(1, Math.min(width, Math.round((value / safeMax) * width)));
  return `[${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}]`;
}

export function renderBarPlain(value: number, maxValue: number, width: number) {
  return renderBar(value, maxValue, width);
}

export function formatAge(valueMs: number | null) {
  if (valueMs === null) {
    return "-";
  }
  if (valueMs < 1_000) {
    return `${valueMs}ms`;
  }
  if (valueMs < 60_000) {
    return `${(valueMs / 1_000).toFixed(1)}s`;
  }
  return `${Math.round(valueMs / 60_000)}m`;
}

export function formatTaskDuration(
  startedAt: string | null,
  finishedAt: string | null,
) {
  if (!startedAt || !finishedAt) {
    return "-";
  }
  const startedMs = Date.parse(startedAt);
  const finishedMs = Date.parse(finishedAt);
  if (
    !Number.isFinite(startedMs) ||
    !Number.isFinite(finishedMs) ||
    finishedMs < startedMs
  ) {
    return "-";
  }
  return formatAge(finishedMs - startedMs);
}

export function formatTimestamp(timestamp: string | null) {
  if (!timestamp) {
    return "-";
  }
  if (timestamp.length >= 19 && timestamp[10] === "T") {
    return timestamp.slice(11, 19);
  }
  return timestamp;
}

