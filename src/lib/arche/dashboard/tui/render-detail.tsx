import { Box, Text } from "ink";
import { Fragment } from "react";
import type { ReactNode } from "react";

import { listAvailableDashboardActions } from "../actions";
import type { DashboardControllerState } from "../controller";
import type { DashboardSnapshot } from "../snapshot";

import { formatRunStatusColoredInk, tDimWhiteInk, tItalicGreyInk } from "./ink-styled";
import { extractPlainText } from "./plain-text";
import { renderWorkflowLaneInk } from "./render-workflow-timeline";
import {
  padLabel,
  truncateLine,
  truncateToVisibleWidth,
  truncateUnicode,
} from "./text-format";
import { FAILED_RUN_STATUSES, PAL } from "./theme";
import { formatTaskDuration, renderBarPlain } from "./tui-helpers";

function indentPlanBlock(markdown: string): ReactNode[] {
  return markdown.split("\n").map((line, i) => (
    <Text key={i}>
      {" "}
      {tDimWhiteInk(line)}
    </Text>
  ));
}

function DetailLine({
  maxWidth,
  children,
}: {
  maxWidth: number;
  children: ReactNode;
}) {
  const plain = extractPlainText(children);
  if (plain.length <= maxWidth) {
    return <Box overflow="hidden">{children}</Box>;
  }
  return (
    <Box overflow="hidden" width={maxWidth}>
      <Text>{truncateToVisibleWidth(plain, maxWidth)}</Text>
    </Box>
  );
}

export function renderDetailPaneInk(
  snapshot: DashboardSnapshot,
  state: DashboardControllerState,
  maxLines: number,
  maxWidth: number,
) {
  const run = snapshot.selectedRun;
  if (!run) {
    return <Text color={PAL.dimWhite}>No run selected.</Text>;
  }

  const lines =
    state.detailTab === "overview"
      ? renderOverviewLinesInk(snapshot)
      : state.detailTab === "plan"
        ? renderPlanLinesInk(run)
        : renderFindingsLinesInk(run);

  const windowed = lines.slice(
    state.scrollByPane.detail,
    state.scrollByPane.detail + maxLines,
  );

  return (
    <Fragment>
      {windowed.map((line, i) => (
        <DetailLine key={i} maxWidth={maxWidth}>
          {line}
        </DetailLine>
      ))}
    </Fragment>
  );
}

