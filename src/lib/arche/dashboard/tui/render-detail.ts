import { listAvailableDashboardActions } from "../actions";
import type { DashboardControllerState } from "../controller";
import type { DashboardSnapshot } from "../snapshot";

import { PAL, FAILED_RUN_STATUSES } from "./theme";
import {
  formatRunStatusColored,
  indentBlock,
  padLabel,
  tDimWhite,
  tItalicGrey,
  truncateLine,
  truncateToVisibleWidth,
  truncateUnicode,
} from "./text-format";
import { formatTaskDuration, renderBarPlain } from "./tui-helpers";
import { renderWorkflowLane } from "./render-workflow-timeline";

export function renderDetailPane(
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
    ? tDimWhite(
        `${snapshot.selectedWorker.status}/${snapshot.selectedWorker.activity}`,
      )
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
  lines.push(
    `${padLabel("Cycle", lw)} {${PAL.white}-fg}{bold}${run.currentCycle ?? 0}{/}`,
  );
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
  lines.push(
    `${padLabel("Reviewer", lw)} ${tDimWhite(run.reviewerProfile ?? "—")}  {${PAL.grey}-fg}│{/}  ${tDimWhite(run.reviewerDriver ?? "—")}`,
  );
  lines.push("");
  lines.push(`{${PAL.white}-fg}{bold}Signals{/}`);
  lines.push(
    `${padLabel("Summary", lw)} ${tDimWhite(truncateLine(run.summary ?? "—", 64))}`,
  );
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
  lines.push(
    `${padLabel("Worktree", lw)} ${tDimWhite(truncateLine(run.worktreePath ?? "—", 64))}`,
  );
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
  const openQuestions = Array.isArray(run.planOpenQuestions)
    ? run.planOpenQuestions
    : [];
  const radarMax = Math.max(1, risks.length, openQuestions.length);

  return [
    `{${PAL.white}-fg}{bold}Approved plan:{/}`,
    ...(run.planMarkdown
      ? indentBlock(run.planMarkdown)
      : [`  ${tItalicGrey("No approved plan recorded.")}`]),
    "",
    `{${PAL.grey}-fg}Plan radar:{/} risks ${renderBarPlain(risks.length, radarMax, 8)} ${risks.length} │ open ${renderBarPlain(openQuestions.length, radarMax, 8)} ${openQuestions.length}`,
    "",
    `{${PAL.white}-fg}{bold}Plan risks:{/}`,
    ...(risks.length > 0
      ? risks.map((risk) => `  ${tDimWhite(risk)}`)
      : [`  ${tItalicGrey("none")}`]),
    "",
    `{${PAL.white}-fg}{bold}Open questions:{/}`,
    ...(openQuestions.length > 0
      ? openQuestions.map((question) => `  ${tDimWhite(question)}`)
      : [`  ${tItalicGrey("none")}`]),
  ];
}

function renderFindingsLines(
  run: NonNullable<DashboardSnapshot["selectedRun"]>,
) {
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

