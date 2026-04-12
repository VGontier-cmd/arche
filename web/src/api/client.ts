import type { DashboardSnapshot } from "../types";

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