function renderOverviewLinesInk(snapshot: DashboardSnapshot): ReactNode[] {
  const run = snapshot.selectedRun;
  if (!run) {
    return [<Text color={PAL.dimWhite}>No run selected.</Text>];
  }

  const actions = listAvailableDashboardActions(run);
  const lw = 10;
  const mrDisplay =
    run.mrUrl && run.mrUrl !== "-" ? (
      <Text color={PAL.branchBlue}>{truncateLine(run.mrUrl, 48)}</Text>
    ) : (
      <Text color={PAL.grey}>—</Text>
    );

  const workerPrimary = snapshot.selectedWorker ? (
    <Text color={PAL.inbox}>{snapshot.selectedWorker.name}</Text>
  ) : run.workerId ? (
    <Text color={PAL.magenta}>{truncateLine(run.workerId, 36)}</Text>
  ) : (
    <Text color={PAL.grey}>—</Text>
  );
  const workerSecondary = snapshot.selectedWorker
    ? tDimWhiteInk(
        `${snapshot.selectedWorker.status}/${snapshot.selectedWorker.activity}`,
      )
    : null;

  const statusVisual = FAILED_RUN_STATUSES.has(run.status) ? (
    <Text backgroundColor={PAL.failedBg} color={PAL.white} bold>
      ✗ {run.status}
    </Text>
  ) : (
    formatRunStatusColoredInk(run.status)
  );

  const runIdTrunc =
    run.id.length > 36 ? (
      <Text>
        <Text color={PAL.magenta}>{truncateUnicode(run.id, 36)}</Text>
        <Text color={PAL.grey}>…</Text>
      </Text>
    ) : (
      <Text color={PAL.magenta}>{run.id}</Text>
    );

  const lines: ReactNode[] = [
    <Text key="r1">
      {padLabel("Run", lw)} {runIdTrunc}
    </Text>,
    <Text key="r2">
      {padLabel("Ticket", lw)}{" "}
      <Text bold color={PAL.white}>
        {run.ticketKey}
      </Text>{" "}
      <Text color={PAL.grey}>│</Text>{" "}
      {tDimWhiteInk(truncateLine(run.ticketTitle ?? "—", 52))}
    </Text>,
    <Text key="r3">
      {padLabel("Status", lw)} {statusVisual}
    </Text>,
    <Text key="r4">
      {padLabel("Workflow", lw)}{" "}
      <Text color={PAL.inbox}>{run.workflowMode ?? "—"}</Text>
    </Text>,
    <Text key="r5">
      {padLabel("Role", lw)}{" "}
      <Text bold color={PAL.active}>
        {run.currentRole ?? "—"}
      </Text>
    </Text>,
    <Text key="r6">
      {padLabel("Cycle", lw)}{" "}
      <Text bold color={PAL.white}>
        {run.currentCycle ?? 0}
      </Text>
    </Text>,
    <Text key="r7">
      {padLabel("Repo", lw)}{" "}
      <Text color={PAL.branchBlue}>{run.repoName ?? "—"}</Text>
    </Text>,
    <Text key="r8">
      {padLabel("Worker", lw)} {workerPrimary}
      {workerSecondary ? (
        <Text>
          {" "}
          <Text color={PAL.grey}>│</Text> {workerSecondary}
        </Text>
      ) : null}
    </Text>,
    <Text key="r9">
      {padLabel("Branch", lw)}{" "}
      <Text color={PAL.branchBlue}>
        {truncateUnicode(run.branchName ?? "—", 44)}
      </Text>
      {(run.branchName?.length ?? 0) > 44 ? (
        <Text color={PAL.grey}>…</Text>
      ) : null}
    </Text>,
    <Text key="r10">
      {padLabel("MR", lw)} {mrDisplay}
    </Text>,
    <Text key="sep1"> </Text>,
    <Text key="wl" color={PAL.grey}>
      ─────────── Workflow Lane ───────────
    </Text>,
    ...renderWorkflowLaneInk(snapshot),
    <Text key="sp2"> </Text>,
    <Text key="aa" bold color={PAL.white}>
      Available actions:
    </Text>,
    ...(actions.length > 0
      ? actions.map((action) => (
          <Text key={action.label}>
            {" "}
            <Text color={PAL.grey}>{action.hotkey}</Text>{" "}
            <Text bold color={PAL.white}>
              {action.label}
            </Text>
          </Text>
        ))
      : [
          <Text key="noa">
            {" "}
            {tItalicGreyInk("none")}
          </Text>,
        ]),
    <Text key="sp3"> </Text>,
    <Text key="ep" bold color={PAL.white}>
      Execution profiles
    </Text>,
    <Text key="ep1">
      {padLabel("Planner", lw)} {tDimWhiteInk(run.plannerProfile ?? "—")}{" "}
      <Text color={PAL.grey}>│</Text> {tDimWhiteInk(run.plannerDriver ?? "—")}
    </Text>,
    <Text key="ep2">
      {padLabel("Executor", lw)} {tDimWhiteInk(run.executorProfile ?? "—")}{" "}
      <Text color={PAL.grey}>│</Text> {tDimWhiteInk(run.executorDriver ?? "—")}{" "}
      <Text color={PAL.grey}>│</Text> {tDimWhiteInk(run.modelName ?? "—")}
    </Text>,
    <Text key="ep3">
      {padLabel("Reviewer", lw)} {tDimWhiteInk(run.reviewerProfile ?? "—")}{" "}
      <Text color={PAL.grey}>│</Text> {tDimWhiteInk(run.reviewerDriver ?? "—")}
    </Text>,
    <Text key="sp4"> </Text>,
    <Text key="sig" bold color={PAL.white}>
      Signals
    </Text>,
    <Text key="sig1">
      {padLabel("Summary", lw)}{" "}
      {tDimWhiteInk(truncateLine(run.summary ?? "—", 64))}
    </Text>,
    <Text key="sig2">
      {padLabel("Review", lw)}{" "}
      {tDimWhiteInk(truncateLine(run.latestReviewSummary ?? "—", 64))}
    </Text>,
    <Text key="sig3">
      {padLabel("Question", lw)}{" "}
      {tDimWhiteInk(truncateLine(run.pendingQuestion ?? "—", 64))}
    </Text>,
    <Text key="sig4">
      {padLabel("Failure", lw)}{" "}
      {FAILED_RUN_STATUSES.has(run.status) ? (
        <Text color={PAL.failedFg}>
          {truncateLine(run.failureReason ?? "—", 64)}
        </Text>
      ) : (
        tDimWhiteInk(run.failureReason ?? "—")
      )}
    </Text>,
    <Text key="sp5"> </Text>,
    <Text key="rt" bold color={PAL.white}>
      Runtime
    </Text>,
    <Text key="rt1">
      {padLabel("Worktree", lw)}{" "}
      {tDimWhiteInk(truncateLine(run.worktreePath ?? "—", 64))}
    </Text>,
    <Text key="rt2">
      {padLabel("Sandbox", lw)} {tDimWhiteInk(run.sandboxId ?? "—")}
    </Text>,
    <Text key="rt3">
      {padLabel("Started", lw)} {tItalicGreyInk(run.startedAt ?? "—")}
    </Text>,
    <Text key="rt4">
      {padLabel("Updated", lw)} {tItalicGreyInk(run.updatedAt ?? "—")}
    </Text>,
    <Text key="sp6"> </Text>,
    <Text key="tsk" bold color={PAL.white}>
      Recent tasks:
    </Text>,
    ...(snapshot.tasks.length > 0
      ? snapshot.tasks.slice(-8).map((task, i) => (
          <Text key={`t-${i}`}>
            {tDimWhiteInk(
              `  [${task.role}#${task.cycle}] ${task.status} ${task.profileName ?? "-"} ${task.strategy ?? "-"} ${task.modelName ?? "-"} ${formatTaskDuration(task.startedAt, task.finishedAt)}`,
            )}
          </Text>
        ))
      : [
          <Text key="notsk">
            {" "}
            {tItalicGreyInk("none")}
          </Text>,
        ]),
  ];

  return lines;
}

