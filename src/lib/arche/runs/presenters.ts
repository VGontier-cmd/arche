import type {
  RepoRuleRow,
  RunCommandRow,
  RunEventRow,
  RunLogRow,
  RunMessageRow,
  RunRow,
  RunTaskRow,
} from "../../db/schema";
import { serializeDate } from "../utils";

export type RunListItem = ReturnType<typeof presentRun>;

export function presentRun(run: RunRow) {
  // Fall back to createdAt for legacy runs that have null startedAt but have started
  const startedAtFallback = run.startedAt ?? (run.status !== "pending" ? run.createdAt : null);
  return {
    ...run,
    createdAt: serializeDate(run.createdAt),
    updatedAt: serializeDate(run.updatedAt),
    startedAt: serializeDate(startedAtFallback),
    finishedAt: serializeDate(run.finishedAt),
    leaseExpiresAt: serializeDate(run.leaseExpiresAt),
    archivedAt: serializeDate(run.archivedAt),
  };
}

export function presentRunEvent(event: RunEventRow) {
  return {
    ...event,
    timestamp: serializeDate(event.timestamp),
  };
}

export function presentRunLog(log: RunLogRow) {
  return {
    ...log,
    timestamp: serializeDate(log.timestamp),
  };
}

export function presentRunCommand(command: RunCommandRow) {
  return {
    ...command,
    timestamp: serializeDate(command.timestamp),
  };
}

export function presentRunMessage(message: RunMessageRow) {
  return {
    ...message,
    timestamp: serializeDate(message.timestamp),
  };
}

export function presentRunTask(task: RunTaskRow) {
  return {
    ...task,
    startedAt: serializeDate(task.startedAt),
    finishedAt: serializeDate(task.finishedAt),
  };
}

export function presentRepoRule(
  rule: RepoRuleRow,
  extras: {
    repositoryName?: string | null;
  } = {},
) {
  return {
    ...rule,
    ...extras,
    createdAt: serializeDate(rule.createdAt),
    updatedAt: serializeDate(rule.updatedAt),
  };
}
