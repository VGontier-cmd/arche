import type { DashboardSnapshot, DashboardTimelineItem } from "../types";

export async function fetchSnapshot(
  runId?: string | null,
): Promise<DashboardSnapshot> {
  const url = runId
    ? `/v1/dashboard/snapshot/${runId}`
    : "/v1/dashboard/snapshot";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Snapshot fetch failed: ${res.statusText}`);
  return res.json();
}

export function sseUrl(runId: string | null): string {
  const base = "/v1/dashboard/sse";
  return runId ? `${base}?runId=${runId}` : base;
}

export async function postRunAction(
  runId: string,
  action: string,
): Promise<void> {
  const res = await fetch(`/v1/runs/${runId}/${action}`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
}

export async function fetchTimeline(
  runId: string,
  offset: number,
  limit: number,
): Promise<{ items: DashboardTimelineItem[]; total: number }> {
  const res = await fetch(`/v1/runs/${runId}/timeline?offset=${offset}&limit=${limit}`);
  if (!res.ok) throw new Error(`Timeline fetch failed: ${res.statusText}`);
  return res.json();
}

export async function postRespond(
  runId: string,
  message: string,
): Promise<void> {
  const res = await fetch(`/v1/runs/${runId}/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
}
