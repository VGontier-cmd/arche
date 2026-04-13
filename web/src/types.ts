export type DashboardSummary = {
  inboxCount: number;
  activeCount: number;
  failedCount: number;
  workerCount: number;
  onlineWorkerCount: number;
  offlineWorkerCount: number;
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
  dockerRunning: boolean;
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
  github: boolean;
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

// === Repositories & Rules ===

export type Repository = {
  id: string;
  name: string;
  gitProvider: string;
  remoteUrl: string;
  localMirrorPath: string;
  defaultBranch: string;
  enabled: boolean;
  gitlabProjectId: string | null;
  allowedCommands: string[];
  validationCommands: string[];
  createdAt: string;
  updatedAt: string;
};

export type RepoRule = {
  id: string;
  name: string;
  repositoryId: string;
  repositoryName: string | null;
  jiraProjectKey: string | null;
  label: string | null;
  issueType: string | null;
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

// === Config (read-only) ===

export type ExecutorProfile = {
  driver: string;
  base_url: string;
  model: string;
  api_key_env: string;
  timeout_seconds: number;
  max_actions: number;
  temperature: number;
};

export type OrchestratorConfigView = {
  workflow: {
    mode: string;
    require_plan_approval: boolean;
    require_publish_approval: boolean;
  };
  policy: {
    assignee: string;
    required_status: string;
    required_label: string;
    allowed_issue_types: string[];
    max_changed_files: number;
    max_changed_lines: number;
    description_min_length: number;
  };
  sandbox: {
    image: string;
    memory_limit_mb: number;
    cpus: string;
    read_only_rootfs: boolean;
    no_new_privileges: boolean;
    pids_limit: number;
    network: string;
    shell: string;
  };
  worker: {
    poll_interval_seconds: number;
    lease_ttl_seconds: number;
    max_agent_steps: number;
    max_run_seconds: number;
    human_input_timeout_hours: number;
  };
  defaults: {
    allowed_commands: string[];
    validation_commands: string[];
  };
  routing: { default_repository: string | null };
  git: { branch_prefix: string };
  executors: {
    defaults: { planner: string; executor: string; reviewer: string };
    profiles: Record<string, ExecutorProfile>;
  };
};

export type RunDetailSnapshot = {
  selectedRunId: string;
  selectedRun: DashboardRun;
  currentRun: DashboardRun;
  logs: unknown[];
  events: unknown[];
  commands: unknown[];
  messages: unknown[];
  tasks: DashboardTask[];
  timeline: DashboardTimelineItem[];
  timelineTotal: number;
};

export type AppView = "runs" | "repositories" | "rules" | "settings";

export type DashboardSnapshot = {
  refreshedAt: string;
  offlineThresholdMs: number;
  jiraBaseUrl: string | null;
  repositoryCount: number;
  ruleCount: number;
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
