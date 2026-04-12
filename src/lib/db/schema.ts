import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type { ReviewFinding } from "../arche/types";

export const repositories = sqliteTable(
  "repositories",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    gitProvider: text("git_provider").notNull().default("gitlab"),
    remoteUrl: text("remote_url").notNull(),
    localMirrorPath: text("local_mirror_path").notNull(),
    defaultBranch: text("default_branch").notNull().default("main"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    gitlabProjectId: text("gitlab_project_id"),
    allowedCommands: text("allowed_commands", { mode: "json" }).$type<string[]>().notNull(),
    validationCommands: text("validation_commands", { mode: "json" }).$type<string[]>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (table) => ({
    nameUnique: uniqueIndex("repositories_name_unique").on(table.name),
  }),
);

export const inferenceServers = sqliteTable(
  "inference_servers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    providerType: text("provider_type").notNull().default("openai_compatible"),
    baseUrl: text("base_url").notNull(),
    apiKeyRef: text("api_key_ref").notNull(),
    defaultModel: text("default_model").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    options: text("options", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (table) => ({
    nameUnique: uniqueIndex("inference_servers_name_unique").on(table.name),
  }),
);

export const repoRules = sqliteTable("repo_rules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  jiraProjectKey: text("jira_project_key"),
  label: text("label"),
  issueType: text("issue_type"),
  priority: integer("priority").notNull().default(100),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  repositoryId: text("repository_id")
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
});

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull().default("jira"),
    status: text("status").notNull().default("pending"),
    ticketKey: text("ticket_key").notNull(),
    ticketTitle: text("ticket_title").notNull(),
    ticketProjectKey: text("ticket_project_key"),
    ticketPayload: text("ticket_payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    repoName: text("repo_name"),
    repositoryId: text("repository_id").references(() => repositories.id, {
      onDelete: "set null",
    }),
    inferenceServerId: text("inference_server_id").references(() => inferenceServers.id, {
      onDelete: "set null",
    }),
    providerType: text("provider_type"),
    workflowMode: text("workflow_mode").notNull().default("plan_execute_review"),
    plannerProfile: text("planner_profile"),
    executorProfile: text("executor_profile"),
    reviewerProfile: text("reviewer_profile"),
    plannerDriver: text("planner_driver"),
    executorDriver: text("executor_driver"),
    reviewerDriver: text("reviewer_driver"),
    executorType: text("executor_type").notNull().default("openai_compatible_api"),
    modelName: text("model_name"),
    currentRole: text("current_role"),
    currentCycle: integer("current_cycle").notNull().default(0),
    planMarkdown: text("plan_markdown"),
    planRisks: text("plan_risks", { mode: "json" }).$type<string[]>().notNull().default([]),
    planOpenQuestions: text("plan_open_questions", { mode: "json" }).$type<string[]>().notNull().default([]),
    latestReviewSummary: text("latest_review_summary"),
    latestFindings: text("latest_findings", { mode: "json" }).$type<ReviewFinding[]>().notNull().default([]),
    pendingQuestion: text("pending_question"),
    latestHumanResponse: text("latest_human_response"),
    branchName: text("branch_name"),
    worktreePath: text("worktree_path"),
    worktreeRetained: integer("worktree_retained", { mode: "boolean" }).notNull().default(false),
    sandboxId: text("sandbox_id"),
    mrUrl: text("mr_url"),
    summary: text("summary"),
    failureReason: text("failure_reason"),
    diffExcerpt: text("diff_excerpt"),
    artifactsPath: text("artifacts_path"),
    commandHistory: text("command_history", { mode: "json" }).$type<Record<string, unknown>[]>().notNull(),
    manualOverride: text("manual_override", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    estimatedCostUsd: text("estimated_cost_usd"),
    cancelRequested: integer("cancel_requested", { mode: "boolean" }).notNull().default(false),
    workerId: text("worker_id"),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp_ms" }),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (table) => ({
    ticketKeyIdx: index("runs_ticket_key_idx").on(table.ticketKey),
    statusIdx: index("runs_status_idx").on(table.status),
  }),
);

export const runEvents = sqliteTable("run_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull().defaultNow(),
  type: text("type").notNull(),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
});

export const runLogs = sqliteTable("run_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull().defaultNow(),
  stream: text("stream").notNull(),
  message: text("message").notNull(),
});

export const runCommands = sqliteTable(
  "run_commands",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull().defaultNow(),
    phase: text("phase").notNull(),
    command: text("command").notNull(),
    returncode: integer("returncode").notNull(),
    durationMs: integer("duration_ms"),
    stdoutExcerpt: text("stdout_excerpt"),
    stderrExcerpt: text("stderr_excerpt"),
    stdoutArtifactPath: text("stdout_artifact_path"),
    stderrArtifactPath: text("stderr_artifact_path"),
  },
  (table) => ({
    runTimestampIdx: index("run_commands_run_timestamp_idx").on(table.runId, table.timestamp),
  }),
);

export const runTasks = sqliteTable(
  "run_tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    cycle: integer("cycle").notNull().default(0),
    status: text("status").notNull(),
    modelName: text("model_name"),
    profileName: text("profile_name"),
    strategy: text("strategy"),
    summary: text("summary"),
    outputJson: text("output_json", { mode: "json" }).$type<Record<string, unknown> | null>(),
    artifactsPath: text("artifacts_path"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    estimatedCostUsd: text("estimated_cost_usd"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (table) => ({
    runRoleCycleIdx: index("run_tasks_run_role_cycle_idx").on(table.runId, table.role, table.cycle),
    runStartedIdx: index("run_tasks_run_started_idx").on(table.runId, table.startedAt),
  }),
);

export const runMessages = sqliteTable(
  "run_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull().defaultNow(),
    sequence: integer("sequence").notNull(),
    role: text("role").notNull(),
    kind: text("kind").notNull(),
    contentExcerpt: text("content_excerpt").notNull(),
  },
  (table) => ({
    runSequenceIdx: index("run_messages_run_sequence_idx").on(table.runId, table.sequence),
  }),
);

export const workers = sqliteTable(
  "workers",
  {
    id: text("id").primaryKey(),
    hostname: text("hostname").notNull(),
    pid: integer("pid").notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
    lastHeartbeatAt: integer("last_heartbeat_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
    status: text("status").notNull(),
    activity: text("activity").notNull(),
    currentRunId: text("current_run_id").references(() => runs.id, { onDelete: "set null" }),
    currentTicketKey: text("current_ticket_key"),
    currentStep: integer("current_step"),
    lastError: text("last_error"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  },
  (table) => ({
    lastHeartbeatIdx: index("workers_last_heartbeat_idx").on(table.lastHeartbeatAt),
  }),
);

export const locks = sqliteTable(
  "locks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    resourceType: text("resource_type").notNull(),
    resourceKey: text("resource_key").notNull(),
    ownerRunId: text("owner_run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    resourceIdx: index("locks_resource_idx").on(table.resourceType, table.resourceKey),
    resourceUnique: uniqueIndex("locks_resource_unique").on(table.resourceType, table.resourceKey),
  }),
);

export type RepositoryRow = typeof repositories.$inferSelect;
export type InferenceServerRow = typeof inferenceServers.$inferSelect;
export type RepoRuleRow = typeof repoRules.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type RunEventRow = typeof runEvents.$inferSelect;
export type RunLogRow = typeof runLogs.$inferSelect;
export type RunCommandRow = typeof runCommands.$inferSelect;
export type RunTaskRow = typeof runTasks.$inferSelect;
export type RunMessageRow = typeof runMessages.$inferSelect;
export type WorkerRow = typeof workers.$inferSelect;
