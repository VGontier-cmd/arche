export type DashboardTimelineItem = {
  id: string;
  source: "message" | "event" | "command" | "log" | "task";
  /** Message kind when source === "message" (e.g. "action", "plan", "review", "error"). */
  kind?: string | null;
  timestamp: string | null;
  title: string;
  detail: string | null;
  thinkingExcerpt?: string | null;
};
