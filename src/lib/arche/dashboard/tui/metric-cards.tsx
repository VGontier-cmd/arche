import { Box, Text } from "ink";
import type { ReactNode } from "react";

import type { DashboardSummary } from "../snapshot";

import { PAL } from "./theme";

type MetricCardProps = {
  title: string;
  value: number;
  accent: string;
  width: number;
};

function MetricCard({ title, value, accent, width }: MetricCardProps): ReactNode {
  return (
    <Box
      borderStyle="single"
      borderColor={accent}
      flexDirection="column"
      paddingX={1}
      width={width}
    >
      <Text bold color={PAL.white}>
        {title}
      </Text>
      <Text color={accent} bold>
        {String(value)}
      </Text>
    </Box>
  );
}

export function MetricsSummaryRow(props: {
  summary: DashboardSummary;
  stdoutWidth: number;
}): ReactNode {
  const { summary, stdoutWidth } = props;
  const gap = 2;
  const cardW = Math.max(
    12,
    Math.floor((stdoutWidth - gap * 3) / 4),
  );
  return (
    <Box flexDirection="row">
      <Box marginRight={gap}>
        <MetricCard
          title="Inbox"
          value={summary.inboxCount}
          accent={PAL.inbox}
          width={cardW}
        />
      </Box>
      <Box marginRight={gap}>
        <MetricCard
          title="Active"
          value={summary.activeCount}
          accent={PAL.active}
          width={cardW}
        />
      </Box>
      <Box marginRight={gap}>
        <MetricCard
          title="Failed"
          value={summary.failedCount}
          accent={PAL.failedFg}
          width={cardW}
        />
      </Box>
      <MetricCard
        title="Workers"
        value={summary.workerCount}
        accent={PAL.done}
        width={cardW}
      />
    </Box>
  );
}
