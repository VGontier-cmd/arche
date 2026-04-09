import blessed from "neo-blessed";

import {
  executeDashboardAction,
} from "../actions";
import {
  createDashboardControllerState,
  handleDashboardInput,
  reconcileDashboardControllerState,
} from "../controller";
import { getDashboardSnapshot } from "../snapshot";

import {
  FOOTER_HEIGHT,
  HEADER_HEIGHT,
  MAIN_VERTICAL_TRIM,
  PAL,
  POLL_INTERVAL_MS,
  TOP_BAND_HEIGHT_RATIO,
} from "./theme";
import {
  formatCenteredPaneLabel,
  headerBorderColor,
  opsDetailBorderColor,
} from "./text-format";
import { renderDashboardLayout } from "./render-layout";
import { buildOpsDetailLabelContent } from "./render-sidebar";
import { applyPaneStyle, normalizeActionKey } from "./tui-helpers";

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
    const modalHeight =
      state.modal.kind === "human_reply" ? Math.min(height - 6, 18) : 9;
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

    applyPaneStyle(headerBox, {
      color: headerBorderColor(snapshot),
      focused: false,
    });
    applyPaneStyle(leftBox, {
      color: PAL.borderCyan,
      focused: state.focusedPane === "lists",
    });
    applyPaneStyle(detailBox, {
      color: opsDetailBorderColor(snapshot.selectedRun),
      focused: state.focusedPane === "detail",
    });
    applyPaneStyle(timelineBox, {
      color: PAL.borderCyan,
      focused: state.focusedPane === "timeline",
    });
    applyPaneStyle(modalBox, {
      color: PAL.failedFg,
      focused: Boolean(state.modal),
    });

    headerBox.setLabel(
      ` ${formatCenteredPaneLabel(Number(headerBox.width), "FLIGHT DECK")} `,
    );
    leftBox.setLabel(
      ` ${formatCenteredPaneLabel(Number(leftBox.width), "◈ RUN RADAR")} `,
    );
    headerBox.setContent(layout.header);
    leftBox.setContent(layout.left);
    detailBox.setLabel(
      ` ${buildOpsDetailLabelContent(snapshot, state, detailOuterW)} `,
    );
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
      snapshot = await getDashboardSnapshot({
        selectedRunId: state.selectedRunId,
      });
      state = reconcileDashboardControllerState(state, snapshot);
      statusMessage = [
        `Inbox ${snapshot.summary.inboxCount}`,
        `Active ${snapshot.summary.activeCount}`,
        `Failed ${snapshot.summary.failedCount}`,
        `Workers ${snapshot.summary.workerCount}`,
      ].join(" | ");
    } catch (error) {
      statusMessage =
        error instanceof Error
          ? `Refresh failed: ${error.message}`
          : "Refresh failed";
    }
    render();
  };

  const applyEffect = async (
    effect: ReturnType<typeof handleDashboardInput>["effect"],
  ) => {
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
      statusMessage =
        error instanceof Error ? error.message : "Dashboard action failed";
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

  screen.on(
    "keypress",
    async (chars: string, key: { name?: string; full?: string }) => {
      const actionKey = normalizeActionKey(chars, key);
      if (!actionKey) {
        return;
      }

      if (
        !state.modal &&
        state.focusedPane === "timeline" &&
        (actionKey === "up" ||
          actionKey === "down" ||
          actionKey === "k" ||
          actionKey === "j")
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
    },
  );

  screen.on("resize", () => {
    render();
  });

  render();

  return new Promise<void>((resolve) => {
    screen.once("destroy", () => resolve());
  });
}
