import blessed from "neo-blessed";

import { renderArcheBanner } from "../../banner";
import {
  createDashboardControllerState,
  executeDashboardAction,
  getDashboardSnapshot,
  handleDashboardInput,
  listAvailableDashboardActions,
  reconcileDashboardControllerState,
  type DashboardControllerState,
  type DashboardSnapshot,
} from "..";

const POLL_INTERVAL_MS = 1_000;
const HEADER_BANNER_LINES = renderArcheBanner().split("\n");
const HEADER_HEIGHT = 8;
const FOOTER_HEIGHT = 1;
const MAIN_VERTICAL_TRIM = HEADER_HEIGHT + FOOTER_HEIGHT;
/** Share of main area (below header, above footer) for Run Radar + Ops Detail; rest is Activity Feed. */
const TOP_BAND_HEIGHT_RATIO = 0.55;

const FAILED_RUN_STATUSES = new Set(["failed", "cancelled", "publish_rejected"]);
const SUCCESS_RUN_STATUS = "success";
const INBOX_RUN_STATUSES = new Set([
  "awaiting_plan_approval",
  "needs_human_input",
  "awaiting_publish_approval",
]);

/** Semantic palette (blessed `{#rrggbb-fg}` tags) */
const PAL = {
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

type ProjectSummary = {
  key: string;
  total: number;
  inbox: number;
  active: number;
  failed: number;
  done: number;
};

export type DashboardLayout = {
  header: string;
  left: string;
  detailLabel: string;
  detail: string;
  timeline: string;
  footer: string;
  modalTitle: string | null;
  modalBody: string | null;
};

function stripBlessedTags(value: string): string {
  return value.replace(/\{[^}]*\}/g, "");
}

