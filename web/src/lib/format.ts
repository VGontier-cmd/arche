export function formatTime(ts: string | null | undefined): string {
  if (!ts) return "-";
  const d = new Date(ts);
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatDuration(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (!start) return "-";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const sec = Math.floor((e - s) / 1000);
  if (sec < 60) return sec + "s";
  return Math.floor(sec / 60) + "m " + (sec % 60) + "s";
}

export function formatCost(usd: string | number | null | undefined): string {
  if (usd === null || usd === undefined) return "";
  return "$" + Number(usd).toFixed(4);
}

export function formatRelativeTime(ts: string | null | undefined): string {
  if (!ts) return "-";
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return formatTime(ts);
}