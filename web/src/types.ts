export type DashboardSummary = {
  inboxCount: number;
  activeCount: number;
  failedCount: number;
  workerCount: number;
  onlineWorkerCount: number;
  offlineWorkerCount: number;
  totalCostUsd: number;
  avgDurationSeconds: number | null;
};

export type DashboardWorker = {
  id: string;
  name: string;
  hostname: string;
  pid: number;
  status: string;
  activity: string;
  currentRunId: string | null;
  currentTicketKey: string | null;
  currentStep: number | null;
  lastError: string | null;
  metadata: Record<string, unknown>;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  heartbeatAgeMs: number | null;
  offline: boolean;
};

export type DashboardServiceStatus = {
  workerRunning: boolean;
  serverRunning: boolean;
  serverUrl: string;
};

export type DashboardSystemStats = {
  ramMb: number;
  ramTotalMb: number;
  loadAvg1: number;
  cpuCount: number;
};

export type DashboardCredentialEnvStatus = {
  openRouter: boolean;
  gitlab: boolean;
  jira: boolean;
};

export type DashboardRun = {
  id: string;
  source: string;
  status: string;
  ticketKey: string;
  ticketTitle: string;
  ticketProjectKey: string | null;
  repoName: string | null;
  repositoryId: string | null;
  modelName: string | null;
  currentRole: string | null;
  currentCycle: number;
  planMarkdown: string | null;
  pendingQuestion: string | null;
  branchName: string | null;
  mrUrl: string | null;
  summary: string | null;
  diffExcerpt: string | null;
  failureReason: string | null;
  workerId: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  estimatedCostUsd: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type DashboardTask = {
  id: string;
  runId: string;
  role: string;
  status: string;
  modelName: string | null;
  estimatedCostUsd: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type DashboardTimelineItem = {
  id: string;
  source: "message" | "event" | "command" | "log" | "task";
  timestamp: string | null;
  title: string;
  detail: string | null;
};

export type DashboardSnapshot = {
  refreshedAt: string;
  offlineThresholdMs: number;
  jiraBaseUrl: string | null;
  summary: DashboardSummary;
  services: DashboardServiceStatus;
  systemStats: DashboardSystemStats;
  credentialEnv: DashboardCredentialEnvStatus;
  workers: DashboardWorker[];
  selectedWorkerId: string | null;
  selectedWorker: DashboardWorker | null;
  selectedRunId: string | null;
  selectedRun: DashboardRun | null;
  currentRun: DashboardRun | null;
  inboxRuns: DashboardRun[];
  activeRuns: DashboardRun[];
  recentRuns: DashboardRun[];
  logs: unknown[];
  events: unknown[];
  commands: unknown[];
  messages: unknown[];
  tasks: DashboardTask[];
  timeline: DashboardTimelineItem[];
  timelineTotal: number;
};