/** Truncate using visible column count (tags excluded). Avoids cutting inside `{#…-fg}`. */
function truncateToVisibleWidth(
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

function seg(hex: string, content: string, bold = false): string {
  if (bold) {
    return `{${hex}-fg}{bold}${content}{/}`;
  }
  return `{${hex}-fg}${content}{/}`;
}

function tItalicGrey(content: string): string {
  return `{grey-fg}${content}{/}`;
}

function tDimWhite(content: string): string {
  return `{${PAL.dimWhite}-fg}${content}{/}`;
}

function semanticStat(n: number, kind: "inbox" | "active" | "failed" | "done"): string {
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

function semanticCounterLetter(prefix: string, n: number, kind: "inbox" | "active" | "failed" | "done"): string {
  return `{grey-fg}${prefix}{/}${semanticStat(n, kind)}`;
}

function formatRunStatusForHeader(status: string): string {
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

function headerBorderColor(snapshot: DashboardSnapshot): string {
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

function opsDetailBorderColor(run: DashboardSnapshot["selectedRun"]): string {
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

function formatWorkflowStateBadge(state: string): string {
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

function flowMixBarWidth(): number {
  const cols = process.stdout.columns ?? 80;
  return Math.max(4, Math.min(22, Math.floor(cols * 0.12)));
}

function renderFlowMixBar(
  value: number,
  maxValue: number,
  width: number,
  kind: "inbox" | "active" | "failed" | "done",
): string {
  if (width <= 0) {
    return "";
  }
  const safeMax = Math.max(1, maxValue);
  const filled = value <= 0 ? 0 : Math.max(1, Math.min(width, Math.round((value / safeMax) * width)));
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

function centerPlainLine(line: string, innerWidth: number): string {
  const len = line.length;
  if (len >= innerWidth) {
    return truncateLine(line, innerWidth);
  }
  const pad = Math.max(0, Math.floor((innerWidth - len) / 2));
  return `${" ".repeat(pad)}${line}`;
}

function formatCenteredPaneLabel(outerWidth: number, innerText: string): string {
  const borderBudget = 4;
  const slot = Math.max(8, outerWidth - borderBudget);
  const text = innerText.trim();
  if (text.length >= slot) {
    return ` ${truncateLine(text, slot - 2)} `;
  }
  const pad = Math.max(0, Math.floor((slot - text.length) / 2));
  return `${" ".repeat(pad)}${text}${" ".repeat(Math.max(0, slot - text.length - pad))}`;
}

export async function startDashboard() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("arche dashboard requires an interactive terminal");
  }

  const screen = blessed.screen({
    smartCSR: true,
    title: "Arche Dashboard",
    fullUnicode: true,
  });

  const lineBorder = { type: "line" as const };

  const headerBox = blessed.box({
    parent: screen,
    border: lineBorder,
    label: " Flight Deck ",
    padding: { left: 1, right: 1 },
    tags: true,
    style: {
      border: { fg: PAL.borderCyan },
      label: { fg: PAL.white, bold: true },
      fg: PAL.white,
    },
  });

  const leftBox = blessed.box({
    parent: screen,
    border: lineBorder,
    label: " Run Radar ",
    padding: { left: 1, right: 1 },
    scrollable: false,
    tags: true,
    style: {
      border: { fg: PAL.borderCyan },
      label: { fg: PAL.white, bold: true },
      fg: PAL.white,
    },
  });

  const rightColumn = blessed.box({
    parent: screen,
    top: HEADER_HEIGHT,
    left: "35%",
    width: "65%",
    height: `100%-${MAIN_VERTICAL_TRIM}`,
    tags: false,
    style: {
      bg: "black",
    },
  });

  const detailBox = blessed.box({
    parent: rightColumn,
    border: lineBorder,
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    padding: { left: 1, right: 1 },
    tags: true,
    style: {
      border: { fg: PAL.borderCyan },
      label: { fg: PAL.white, bold: true },
      fg: PAL.white,
    },
  });

  const timelineBox = blessed.box({
    parent: screen,
    border: lineBorder,
    padding: { left: 1, right: 1 },
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    mouse: true,
    scrollbar: {
      ch: "│",
      style: { fg: PAL.grey },
      track: { bg: "black" },
    },
    style: {
      border: { fg: PAL.borderCyan },
      label: { fg: PAL.white, bold: true },
      fg: PAL.white,
      scrollbar: { bg: "black", fg: PAL.grey },
    },
  });

  const footerBox = blessed.box({
    parent: screen,
    tags: true,
    style: {
      fg: PAL.white,
      bg: "black",
    },
  });

  const modalBox = blessed.box({
    parent: screen,
    border: lineBorder,
    padding: { left: 1, right: 1 },
    hidden: true,
    tags: true,
    style: {
      border: { fg: PAL.failedFg },
      label: { fg: PAL.white, bold: true },
      fg: PAL.white,
    },
  });

  let state = createDashboardControllerState();
  let snapshot = await getDashboardSnapshot();
  state = reconcileDashboardControllerState(state, snapshot);
  let statusMessage = "Connected";

  const layoutBoxes = () => {
    const width = Number(screen.width);
    const height = Number(screen.height);
    const contentHeight = Math.max(10, height - MAIN_VERTICAL_TRIM);
    const feedHeight = Math.max(
      6,
      Math.min(
        Math.ceil(contentHeight * (1 - TOP_BAND_HEIGHT_RATIO)),
        contentHeight - 8,
      ),
    );
    const topBandHeight = Math.max(8, contentHeight - feedHeight);
    const feedTop = HEADER_HEIGHT + topBandHeight;

    Object.assign(headerBox, {
      top: 0,
      left: 0,
      width: "100%",
      height: HEADER_HEIGHT,
    });
    Object.assign(leftBox, {
      top: HEADER_HEIGHT,
      left: 0,
      width: "35%",
      height: topBandHeight,
    });
    Object.assign(rightColumn, {
      top: HEADER_HEIGHT,
      left: "35%",
      width: "65%",
      height: topBandHeight,
    });
    Object.assign(timelineBox, {
      top: feedTop,
      left: 0,
      width: "100%",
      height: feedHeight,
    });
    Object.assign(footerBox, {
      bottom: 0,
      left: 0,
      width: "100%",
      height: FOOTER_HEIGHT,
    });

    if (!state.modal) {
      modalBox.hide();
      return;
    }

    const modalWidth = Math.min(width - 8, 88);
    const modalHeight = state.modal.kind === "human_reply" ? Math.min(height - 6, 18) : 9;
    Object.assign(modalBox, {
      width: modalWidth,
      height: modalHeight,
      left: Math.max(0, Math.floor((width - modalWidth) / 2)),
      top: Math.max(0, Math.floor((height - modalHeight) / 2)),
    });
    modalBox.show();
  };

  const render = () => {
    layoutBoxes();
    const detailOuterW = Math.max(20, Number(detailBox.width));

    const layout = renderDashboardLayout(snapshot, state, statusMessage, {
      screenWidth: Math.max(40, Number(screen.width) - 2),
      leftHeight: Math.max(8, Number(leftBox.height) - 2),
      leftWidth: Math.max(24, Number(leftBox.width) - 4),
      detailHeight: Math.max(8, Number(detailBox.height) - 2),
      detailWidth: Math.max(24, Number(detailBox.width) - 4),
      timelineWidth: Math.max(40, Number(timelineBox.width) - 6),
      detailOuterWidth: detailOuterW,
      footerWidth: Math.max(40, Number(screen.width) - 2),
    });

    applyPaneStyle(headerBox, { color: headerBorderColor(snapshot), focused: false });
    applyPaneStyle(leftBox, { color: PAL.borderCyan, focused: state.focusedPane === "lists" });
    applyPaneStyle(detailBox, {
      color: opsDetailBorderColor(snapshot.selectedRun),
      focused: state.focusedPane === "detail",
    });
    applyPaneStyle(timelineBox, { color: PAL.borderCyan, focused: state.focusedPane === "timeline" });
    applyPaneStyle(modalBox, { color: PAL.failedFg, focused: Boolean(state.modal) });

    headerBox.setLabel(` ${formatCenteredPaneLabel(Number(headerBox.width), "FLIGHT DECK")} `);
    leftBox.setLabel(
      ` ${formatCenteredPaneLabel(Number(leftBox.width), "◈ RUN RADAR")} `,
    );
    headerBox.setContent(layout.header);
    leftBox.setContent(layout.left);
    detailBox.setLabel(` ${buildOpsDetailLabelContent(snapshot, state, detailOuterW)} `);
    detailBox.setContent(layout.detail);
    timelineBox.setLabel(
      ` ${formatCenteredPaneLabel(Number(timelineBox.width), `◎ ACTIVITY FEED  (${snapshot.timeline.length} items)`)} `,
    );
    timelineBox.setContent(layout.timeline);
    timelineBox.setScrollPerc(100);
    footerBox.setContent(layout.footer);

    if (layout.modalTitle && layout.modalBody) {
      modalBox.setLabel(` ${layout.modalTitle} `);
      modalBox.setContent(layout.modalBody);
      modalBox.show();
      modalBox.setFront();
    } else {
      modalBox.hide();
    }

    screen.render();
  };

  const refresh = async () => {
    try {
      snapshot = await getDashboardSnapshot({ selectedRunId: state.selectedRunId });
      state = reconcileDashboardControllerState(state, snapshot);
      statusMessage = [
        `Inbox ${snapshot.summary.inboxCount}`,
        `Active ${snapshot.summary.activeCount}`,
        `Failed ${snapshot.summary.failedCount}`,
        `Workers ${snapshot.summary.workerCount}`,
      ].join(" | ");
    } catch (error) {
      statusMessage = error instanceof Error ? `Refresh failed: ${error.message}` : "Refresh failed";
    }
    render();
  };

  const applyEffect = async (effect: ReturnType<typeof handleDashboardInput>["effect"]) => {
    if (!effect) {
      return false;
    }
    if (effect.type === "quit") {
      finish();
      return true;
    }
    if (effect.type === "refresh") {
      await refresh();
      return true;
    }
    if (effect.type === "notify") {
      statusMessage = effect.message;
      render();
      return true;
    }
    try {
      const result = await executeDashboardAction(effect.action);
      state = {
        ...state,
        selectedRunId: result.selectedRunId,
        highlightedRunId: result.selectedRunId,
      };
      statusMessage = result.message;
      await refresh();
    } catch (error) {
      statusMessage = error instanceof Error ? error.message : "Dashboard action failed";
      render();
    }
    return true;
  };

  const interval = setInterval(() => {
    void refresh();
  }, POLL_INTERVAL_MS);

  const finish = () => {
    clearInterval(interval);
    screen.destroy();
  };

  screen.on("keypress", async (chars: string, key: { name?: string; full?: string }) => {
    const actionKey = normalizeActionKey(chars, key);
    if (!actionKey) {
      return;
    }

    if (
      !state.modal &&
      state.focusedPane === "timeline" &&
      (actionKey === "up" || actionKey === "down" || actionKey === "k" || actionKey === "j")
    ) {
      const delta = actionKey === "up" || actionKey === "k" ? -1 : 1;
      timelineBox.scroll(delta);
      screen.render();
      return;
    }

    const previousSelectedRunId = state.selectedRunId;
    const result = handleDashboardInput(state, snapshot, actionKey, chars);
    state = reconcileDashboardControllerState(result.state, snapshot);

    const handled = await applyEffect(result.effect);
    if (handled) {
      return;
    }

    if (previousSelectedRunId !== state.selectedRunId) {
      await refresh();
      return;
    }

    render();
  });

  screen.on("resize", () => {
    render();
  });

  render();

  return new Promise<void>((resolve) => {
    screen.once("destroy", () => resolve());
  });
}

function buildOpsDetailLabelContent(
  snapshot: DashboardSnapshot,
  state: DashboardControllerState,
  detailOuterWidth: number,
): string {
  const run = snapshot.selectedRun;
  const tab = state.detailTab;
  let plain = "⚡ OPS DETAIL";
  if (run && FAILED_RUN_STATUSES.has(run.status)) {
    plain += "  ✗ FAILED";
  }
  plain += `  (${tab})`;
  if (plain.length > detailOuterWidth - 6) {
    plain = `⚡ OPS DETAIL (${tab})`;
  }
  return formatCenteredPaneLabel(detailOuterWidth, plain);
}

export function renderDashboardLayout(
  snapshot: DashboardSnapshot,
  state: DashboardControllerState,
  statusMessage: string,
  dimensions: {
    screenWidth?: number;
    leftHeight?: number;
    leftWidth?: number;
    detailHeight?: number;
    detailWidth?: number;
    timelineHeight?: number;
    timelineWidth?: number;
    detailOuterWidth?: number;
    footerWidth?: number;
  } = {},
): DashboardLayout {
  const selectedRun = snapshot.selectedRun;
  const actions = listAvailableDashboardActions(selectedRun);
  const detailOuter = dimensions.detailOuterWidth ?? 56;

  return {
    header: renderHeader(snapshot, dimensions.screenWidth ?? 120),
    left: renderLeftPane(
      snapshot,
      state,
      dimensions.leftHeight ?? 24,
      dimensions.leftWidth ?? 40,
    ),
    detailLabel: ` ${buildOpsDetailLabelContent(snapshot, state, detailOuter)} `,
    detail: renderDetailPane(
      snapshot,
      state,
      dimensions.detailHeight ?? 24,
      dimensions.detailWidth ?? 56,
    ),
    timeline: renderTimelinePane(snapshot, dimensions.timelineWidth ?? 56),
    footer: renderFooter(snapshot, state, statusMessage, actions, dimensions.footerWidth ?? 120),
    modalTitle: state.modal
      ? state.modal.kind === "confirm"
        ? state.modal.title
        : `Reply for ${state.modal.ticketKey}`
      : null,
    modalBody: state.modal ? renderModalBody(state) : null,
  };
}

function renderHeader(snapshot: DashboardSnapshot, screenWidth: number) {
  const innerWidth = Math.max(24, screenWidth - 4);
  const successfulRuns = snapshot.recentRuns.filter((run) => run.status === SUCCESS_RUN_STATUS).length;
  const workerOnlineCount = Math.max(0, snapshot.summary.workerCount - snapshot.summary.offlineWorkerCount);
  const workerOfflineCount = snapshot.summary.offlineWorkerCount;
  const projects = collectProjectSummary(snapshot);
  const projectBits = projects.slice(0, 4).map((p) => {
    const dot =
      p.total > 0 ? `{${PAL.done}-fg}●{/}` : `{${PAL.grey}-fg}○{/}`;
    return `${dot} {${PAL.white}-fg}{bold}${p.key}{/}`;
  });
  const projectsLine =
    projectBits.length > 0
      ? `{${PAL.grey}-fg}Projects{/}  ${projectBits.join("  ")}`
      : `{${PAL.grey}-fg}Projects{/}  {${PAL.dimWhite}-fg}none{/}`;

  const onlineDot = `{${PAL.done}-fg}●{/}`;
  const offlineDot = `{${PAL.grey}-fg}○{/}`;
  const workersLine = `{${PAL.grey}-fg}Workers{/}  ${onlineDot} {${PAL.white}-fg}{bold}${workerOnlineCount}{/}{${PAL.grey}-fg}/{/}{${PAL.white}-fg}${snapshot.summary.workerCount}{/} online  ${offlineDot} {${PAL.white}-fg}${workerOfflineCount}{/} offline`;

  const selectedLine = snapshot.selectedRun
    ? `{${PAL.grey}-fg}Selected{/}  {${PAL.white}-fg}{bold}${snapshot.selectedRun.ticketKey}{/}  ${formatRunStatusForHeader(snapshot.selectedRun.status)}`
    : `{${PAL.grey}-fg}Selected{/}  {${PAL.dimWhite}-fg}none{/}`;

  const statsLine = [
    `{${PAL.grey}-fg}Inbox [{/}`,
    semanticStat(snapshot.summary.inboxCount, "inbox"),
    `{${PAL.grey}-fg}]{/}`,
    `  │  `,
    `{${PAL.grey}-fg}Active [{/}`,
    semanticStat(snapshot.summary.activeCount, "active"),
    `{${PAL.grey}-fg}]{/}`,
    `  │  `,
    `{${PAL.grey}-fg}Failed [{/}`,
    semanticStat(snapshot.summary.failedCount, "failed"),
    `{${PAL.grey}-fg}]{/}`,
    `  │  `,
    `{${PAL.grey}-fg}Done [{/}`,
    semanticStat(successfulRuns, "done"),
    `{${PAL.grey}-fg}]{/}`,
  ].join("");

  const bannerLines = HEADER_BANNER_LINES.map((line) => centerPlainLine(line, innerWidth));

  const lines = [...bannerLines, statsLine, projectsLine, workersLine, selectedLine];

  return lines
    .map((line) =>
      stripBlessedTags(line).length <= innerWidth ? line : truncateLine(stripBlessedTags(line), innerWidth),
    )
    .join("\n");
}

function renderLeftPane(
  snapshot: DashboardSnapshot,
  state: DashboardControllerState,
  maxLines: number,
  maxWidth: number,
) {
  const lines: string[] = [];
  const focusLineByRunId = new Map<string, number>();
  const projects = collectProjectSummary(snapshot);
  const successfulRuns = snapshot.recentRuns.filter((run) => run.status === SUCCESS_RUN_STATUS).length;
  const runMax = Math.max(
    1,
    snapshot.summary.inboxCount,
    snapshot.summary.activeCount,
    snapshot.summary.failedCount,
    successfulRuns,
  );
  const barW = Math.min(flowMixBarWidth(), Math.max(4, maxWidth - 24));

  lines.push(`{${PAL.white}-fg}{bold}Flow Mix{/}`);
  lines.push(
    `  {${PAL.grey}-fg}Inbox{/}  ${renderFlowMixBar(snapshot.summary.inboxCount, runMax, barW, "inbox")}  ${semanticStat(snapshot.summary.inboxCount, "inbox")}`,
  );
  lines.push(
    `  {${PAL.grey}-fg}Active{/}  ${renderFlowMixBar(snapshot.summary.activeCount, runMax, barW, "active")}  ${semanticStat(snapshot.summary.activeCount, "active")}`,
  );
  lines.push(
    `  {${PAL.grey}-fg}Failed{/}  ${renderFlowMixBar(snapshot.summary.failedCount, runMax, barW, "failed")}  ${semanticStat(snapshot.summary.failedCount, "failed")}`,
  );
  lines.push(
    `  {${PAL.grey}-fg}Done{/}    ${renderFlowMixBar(successfulRuns, runMax, barW, "done")}  ${semanticStat(successfulRuns, "done")}`,
  );

  lines.push("", `{${PAL.white}-fg}{bold}Projects (${projects.length}){/}`);
  if (projects.length === 0) {
    lines.push(`  ${tItalicGrey("none")}`);
  } else {
    const topProjects = projects.slice(0, Math.min(4, Math.max(2, Math.floor(maxLines / 10))));
    for (const project of topProjects) {
      const dot =
        snapshot.selectedRun?.ticketProjectKey === project.key
          ? `{${PAL.done}-fg}●{/}`
          : `{${PAL.grey}-fg}●{/}`;
      const jobLabel = project.total === 1 ? "1 job" : `${project.total} jobs`;
      lines.push(
        `  ${dot} {${PAL.white}-fg}{bold}${project.key}{/}  {${PAL.grey}-fg}[${jobLabel}]{/}  ${semanticCounterLetter("i", project.inbox, "inbox")} ${semanticCounterLetter("a", project.active, "active")} ${semanticCounterLetter("f", project.failed, "failed")} ${semanticCounterLetter("d", project.done, "done")}`,
      );
    }
  }

  lines.push("");
  appendRunSection(lines, focusLineByRunId, "Inbox", snapshot.inboxRuns, state, "inbox");
  lines.push("");
  appendRunSection(lines, focusLineByRunId, "Active", snapshot.activeRuns, state, "active");
  lines.push("");
  appendRunSection(lines, focusLineByRunId, "Recent", snapshot.recentRuns, state, "recent");
  lines.push("", `{${PAL.white}-fg}{bold}Workers (${snapshot.workers.length}){/}`);
  if (snapshot.workers.length === 0) {
    lines.push(`  ${tItalicGrey("none")}`);
  } else {
    lines.push(
      ...snapshot.workers.map((worker) => {
        const head = worker.offline ? `{${PAL.failedFg}-fg}◯{/}` : `{${PAL.done}-fg}◉{/}`;
        const hb = tItalicGrey(`hb ${formatAge(worker.heartbeatAgeMs)}`);
        return `  ${head} {${PAL.inbox}-fg}${worker.name}{/}  ${worker.status}/${worker.activity}  ${hb}`;
      }),
    );
  }

  const highlightIndex =
    (state.highlightedRunId ? focusLineByRunId.get(state.highlightedRunId) : undefined) ?? 0;
  return sliceWindow(lines, highlightIndex, maxLines)
    .map((line) => truncateToVisibleWidth(line, maxWidth))
    .join("\n");
}

type RunSectionKind = "inbox" | "active" | "recent";

function runSectionIcon(kind: RunSectionKind, status: string): string {
  if (kind === "inbox") {
    return `{${PAL.inbox}-fg}·{/}`;
  }
  if (kind === "active") {
    return `{${PAL.active}-fg}{bold}⟳{/}`;
  }
  if (status === SUCCESS_RUN_STATUS) {
    return `{${PAL.done}-fg}✓{/}`;
  }
  if (FAILED_RUN_STATUSES.has(status)) {
    return `{${PAL.failedFg}-fg}{bold}✗{/}`;
  }
  return `{${PAL.grey}-fg}·{/}`;
}

function formatRunStatusColored(status: string): string {
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

function appendRunSection(
  lines: string[],
  focusLineByRunId: Map<string, number>,
  label: string,
  runs: DashboardSnapshot["inboxRuns"],
  state: DashboardControllerState,
  kind: RunSectionKind,
) {
  lines.push(`{${PAL.white}-fg}{bold}${label} (${runs.length}){/}`);
  if (runs.length === 0) {
    lines.push(`  ${tItalicGrey("none")}`);
    return;
  }

  for (const run of runs) {
    focusLineByRunId.set(run.id, lines.length);
    const highlighted = run.id === state.highlightedRunId ? `{${PAL.active}-fg}>{/}` : " ";
    const selected = run.id === state.selectedRunId ? "*" : " ";
    const icon = runSectionIcon(kind, run.status);
    lines.push(
      ` ${highlighted}${selected}${icon} {${PAL.white}-fg}{bold}${run.ticketKey}{/}  ${formatRunStatusColored(run.status)}`,
    );
    lines.push(
      `    ${tDimWhite(`${run.currentRole ?? "—"} · cycle ${run.currentCycle ?? 0} · ${run.repoName ?? "—"}`)}`,
    );
  }
}

function renderDetailPane(
  snapshot: DashboardSnapshot,
  state: DashboardControllerState,
  maxLines: number,
  maxWidth: number,
) {
  const run = snapshot.selectedRun;
  if (!run) {
    return `{${PAL.dimWhite}-fg}No run selected.{/}`;
  }

  const lines =
    state.detailTab === "overview"
      ? renderOverviewLines(snapshot)
      : state.detailTab === "plan"
        ? renderPlanLines(run)
        : renderFindingsLines(run);

  return lines
    .map((line) => truncateToVisibleWidth(line, maxWidth))
    .slice(state.scrollByPane.detail, state.scrollByPane.detail + maxLines)
    .join("\n");
}

function padLabel(label: string, w: number): string {
  return label.length >= w ? label.slice(0, w) : label.padEnd(w, " ");
}

function renderOverviewLines(snapshot: DashboardSnapshot) {
  const run = snapshot.selectedRun;
  if (!run) {
    return [`{${PAL.dimWhite}-fg}No run selected.{/}`];
  }

  const actions = listAvailableDashboardActions(run);
  const lw = 10;
  const mrDisplay =
    run.mrUrl && run.mrUrl !== "-"
      ? `{${PAL.branchBlue}-fg}${truncateLine(run.mrUrl, 48)}{/}`
      : `{${PAL.grey}-fg}—{/}`;

  const workerPrimary = snapshot.selectedWorker
    ? `{${PAL.inbox}-fg}${snapshot.selectedWorker.name}{/}`
    : run.workerId
      ? `{${PAL.magenta}-fg}${truncateLine(run.workerId, 36)}{/}`
      : `{${PAL.grey}-fg}—{/}`;
  const workerSecondary = snapshot.selectedWorker
    ? tDimWhite(`${snapshot.selectedWorker.status}/${snapshot.selectedWorker.activity}`)
    : "";

  const statusVisual = FAILED_RUN_STATUSES.has(run.status)
    ? `{${PAL.failedBg}-bg}{${PAL.white}-fg}{bold}✗ ${run.status}{/}`
    : formatRunStatusColored(run.status);

  const runIdTrunc =
    run.id.length > 36
      ? `{${PAL.magenta}-fg}${truncateUnicode(run.id, 36)}{/}{${PAL.grey}-fg}…{/}`
      : `{${PAL.magenta}-fg}${run.id}{/}`;
  const lines: string[] = [`${padLabel("Run", lw)} ${runIdTrunc}`];

  lines.push(
    `${padLabel("Ticket", lw)} {${PAL.white}-fg}{bold}${run.ticketKey}{/}  {${PAL.grey}-fg}│{/}  ${tDimWhite(truncateLine(run.ticketTitle ?? "—", 52))}`,
  );
  lines.push(`${padLabel("Status", lw)} ${statusVisual}`);
  lines.push(
    `${padLabel("Workflow", lw)} {${PAL.inbox}-fg}${run.workflowMode ?? "—"}{/}`,
  );
  lines.push(
    `${padLabel("Role", lw)} {${PAL.active}-fg}{bold}${run.currentRole ?? "—"}{/}`,
  );
  lines.push(`${padLabel("Cycle", lw)} {${PAL.white}-fg}{bold}${run.currentCycle ?? 0}{/}`);
  lines.push(
    `${padLabel("Repo", lw)} {${PAL.branchBlue}-fg}${run.repoName ?? "—"}{/}`,
  );
  lines.push(
    `${padLabel("Worker", lw)} ${workerPrimary}${workerSecondary ? `  {${PAL.grey}-fg}│{/}  ${workerSecondary}` : ""}`,
  );
  lines.push(
    `${padLabel("Branch", lw)} {${PAL.branchBlue}-fg}${truncateUnicode(run.branchName ?? "—", 44)}{/}${(run.branchName?.length ?? 0) > 44 ? `{${PAL.grey}-fg}…{/}` : ""}`,
  );
  lines.push(`${padLabel("MR", lw)} ${mrDisplay}`);

  lines.push("");
  lines.push(`{${PAL.grey}-fg}─────────── Workflow Lane ───────────{/}`);
  lines.push(...renderWorkflowLane(snapshot));
  lines.push("");
  lines.push(`{${PAL.white}-fg}{bold}Available actions:{/}`);
  lines.push(
    ...(actions.length > 0
      ? actions.map(
          (action) =>
            `  {${PAL.grey}-fg}${action.hotkey}{/}  {${PAL.white}-fg}{bold}${action.label}{/}`,
        )
      : [`  ${tItalicGrey("none")}`]),
  );
  lines.push("");
  lines.push(`{${PAL.white}-fg}{bold}Execution profiles{/}`);
  lines.push(
    `${padLabel("Planner", lw)} ${tDimWhite(run.plannerProfile ?? "—")}  {${PAL.grey}-fg}│{/}  ${tDimWhite(run.plannerDriver ?? "—")}`,
  );
  lines.push(
    `${padLabel("Executor", lw)} ${tDimWhite(run.executorProfile ?? "—")}  {${PAL.grey}-fg}│{/}  ${tDimWhite(run.executorDriver ?? "—")}  {${PAL.grey}-fg}│{/}  ${tDimWhite(run.modelName ?? "—")}`,
  );
  lines.push(`${padLabel("Reviewer", lw)} ${tDimWhite(run.reviewerProfile ?? "—")}  {${PAL.grey}-fg}│{/}  ${tDimWhite(run.reviewerDriver ?? "—")}`);
  lines.push("");
  lines.push(`{${PAL.white}-fg}{bold}Signals{/}`);
  lines.push(`${padLabel("Summary", lw)} ${tDimWhite(truncateLine(run.summary ?? "—", 64))}`);
  lines.push(
    `${padLabel("Review", lw)} ${tDimWhite(truncateLine(run.latestReviewSummary ?? "—", 64))}`,
  );
  lines.push(
    `${padLabel("Question", lw)} ${tDimWhite(truncateLine(run.pendingQuestion ?? "—", 64))}`,
  );
  lines.push(
    `${padLabel("Failure", lw)} ${FAILED_RUN_STATUSES.has(run.status) ? `{${PAL.failedFg}-fg}${truncateLine(run.failureReason ?? "—", 64)}{/}` : tDimWhite(run.failureReason ?? "—")}`,
  );
  lines.push("");
  lines.push(`{${PAL.white}-fg}{bold}Runtime{/}`);
  lines.push(`${padLabel("Worktree", lw)} ${tDimWhite(truncateLine(run.worktreePath ?? "—", 64))}`);
  lines.push(`${padLabel("Sandbox", lw)} ${tDimWhite(run.sandboxId ?? "—")}`);
  lines.push(`${padLabel("Started", lw)} ${tItalicGrey(run.startedAt ?? "—")}`);
  lines.push(`${padLabel("Updated", lw)} ${tItalicGrey(run.updatedAt ?? "—")}`);
  lines.push("");
  lines.push(`{${PAL.white}-fg}{bold}Recent tasks:{/}`);
  lines.push(
    ...(snapshot.tasks.length > 0
      ? snapshot.tasks
          .slice(-8)
          .map((task) =>
            tDimWhite(
              `  [${task.role}#${task.cycle}] ${task.status} ${task.profileName ?? "-"} ${task.strategy ?? "-"} ${task.modelName ?? "-"} ${formatTaskDuration(task.startedAt, task.finishedAt)}`,
            ),
          )
      : [`  ${tItalicGrey("none")}`]),
  );

  return lines;
}

function renderPlanLines(run: NonNullable<DashboardSnapshot["selectedRun"]>) {
  const risks = Array.isArray(run.planRisks) ? run.planRisks : [];
  const openQuestions = Array.isArray(run.planOpenQuestions) ? run.planOpenQuestions : [];
  const radarMax = Math.max(1, risks.length, openQuestions.length);

  return [
    `{${PAL.white}-fg}{bold}Approved plan:{/}`,
    ...(run.planMarkdown ? indentBlock(run.planMarkdown) : [`  ${tItalicGrey("No approved plan recorded.")}`]),
    "",
    `{${PAL.grey}-fg}Plan radar:{/} risks ${renderBarPlain(risks.length, radarMax, 8)} ${risks.length} │ open ${renderBarPlain(openQuestions.length, radarMax, 8)} ${openQuestions.length}`,
    "",
    `{${PAL.white}-fg}{bold}Plan risks:{/}`,
    ...(risks.length > 0 ? risks.map((risk) => `  ${tDimWhite(risk)}`) : [`  ${tItalicGrey("none")}`]),
    "",
    `{${PAL.white}-fg}{bold}Open questions:{/}`,
    ...(openQuestions.length > 0
      ? openQuestions.map((question) => `  ${tDimWhite(question)}`)
      : [`  ${tItalicGrey("none")}`]),
  ];
}

function renderFindingsLines(run: NonNullable<DashboardSnapshot["selectedRun"]>) {
  const findings = Array.isArray(run.latestFindings) ? run.latestFindings : [];
  return [
    `{${PAL.white}-fg}{bold}Review summary:{/} ${tDimWhite(run.latestReviewSummary ?? "—")}`,
    "",
    `{${PAL.grey}-fg}Findings radar:{/} ${renderBarPlain(findings.length, Math.max(1, findings.length), 8)} ${findings.length}`,
    "",
    `{${PAL.white}-fg}{bold}Latest findings:{/}`,
    ...(findings.length > 0
      ? findings.map(
          (finding) =>
            `  ${tDimWhite(`${finding.title}${finding.file ? ` (${finding.file})` : ""}: ${finding.body}`)}`,
        )
      : [`  ${tItalicGrey("none")}`]),
  ];
}

function timelineSourceTag(source: DashboardSnapshot["timeline"][number]["source"]): string {
  if (source === "event") {
    return `{${PAL.active}-fg}{bold}[event]{/}`;
  }
  if (source === "log" || source === "message") {
    return `{${PAL.grey}-fg}[log]{/}`;
  }
  return `{${PAL.branchBlue}-fg}[system]{/}`;
}

function renderTimelinePane(snapshot: DashboardSnapshot, maxWidth: number) {
  if (snapshot.timeline.length === 0) {
    return `{${PAL.dimWhite}-fg}No timeline entries for the selected run.{/}`;
  }

  const inner = Math.max(8, maxWidth - 4);
  const lines: string[] = [];

  for (const item of snapshot.timeline) {
    const ts = tItalicGrey(formatTimestamp(item.timestamp));
    const tag = timelineSourceTag(item.source);
    const titlePlain = stripBlessedTags(item.title);
    const headPlainLen =
      stripBlessedTags(formatTimestamp(item.timestamp)).length + 1 + stripBlessedTags(tag).length + 1;
    const titleBudget = Math.max(8, inner - headPlainLen);
    const titleColored = `{${PAL.white}-fg}${truncateUnicode(titlePlain, titleBudget)}{/}`;
    lines.push(`${ts}  ${tag}  ${titleColored}`);

    if (item.detail) {
      lines.push(`  ${tDimWhite(truncateUnicode(item.detail, inner - 2, "…"))}`);
    }
  }

  return lines.join("\n");
}

function renderWorkflowLane(snapshot: DashboardSnapshot) {
  const run = snapshot.selectedRun;
  if (!run) {
    return [`  ${tDimWhite("No run selected.")}`];
  }

  const completedRoles = new Set(
    snapshot.tasks
      .filter((task) => task.status === "completed")
      .map((task) => task.role),
  );

  const stages = [
    {
      label: "PLAN",
      state: resolveRoleStageState({
        completed:
          completedRoles.has("planner") ||
          (Boolean(run.planMarkdown) && run.currentRole !== "planner") ||
          (run.currentCycle ?? 0) > 0,
        currentRole: run.currentRole,
        currentStatus: run.status,
        role: "planner",
        waitingStatus: "awaiting_plan_approval",
      }),
      detail: `${run.plannerProfile ?? "-"} / ${run.plannerDriver ?? "-"}`,
    },
    {
      label: "EXEC",
      state: resolveRoleStageState({
        completed:
          completedRoles.has("executor") ||
          run.currentRole === "reviewer" ||
          Boolean(run.summary && run.summary.trim() && run.currentRole !== "executor"),
        currentRole: run.currentRole,
        currentStatus: run.status,
        role: "executor",
        waitingStatus: "needs_human_input",
      }),
      detail: `${run.executorProfile ?? "-"} / ${run.modelName ?? "-"}`,
    },
    {
      label: "REVIEW",
      state: resolveReviewStageState(run, completedRoles.has("reviewer")),
      detail: `${run.reviewerProfile ?? "-"} / ${run.reviewerDriver ?? "-"}`,
    },
    {
      label: "PUBLISH",
      state: resolvePublishStageState(run.status),
      detail: run.mrUrl ?? run.branchName ?? "-",
    },
  ];

  return stages.map(
    (stage) =>
      `  {${PAL.white}-fg}{bold}${stage.label.padEnd(5, " ")}{/}  ${formatWorkflowStateBadge(stage.state)}  {${PAL.dimWhite}-fg}${stage.detail}{/}`,
  );
}

function resolveRoleStageState(input: {
  completed: boolean;
  currentRole: string | null;
  currentStatus: string;
  role: "planner" | "executor";
  waitingStatus: string;
}) {
  if (input.completed && input.currentRole !== input.role) {
    return "DONE";
  }
  if (FAILED_RUN_STATUSES.has(input.currentStatus) && input.currentRole === input.role) {
    return "STOP";
  }
  if (input.currentRole === input.role) {
    if (input.currentStatus === input.waitingStatus) {
      return "HOLD";
    }
    return "LIVE";
  }
  if (input.completed) {
    return "DONE";
  }
  return "WAIT";
}

function resolveReviewStageState(
  run: NonNullable<DashboardSnapshot["selectedRun"]>,
  completed: boolean,
) {
  if (run.status === "success") {
    return "DONE";
  }
  if (run.status === "publish_rejected") {
    return "STOP";
  }
  if (run.status === "awaiting_publish_approval") {
    return "HOLD";
  }
  if (run.currentRole === "reviewer") {
    return FAILED_RUN_STATUSES.has(run.status) ? "STOP" : "LIVE";
  }
  if (completed || Boolean(run.latestReviewSummary)) {
    return "DONE";
  }
  return "WAIT";
}

function resolvePublishStageState(status: string) {
  if (status === "success") {
    return "DONE";
  }
  if (status === "awaiting_publish_approval") {
    return "HOLD";
  }
  if (status === "publish_approved" || status === "publishing") {
    return "LIVE";
  }
  if (FAILED_RUN_STATUSES.has(status)) {
    return "STOP";
  }
  return "WAIT";
}

function renderFooter(
  snapshot: DashboardSnapshot,
  _state: DashboardControllerState,
  statusMessage: string,
  _actions: ReturnType<typeof listAvailableDashboardActions>,
  footerWidth: number,
) {
  const dim = PAL.dimWhite;
  const white = PAL.white;
  const footKey = (label: string) =>
    `{${dim}-fg}[{/${dim}-fg}{${white}-fg}{bold}${label}{/}{${dim}-fg}]{/}`;
  const gap = (text: string) => `{${dim}-fg}${text}{/}`;

  let hints = [
    footKey("Tab"),
    gap(" Cycle  "),
    footKey("↑↓"),
    gap(" Move  "),
    footKey("Enter"),
    gap(" Select  "),
    footKey("t"),
    gap(" Retry  "),
    footKey("r"),
    gap(" Refresh  "),
    footKey("q"),
    gap(" Quit"),
  ].join("");

  if (statusMessage && !statusMessage.startsWith("Inbox ")) {
    hints += gap(`  │  ${statusMessage}`);
  }

  const right = [
    `{${PAL.grey}-fg}Inbox{/} `,
    semanticStat(snapshot.summary.inboxCount, "inbox"),
    `  {${PAL.grey}-fg}Active{/} `,
    semanticStat(snapshot.summary.activeCount, "active"),
    `  {${PAL.grey}-fg}Failed{/} `,
    semanticStat(snapshot.summary.failedCount, "failed"),
    `  {${PAL.grey}-fg}Workers{/} `,
    `{${white}-fg}${snapshot.summary.workerCount}{/}`,
  ].join("");

  let line = `${hints}  ${right}`;
  if (stripBlessedTags(line).length > footerWidth) {
    const rightPlain = stripBlessedTags(right);
    const hintBudget = Math.max(24, footerWidth - rightPlain.length - 4);
    hints = truncateLine(stripBlessedTags(hints), hintBudget);
    line = `{${dim}-fg}${hints}{/}  ${right}`;
  }
  return line;
}

function renderModalBody(state: DashboardControllerState) {
  if (!state.modal) {
    return null;
  }
  if (state.modal.kind === "confirm") {
    return [state.modal.body, "", "Enter confirm", "Esc cancel"].join("\n");
  }
  return [
    "Question:",
    state.modal.question,
    "",
    "Response:",
    state.modal.value || "(empty)",
    "",
    "Ctrl+S send",
    "Esc cancel",
  ].join("\n");
}

function collectProjectSummary(snapshot: DashboardSnapshot): ProjectSummary[] {
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

function sliceWindow(lines: string[], focusIndex: number, maxLines: number) {
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

function normalizeActionKey(chars: string, key: { name?: string; full?: string }) {
  if (key.full === "C-c") {
    return "q";
  }
  if (key.full === "C-s") {
    return "C-s";
  }
  if (key.name === "return") {
    return "enter";
  }
  return key.name ?? key.full ?? chars;
}

function renderBar(value: number, maxValue: number, width: number) {
  if (width <= 0) {
    return "";
  }
  const safeMax = Math.max(1, maxValue);
  const filled = value <= 0 ? 0 : Math.max(1, Math.min(width, Math.round((value / safeMax) * width)));
  return `[${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}]`;
}

function renderBarPlain(value: number, maxValue: number, width: number) {
  return `{${PAL.grey}-fg}${renderBar(value, maxValue, width)}{/}`;
}

function formatAge(valueMs: number | null) {
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

function formatTaskDuration(startedAt: string | null, finishedAt: string | null) {
  if (!startedAt || !finishedAt) {
    return "-";
  }
  const startedMs = Date.parse(startedAt);
  const finishedMs = Date.parse(finishedAt);
  if (!Number.isFinite(startedMs) || !Number.isFinite(finishedMs) || finishedMs < startedMs) {
    return "-";
  }
  return formatAge(finishedMs - startedMs);
}

function formatTimestamp(timestamp: string | null) {
  if (!timestamp) {
    return "-";
  }
  if (timestamp.length >= 19 && timestamp[10] === "T") {
    return timestamp.slice(11, 19);
  }
  return timestamp;
}

function truncateLine(value: string, maxWidth: number, ellipsis: "..." | "…" = "...") {
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

function truncateUnicode(value: string, maxWidth: number, ellipsis: "..." | "…" = "…") {
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

function applyPaneStyle(
  box: {
    style: Record<string, unknown>;
  },
  input: { color: string; focused: boolean },
) {
  const fg = input.focused ? PAL.white : input.color;
  box.style = {
    ...box.style,
    border: {
      type: "line",
      fg,
      bold: Boolean(input.focused),
    },
    label: { fg: PAL.white, bold: true },
    fg: PAL.white,
  };
}

function indentBlock(value: string) {
  return value.split("\n").map((line) => `  ${tDimWhite(line)}`);
}