function renderPlanLinesInk(run: NonNullable<DashboardSnapshot["selectedRun"]>) {
  const risks = Array.isArray(run.planRisks) ? run.planRisks : [];
  const openQuestions = Array.isArray(run.planOpenQuestions)
    ? run.planOpenQuestions
    : [];
  const radarMax = Math.max(1, risks.length, openQuestions.length);

  const out: ReactNode[] = [
    <Text key="h1" bold color={PAL.white}>
      Approved plan:
    </Text>,
  ];

  if (run.planMarkdown) {
    out.push(...indentPlanBlock(run.planMarkdown));
  } else {
    out.push(
      <Text key="np">
        {" "}
        {tItalicGreyInk("No approved plan recorded.")}
      </Text>,
    );
  }

  out.push(<Text key="sp"> </Text>);
  out.push(
    <Text key="pr">
      <Text color={PAL.grey}>Plan radar: </Text>
      risks{" "}
      <Text color={PAL.grey}>{renderBarPlain(risks.length, radarMax, 8)}</Text>{" "}
      {risks.length} │ open{" "}
      <Text color={PAL.grey}>
        {renderBarPlain(openQuestions.length, radarMax, 8)}
      </Text>{" "}
      {openQuestions.length}
    </Text>,
  );
  out.push(<Text key="sp2"> </Text>);
  out.push(
    <Text key="h2" bold color={PAL.white}>
      Plan risks:
    </Text>,
  );
  if (risks.length > 0) {
    risks.forEach((risk, i) => {
      out.push(
        <Text key={`r-${i}`}>
          {" "}
          {tDimWhiteInk(risk)}
        </Text>,
      );
    });
  } else {
    out.push(
      <Text key="nr">
        {" "}
        {tItalicGreyInk("none")}
      </Text>,
    );
  }
  out.push(<Text key="sp3"> </Text>);
  out.push(
    <Text key="h3" bold color={PAL.white}>
      Open questions:
    </Text>,
  );
  if (openQuestions.length > 0) {
    openQuestions.forEach((question, i) => {
      out.push(
        <Text key={`q-${i}`}>
          {" "}
          {tDimWhiteInk(question)}
        </Text>,
      );
    });
  } else {
    out.push(
      <Text key="nq">
        {" "}
        {tItalicGreyInk("none")}
      </Text>,
    );
  }

  return out;
}

function renderFindingsLinesInk(
  run: NonNullable<DashboardSnapshot["selectedRun"]>,
) {
  const findings = Array.isArray(run.latestFindings) ? run.latestFindings : [];
  return [
    <Text key="fs">
      <Text bold color={PAL.white}>
        Review summary:{" "}
      </Text>
      {tDimWhiteInk(run.latestReviewSummary ?? "—")}
    </Text>,
    <Text key="sp"> </Text>,
    <Text key="fr">
      <Text color={PAL.grey}>Findings radar: </Text>
      <Text color={PAL.grey}>
        {renderBarPlain(findings.length, Math.max(1, findings.length), 8)}
      </Text>{" "}
      {findings.length}
    </Text>,
    <Text key="sp2"> </Text>,
    <Text key="lf" bold color={PAL.white}>
      Latest findings:
    </Text>,
    ...(findings.length > 0
      ? findings.map((finding, i) => (
          <Text key={`f-${i}`}>
            {" "}
            {tDimWhiteInk(
              `${finding.title}${finding.file ? ` (${finding.file})` : ""}: ${finding.body}`,
            )}
          </Text>
        ))
      : [
          <Text key="nf">
            {" "}
            {tItalicGreyInk("none")}
          </Text>,
        ]),
  ];
}
