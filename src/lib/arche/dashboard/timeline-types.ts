export type DashboardTimelineItem = {
  id: string;
  source: "message" | "event" | "command" | "log" | "task";
  timestamp: string | null;
  title: string;
  detail: string | null;
};
