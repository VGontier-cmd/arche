import { Text } from "ink";
import type { ReactNode } from "react";

import {
  FAILED_RUN_STATUSES,
  INBOX_RUN_STATUSES,
  PAL,
  SUCCESS_RUN_STATUS,
} from "./theme";

export function semanticStatInk(
  n: number,
  kind: "inbox" | "active" | "failed" | "done",
): ReactNode {
  if (n === 0) {
    return <Text color={PAL.grey}>{String(n)}</Text>;
  }
  if (kind === "inbox") {
    return <Text color={PAL.inbox}>{String(n)}</Text>;
  }
  if (kind === "active") {
    return (
      <Text color={PAL.active} bold>
        {String(n)}
      </Text>
    );
  }
  if (kind === "failed") {
    return (
      <Text color={PAL.failedFg} bold>
        {String(n)}
      </Text>
    );
  }
  return <Text color={PAL.done}>{String(n)}</Text>;
}

export function semanticCounterLetterInk(
  prefix: string,
  n: number,
  kind: "inbox" | "active" | "failed" | "done",
): ReactNode {
  return (
    <Text>
      <Text color={PAL.grey}>{prefix}</Text>
      {semanticStatInk(n, kind)}
    </Text>
  );
}

export function formatRunStatusForHeaderInk(status: string): ReactNode {
  if (FAILED_RUN_STATUSES.has(status)) {
    return (
      <Text color={PAL.failedFg} bold>
        {status}
      </Text>
    );
  }
  if (status === SUCCESS_RUN_STATUS) {
    return <Text color={PAL.done}>{status}</Text>;
  }
  if (INBOX_RUN_STATUSES.has(status)) {
    return <Text color={PAL.inbox}>{status}</Text>;
  }
  return (
    <Text color={PAL.active} bold>
      {status}
    </Text>
  );
}

export function formatRunStatusColoredInk(status: string): ReactNode {
  return formatRunStatusForHeaderInk(status);
}

export function formatWorkflowStateBadgeInk(state: string): ReactNode {
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
  return (
    <Text color={hex} bold={bold}>
      [{state}]
    </Text>
  );
}

export function tDimWhiteInk(content: string): ReactNode {
  return <Text color={PAL.dimWhite}>{content}</Text>;
}

export function tItalicGreyInk(content: string): ReactNode {
  return <Text color={PAL.grey}>{content}</Text>;
}

export function renderFlowMixBarInk(
  value: number,
  maxValue: number,
  width: number,
  kind: "inbox" | "active" | "failed" | "done",
): ReactNode {
  if (width <= 0) {
    return null;
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
  return (
    <Text>
      {filled > 0 ? <Text color={hex}>{"█".repeat(filled)}</Text> : null}
      {empty > 0 ? <Text color={PAL.grey}>{"░".repeat(empty)}</Text> : null}
    </Text>
  );
}
