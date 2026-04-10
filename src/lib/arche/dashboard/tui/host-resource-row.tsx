import { Box, Text } from "ink";
import type { ReactNode } from "react";

import type { HostMetricsSample } from "./host-metrics";
import { PAL } from "./theme";

function formatGiB(bytes: number): string {
  if (bytes <= 0) {
    return "0 GiB";
  }
  const gib = bytes / 1024 ** 3;
  if (gib >= 100) {
    return `${Math.round(gib)} GiB`;
  }
  if (gib >= 10) {
    return `${gib.toFixed(1)} GiB`;
  }
  return `${gib.toFixed(2)} GiB`;
}

function formatCpuLoad(percent: number, totalCores: number): string {
  const used = (percent / 100) * Math.max(0, totalCores);
  const decimals = totalCores <= 4 ? 2 : 1;
  const u =
    totalCores === 0
      ? "0"
      : used >= 10
        ? used.toFixed(1)
        : used.toFixed(decimals);
  return `${u} / ${Math.max(0, totalCores)} cores`;
}

function formatRamUsed(percent: number, totalBytes: number): string {
  if (totalBytes <= 0) {
    return "0 / 0 GiB";
  }
  const used = Math.max(0, Math.round((percent / 100) * totalBytes));
  return `${formatGiB(used)} / ${formatGiB(totalBytes)}`;
}

function pctBar(percent: number, width: number): string {
  if (width <= 0) {
    return "";
  }
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)));
  const empty = Math.max(0, width - filled);
  return `${"█".repeat(filled)}${"░".repeat(empty)}`;
}

function panelInnerWidth(panelOuter: number): number {
  return Math.max(12, panelOuter - 4);
}

export function HostResourceRow(props: {
  sample: HostMetricsSample;
  stdoutWidth: number;
}): ReactNode {
  const { sample, stdoutWidth } = props;
  const gap = 2;
  const stackVertical = stdoutWidth < 58;
  const panelsAcross = stackVertical ? 1 : 2;
  const panelOuter = Math.max(
    24,
    Math.floor((stdoutWidth - gap * (panelsAcross - 1)) / panelsAcross),
  );
  const inner = panelInnerWidth(panelOuter);
  const barW = Math.max(8, inner - 2);

  const panel = (opts: {
    title: string;
    accent: string;
    percent: number;
    usageLabel: string;
  }) => (
    <Box
      flexGrow={stackVertical ? 0 : 1}
      flexBasis={stackVertical ? undefined : 0}
      minWidth={stackVertical ? stdoutWidth - 2 : 20}
      width={stackVertical ? stdoutWidth - 2 : undefined}
      borderStyle="single"
      borderColor={opts.accent}
      paddingX={1}
      flexDirection="column"
    >
      <Text bold color={PAL.white}>
        {opts.title}
      </Text>
      <Text>
        <Text color={PAL.grey}>{opts.usageLabel}</Text>
        <Text> </Text>
        <Text color={opts.accent}>{pctBar(opts.percent, barW)}</Text>
        <Text> </Text>
        <Text color={PAL.dimWhite}>{opts.percent}%</Text>
      </Text>
    </Box>
  );

  return (
    <Box
      flexDirection={stackVertical ? "column" : "row"}
      columnGap={gap}
      rowGap={stackVertical ? 1 : 0}
      marginTop={1}
      width="100%"
      flexWrap="nowrap"
    >
      {panel({
        title: "CPU (host)",
        accent: PAL.active,
        percent: sample.cpuPercent,
        usageLabel: formatCpuLoad(sample.cpuPercent, sample.logicalCores),
      })}
      {panel({
        title: "RAM (host)",
        accent: PAL.branchBlue,
        percent: sample.ramPercent,
        usageLabel: formatRamUsed(sample.ramPercent, sample.totalMemBytes),
      })}
    </Box>
  );
}
