import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { executeDashboardAction } from "../actions";
import {
  createDashboardControllerState,
  handleDashboardInput,
  reconcileDashboardControllerState,
} from "../controller";
import { getDashboardSnapshot } from "../snapshot";

import { readHostMetrics, type HostMetricsSample } from "./host-metrics";
import { renderDashboardLayout } from "./render-layout";
import { buildOpsDetailLabelContent } from "./render-sidebar";
import {
  FOOTER_HEIGHT,
  PAL,
  POLL_INTERVAL_MS,
  TOP_BAND_HEIGHT_RATIO,
} from "./theme";
import {
  formatCenteredPaneLabel,
  headerBorderColor,
  opsDetailBorderColor,
} from "./text-format";
import { mapInkToDashboardKey } from "./tui-helpers";

export function DashboardApp() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const cols = stdout.columns ?? 80;
  const termRows = stdout.rows ?? 24;

  const [state, setState] = useState(createDashboardControllerState);
  const [snapshot, setSnapshot] = useState<Awaited<
    ReturnType<typeof getDashboardSnapshot>
  > | null>(null);
  const [statusMessage, setStatusMessage] = useState("Connected");
  const [hostSample, setHostSample] = useState<HostMetricsSample>(() =>
    readHostMetrics(),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const tickHost = useCallback(() => {
    const m = readHostMetrics();
    setHostSample(m);
  }, []);

  const runRefresh = useCallback(async () => {
    try {
      const snap = await getDashboardSnapshot({
        selectedRunId: stateRef.current.selectedRunId,
      });
      const nextState = reconcileDashboardControllerState(stateRef.current, snap);
      stateRef.current = nextState;
      setSnapshot(snap);
      setState(nextState);
      setStatusMessage(
        [
          `Inbox ${snap.summary.inboxCount}`,
          `Active ${snap.summary.activeCount}`,
          `Failed ${snap.summary.failedCount}`,
          `Workers ${snap.summary.workerCount}`,
        ].join(" | "),
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? `Refresh failed: ${error.message}`
          : "Refresh failed",
      );
    }
  }, []);

  useEffect(() => {
    tickHost();
    void runRefresh();
  }, [runRefresh, tickHost]);

  useEffect(() => {
    const id = setInterval(() => {
      tickHost();
      void runRefresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [runRefresh, tickHost]);

  const applyEffect = useCallback(
    async (
      effect: ReturnType<typeof handleDashboardInput>["effect"],
    ): Promise<boolean> => {
      if (!effect) {
        return false;
      }
      if (effect.type === "quit") {
        exit();
        return true;
      }
      if (effect.type === "refresh") {
        await runRefresh();
        return true;
      }
      if (effect.type === "notify") {
        setStatusMessage(effect.message);
        return true;
      }
      try {
        const result = await executeDashboardAction(effect.action);
        setState((s) => {
          const next = {
            ...s,
            selectedRunId: result.selectedRunId,
            highlightedRunId: result.selectedRunId,
          };
          stateRef.current = next;
          return next;
        });
        setStatusMessage(result.message);
        await runRefresh();
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Dashboard action failed",
        );
      }
      return true;
    },
    [exit, runRefresh],
  );

  useInput(
    (input, key) => {
      const snap = snapshotRef.current;
      if (snap === null) {
        return;
      }
      void (async () => {
        const actionKey = mapInkToDashboardKey(input, key);
        if (actionKey === null) {
          return;
        }
        const previousSelectedRunId = stateRef.current.selectedRunId;
        const result = handleDashboardInput(
          stateRef.current,
          snap,
          actionKey,
          input,
        );
        const nextState = reconcileDashboardControllerState(result.state, snap);
        stateRef.current = nextState;
        setState(nextState);

        const handled = await applyEffect(result.effect);
        if (handled) {
          return;
        }

        if (previousSelectedRunId !== nextState.selectedRunId) {
          await runRefresh();
        }
      })();
    },
    { isActive: Boolean(snapshot) },
  );

  const layout = useMemo(() => {
    if (!snapshot) {
      return null;
    }
    const screenWidth = Math.max(40, cols - 2);
    const contentRows = Math.max(10, termRows - FOOTER_HEIGHT - 1);
    const feedHeight = Math.max(
      6,
      Math.min(
        Math.ceil(contentRows * (1 - TOP_BAND_HEIGHT_RATIO)),
        contentRows - 8,
      ),
    );
    /** Reserve space for header, metric cards, host CPU/RAM row; middle panes use the rest. */
    const headerAndMetricsReserve = screenWidth >= 92 ? 18 : 26;
    const middleRows = Math.max(
      6,
      contentRows - feedHeight - headerAndMetricsReserve,
    );

    return renderDashboardLayout(
      snapshot,
      state,
      statusMessage,
      { sample: hostSample },
      {
        screenWidth,
        stdoutCols: cols,
        leftHeight: Math.max(6, middleRows - 1),
        leftWidth: Math.max(24, Math.floor(cols * 0.35) - 4),
        detailHeight: Math.max(6, middleRows - 1),
        detailWidth: Math.max(24, Math.floor(cols * 0.65) - 6),
        timelineHeight: Math.max(4, feedHeight - 2),
        timelineWidth: Math.max(40, cols - 6),
        detailOuterWidth: Math.max(20, Math.floor(cols * 0.65) - 2),
        footerWidth: screenWidth,
      },
    );
  }, [snapshot, state, statusMessage, hostSample, cols, termRows]);

  if (!snapshot || !layout) {
    return (
      <Box justifyContent="center">
        <Text color={PAL.dimWhite}>Loading dashboard…</Text>
      </Box>
    );
  }

  const leftBorder =
    state.focusedPane === "lists" ? PAL.white : PAL.borderCyan;
  const detailBorder = opsDetailBorderColor(snapshot.selectedRun);
  const detailFocus =
    state.focusedPane === "detail" ? PAL.white : detailBorder;
  const timelineBorder =
    state.focusedPane === "timeline" ? PAL.white : PAL.borderCyan;
  const headerColor = headerBorderColor(snapshot);

  const contentRows = Math.max(10, termRows - FOOTER_HEIGHT - 1);
  const feedHeight = Math.max(
    6,
    Math.min(
      Math.ceil(contentRows * (1 - TOP_BAND_HEIGHT_RATIO)),
      contentRows - 8,
    ),
  );

  return (
    <Box flexDirection="column" width={cols} height={termRows}>
      <Box flexDirection="column" flexShrink={0} width="100%">
        <Box
          flexDirection="column"
          flexShrink={0}
          width="100%"
          borderStyle="single"
          borderColor={headerColor}
          paddingX={1}
          marginBottom={1}
        >
          {layout.header}
        </Box>
        {layout.metricsRow}
        {layout.hostMetricsRow}
      </Box>

      <Box
        flexDirection="row"
        flexGrow={1}
        flexBasis={0}
        width="100%"
        minHeight={6}
        overflow="hidden"
      >
        <Box
          width="35%"
          height="100%"
          flexDirection="column"
          borderStyle="single"
          borderColor={leftBorder}
          paddingX={1}
        >
          <Text bold color={PAL.white}>
            {` ${formatCenteredPaneLabel(Math.floor(cols * 0.35), "◈ RUN RADAR")} `}
          </Text>
          <Box flexDirection="column">{layout.left}</Box>
        </Box>
        <Box width="65%" height="100%" flexDirection="column">
          <Box
            flexGrow={1}
            borderStyle="single"
            borderColor={detailFocus}
            paddingX={1}
            flexDirection="column"
          >
            <Text bold color={PAL.white}>
              {` ${buildOpsDetailLabelContent(snapshot, state, Math.max(20, Math.floor(cols * 0.65) - 2))} `}
            </Text>
            <Box flexDirection="column">{layout.detail}</Box>
          </Box>
        </Box>
      </Box>

      <Box
        flexShrink={0}
        flexDirection="column"
        borderStyle="single"
        borderColor={timelineBorder}
        paddingX={1}
        height={feedHeight}
        overflow="hidden"
      >
        <Text bold color={PAL.white}>
          {` ${formatCenteredPaneLabel(cols - 2, `◎ ACTIVITY FEED  (${snapshot.timeline.length} items)`)} `}
        </Text>
        <Box flexDirection="column">{layout.timeline}</Box>
      </Box>

      <Box flexShrink={0} height={FOOTER_HEIGHT}>
        {layout.footer}
      </Box>

      {state.modal && layout.modalTitle && layout.modalBody ? (
        <Box
          position="absolute"
          flexDirection="column"
          borderStyle="single"
          borderColor={PAL.failedFg}
          paddingX={1}
          width={Math.min(cols - 8, 88)}
          marginLeft={Math.max(0, Math.floor((cols - Math.min(cols - 8, 88)) / 2))}
          marginTop={Math.max(1, Math.floor(termRows / 4))}
        >
          <Text bold color={PAL.white}>
            {" "}
            {layout.modalTitle}{" "}
          </Text>
          <Box flexDirection="column">{layout.modalBody}</Box>
        </Box>
      ) : null}
    </Box>
  );
}
