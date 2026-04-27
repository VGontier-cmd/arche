import type { DashboardRun, DashboardSnapshot, DashboardTimelineItem, MetricsSummary, OrchestratorConfigView, RepoRule, Repository, RunDetailSnapshot, RunSchedule } from "../types";

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

export async function postRunActionWithBody(
  runId: string,
  action: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`/v1/runs/${runId}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || res.statusText);
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

// === Run Export ===

export function downloadRunExport(runId: string): void {
  const a = document.createElement("a");
  a.href = `/v1/runs/${runId}/export`;
  a.download = `run-${runId.slice(0, 8)}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function fetchRunMarkdown(runId: string): Promise<string> {
  const res = await fetch(`/v1/runs/${runId}/export`);
  if (!res.ok) throw new Error(`Run export fetch failed: ${res.statusText}`);
  return res.text();
}

// === Run CSV batch export ===

/** Pass an empty array to export all runs; otherwise only the listed run IDs. */
export function downloadRunsCsv(runIds: string[]): void {
  const params = new URLSearchParams();
  params.set("format", "csv");
  for (const id of runIds) params.append("ids", id);
  const a = document.createElement("a");
  a.href = `/v1/runs/export?${params.toString()}`;
  a.download = `arche-runs-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// === Schedules ===

export async function fetchSchedules(): Promise<RunSchedule[]> {
  const res = await fetch("/v1/schedules");
  if (!res.ok) throw new Error(`Fetch schedules failed: ${res.statusText}`);
  return res.json();
}

export async function createScheduleApi(data: Partial<RunSchedule>): Promise<RunSchedule> {
  const res = await fetch("/v1/schedules", {
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

export async function updateScheduleApi(id: string, data: Partial<RunSchedule>): Promise<RunSchedule> {
  const res = await fetch(`/v1/schedules/${id}`, {
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

export async function deleteScheduleApi(id: string): Promise<void> {
  const res = await fetch(`/v1/schedules/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
}

export async function fireScheduleApi(id: string): Promise<unknown> {
  const res = await fetch(`/v1/schedules/${id}/fire`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

// === Ticket History ===

export async function fetchTicketRuns(ticketKey: string): Promise<DashboardRun[]> {
  const res = await fetch(`/v1/tickets/${encodeURIComponent(ticketKey)}/runs`);
  if (!res.ok) throw new Error(`Ticket history fetch failed: ${res.statusText}`);
  return res.json();
}

// === Manual Run ===

export async function triggerManualRun(
  ticketKey: string,
  force = false,
): Promise<{ id: string } & Record<string, unknown>> {
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

// === Metrics ===

export async function fetchCostEstimate(runId: string): Promise<import("../types").CostEstimate> {
  const res = await fetch(`/v1/runs/${runId}/cost-estimate`);
  if (!res.ok) throw new Error(`Cost estimate fetch failed: ${res.statusText}`);
  return res.json();
}

export async function fetchMetrics(days?: number): Promise<MetricsSummary> {
  const url = days ? `/v1/metrics?days=${days}` : "/v1/metrics";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch metrics failed: ${res.statusText}`);
  const json = await res.json() as { summary: MetricsSummary };
  return json.summary;
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

// === Setup credentials ===

export type SetupCredentialsInput = {
  openRouterKey?: string;
  githubToken?: string;
  gitlabToken?: string;
  gitlabBaseUrl?: string;
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraApiToken?: string;
};

export async function saveSetupCredentials(
  data: SetupCredentialsInput,
): Promise<{ ok: true; envPath: string }> {
  const res = await fetch("/v1/setup/credentials", {
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

// === OpenRouter Models ===

export type OpenRouterModel = {
  id: string;
  name: string;
  description: string;
  context_length: number;
};

export async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  const res = await fetch("/v1/models");
  if (!res.ok) throw new Error(`Fetch models failed: ${res.statusText}`);
  const json = await res.json() as { data?: OpenRouterModel[] };
  return json.data ?? [];
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
