import {
  presentRunCommand,
  presentRunEvent,
  presentRunLog,
  presentRunMessage,
  presentRunTask,
} from "../runs/presenters";
import type { DashboardTimelineItem } from "./timeline-types";

export function buildTimeline(input: {
  logs: Array<ReturnType<typeof presentRunLog>>;
  events: Array<ReturnType<typeof presentRunEvent>>;
  commands: Array<ReturnType<typeof presentRunCommand>>;
  messages: Array<ReturnType<typeof presentRunMessage>>;
  tasks: Array<ReturnType<typeof presentRunTask>>;
}): DashboardTimelineItem[] {
  const items: Array<DashboardTimelineItem & { sortTime: number; sortKey: string }> = [
    ...input.messages.map((message) => ({
      id: `message-${message.id}`,
      source: "message" as const,
      kind: message.kind ?? null,
      timestamp: message.timestamp,
      title: buildMessageTitle(message.role, message.kind ?? "", message.contentExcerpt ?? ""),
      detail: buildMessageDetail(message.kind ?? "", message.contentExcerpt ?? ""),
      thinkingExcerpt: (message as { thinkingExcerpt?: string | null }).thinkingExcerpt ?? null,
      sortTime: parseTimestamp(message.timestamp),
      sortKey: `message-${message.id}`,
    })),
    ...input.events.map((event) => ({
      id: `event-${event.id}`,
      source: "event" as const,
      timestamp: event.timestamp,
      title: event.type,
      detail:
        Object.keys(event.payload ?? {}).length > 0
          ? JSON.stringify(event.payload)
          : null,
      sortTime: parseTimestamp(event.timestamp),
      sortKey: `event-${event.id}`,
    })),
    ...input.commands.map((command) => ({
      id: `command-${command.id}`,
      source: "command" as const,
      timestamp: command.timestamp,
      title: `[${command.phase}] exit=${command.returncode} ${command.command}`,
      detail: command.stderrExcerpt ?? command.stdoutExcerpt ?? null,
      sortTime: parseTimestamp(command.timestamp),
      sortKey: `command-${command.id}`,
    })),
    ...input.logs.map((log) => ({
      id: `log-${log.id}`,
      source: "log" as const,
      timestamp: log.timestamp,
      title: `[${log.stream}] ${log.message}`,
      detail: null,
      sortTime: parseTimestamp(log.timestamp),
      sortKey: `log-${log.id}`,
    })),
    ...input.tasks.map((task) => ({
      id: `task-${task.id}`,
      source: "task" as const,
      timestamp: task.finishedAt ?? task.startedAt,
      title: `[${task.role}#${task.cycle}] ${task.status}`,
      detail: [task.profileName, task.strategy, task.modelName, task.summary]
        .filter((value) => typeof value === "string" && value.trim().length > 0)
        .join(" "),
      sortTime: parseTimestamp(task.finishedAt ?? task.startedAt),
      sortKey: `task-${task.id}`,
    })),
  ];

  return items
    .sort((left, right) => {
      if (left.sortTime !== right.sortTime) {
        return left.sortTime - right.sortTime;
      }
      return left.sortKey.localeCompare(right.sortKey);
    })
    .map(({ sortKey: _sortKey, sortTime: _sortTime, ...item }) => item);
}

/**
 * For executor action messages (kind="action"), the content IS the title — it's already
 * a short, descriptive line like "Writing file: src/index.ts".
 * For structured outputs (plan/review), use a concise label and put content in the detail.
 */
function buildMessageTitle(role: string, kind: string, content: string): string {
  if (kind === "action" || kind === "observation") {
    return content || `${role}/${kind}`;
  }
  if (kind === "plan") return "Plan drafted";
  if (kind === "review") return "Review result";
  if (kind === "error") return "Error";
  return `${role}/${kind}`;
}

function buildMessageDetail(kind: string, content: string): string | null {
  // Actions are self-descriptive — no need for an expand section.
  if (kind === "action") return null;
  return content || null;
}

function parseTimestamp(timestamp: string | null) {
  if (!timestamp) {
    return 0;
  }
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : 0;
}
