import type { DashboardRun, DashboardSnapshot, DashboardTimelineItem, OrchestratorConfigView, RepoRule, Repository, RunDetailSnapshot } from "../types";

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

export async function fetchRunDetail(runId: string): Promise<RunDetailSnapshot> {
  const res = await fetch(`/v1/dashboard/run-detail/${runId}`);
  if (!res.ok) throw new Error(`Run detail fetch failed: ${res.statusText}`);
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

// === Ticket History ===

export async function fetchTicketRuns(ticketKey: string): Promise<DashboardRun[]> {
  const res = await fetch(`/v1/tickets/${encodeURIComponent(ticketKey)}/runs`);
  if (!res.ok) throw new Error(`Ticket history fetch failed: ${res.statusText}`);
  return res.json();
}

// === Manual Run ===

export async function triggerManualRun(ticketKey: string, force = false): Promise<unknown> {
  const res = await fetch("/v1/runs/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticketKey, force }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

// === Repositories ===

export async function fetchRepositories(): Promise<Repository[]> {
  const res = await fetch("/v1/repositories");
  if (!res.ok) throw new Error(`Fetch repositories failed: ${res.statusText}`);
  return res.json();
}

export async function createRepository(data: Partial<Repository>): Promise<Repository> {
  const res = await fetch("/v1/repositories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

export async function updateRepository(id: string, data: Partial<Repository>): Promise<Repository> {
  const res = await fetch(`/v1/repositories/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

export async function deleteRepositoryApi(id: string): Promise<void> {
  const res = await fetch(`/v1/repositories/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
}

// === Repo Rules ===

export async function fetchRepoRules(): Promise<RepoRule[]> {
  const res = await fetch("/v1/repo-rules");
  if (!res.ok) throw new Error(`Fetch repo rules failed: ${res.statusText}`);
  return res.json();
}

export async function createRepoRule(data: Partial<RepoRule>): Promise<RepoRule> {
  const res = await fetch("/v1/repo-rules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

export async function updateRepoRule(id: string, data: Partial<RepoRule>): Promise<RepoRule> {
  const res = await fetch(`/v1/repo-rules/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

export async function deleteRepoRuleApi(id: string): Promise<void> {
  const res = await fetch(`/v1/repo-rules/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
}

// === Config ===

export async function fetchConfig(): Promise<OrchestratorConfigView> {
  const res = await fetch("/v1/config");
  if (!res.ok) throw new Error(`Fetch config failed: ${res.statusText}`);
  return res.json();
}

export async function updateConfig(
  patch: Partial<OrchestratorConfigView>,
): Promise<OrchestratorConfigView> {
  const res = await fetch("/v1/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

// === Workers ===

export async function purgeOfflineWorkersApi(): Promise<{ purged: string[] }> {
  const res = await fetch("/v1/workers/purge-offline", { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

export async function stopWorkerApi(workerId: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`/v1/workers/${encodeURIComponent(workerId)}/stop`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

export async function restartWorkerApi(workerId: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`/v1/workers/${encodeURIComponent(workerId)}/restart`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}
