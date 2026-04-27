import { sql } from "drizzle-orm";

import { db, withSqliteWriteRetry } from "./client";

export async function initSchema() {
  await withSqliteWriteRetry(() => db.run(sql`
    create table if not exists repositories (
      id text primary key,
      name text not null unique,
      git_provider text not null default 'gitlab',
      remote_url text not null,
      local_mirror_path text not null,
      default_branch text not null default 'main',
      enabled integer not null default 1,
      gitlab_project_id text,
      allowed_commands text not null default '[]',
      validation_commands text not null default '[]',
      created_at integer not null default (cast((julianday('now') - 2440587.5)*86400000 as integer)),
      updated_at integer not null default (cast((julianday('now') - 2440587.5)*86400000 as integer))
    );
  `));

  await withSqliteWriteRetry(() => db.run(sql`
    create table if not exists inference_servers (
      id text primary key,
      name text not null unique,
      provider_type text not null default 'openai_compatible',
      base_url text not null,
      api_key_ref text not null,
      default_model text not null,
      enabled integer not null default 1,
      options text not null default '{}',
      created_at integer not null default (cast((julianday('now') - 2440587.5)*86400000 as integer)),
      updated_at integer not null default (cast((julianday('now') - 2440587.5)*86400000 as integer))
    );
  `));

  await withSqliteWriteRetry(() => db.run(sql`
    create table if not exists repo_rules (
      id text primary key,
      name text not null,
      jira_project_key text,
      label text,
      issue_type text,
      priority integer not null default 100,
      enabled integer not null default 1,
      repository_id text not null references repositories(id) on delete cascade,
      created_at integer not null default (cast((julianday('now') - 2440587.5)*86400000 as integer)),
      updated_at integer not null default (cast((julianday('now') - 2440587.5)*86400000 as integer))
    );
  `));

  await withSqliteWriteRetry(() => db.run(sql`
    create table if not exists runs (
      id text primary key,
      source text not null default 'jira',
      status text not null default 'pending',
      ticket_key text not null,
      ticket_title text not null,
      ticket_project_key text,
      ticket_payload text not null default '{}',
      repo_name text,
      repository_id text references repositories(id) on delete set null,
      inference_server_id text references inference_servers(id) on delete set null,
      provider_type text,
      workflow_mode text not null default 'plan_execute_review',
      planner_profile text,
      executor_profile text,
      reviewer_profile text,
      planner_driver text,
      executor_driver text,
      reviewer_driver text,
      executor_type text not null default 'openai_compatible_api',
      model_name text,
      current_role text,
      current_cycle integer not null default 0,
      plan_markdown text,
      plan_risks text not null default '[]',
      plan_open_questions text not null default '[]',
      latest_review_summary text,
      latest_findings text not null default '[]',
      pending_question text,
      latest_human_response text,
      branch_name text,
      worktree_path text,
      worktree_retained integer not null default 0,
      sandbox_id text,
      mr_url text,
      summary text,
      failure_reason text,
      diff_excerpt text,
      artifacts_path text,
      command_history text not null default '[]',
      manual_override text not null default '{}',
      cancel_requested integer not null default 0,
      lease_owner text,
      lease_expires_at integer,
      started_at integer,
      finished_at integer,
      created_at integer not null default (cast((julianday('now') - 2440587.5)*86400000 as integer)),
      updated_at integer not null default (cast((julianday('now') - 2440587.5)*86400000 as integer))
    );
  `));

  await withSqliteWriteRetry(() => db.run(sql`
    create table if not exists run_events (
      id integer primary key autoincrement,
      run_id text not null references runs(id) on delete cascade,
      timestamp integer not null default (cast((julianday('now') - 2440587.5)*86400000 as integer)),
      type text not null,
      payload text not null default '{}'
    );
  `));

  await withSqliteWriteRetry(() => db.run(sql`
    create table if not exists run_logs (
      id integer primary key autoincrement,
      run_id text not null references runs(id) on delete cascade,
      timestamp integer not null default (cast((julianday('now') - 2440587.5)*86400000 as integer)),
      stream text not null,
      message text not null
    );
  `));

  await withSqliteWriteRetry(() => db.run(sql`
    create table if not exists run_commands (
      id integer primary key autoincrement,
      run_id text not null references runs(id) on delete cascade,
      timestamp integer not null default (cast((julianday('now') - 2440587.5)*86400000 as integer)),
      phase text not null,
      command text not null,
      returncode integer not null,
      duration_ms integer,
      stdout_excerpt text,
      stderr_excerpt text,
      stdout_artifact_path text,
      stderr_artifact_path text
    );
  `));

  await withSqliteWriteRetry(() => db.run(sql`
    create table if not exists run_messages (
      id integer primary key autoincrement,
      run_id text not null references runs(id) on delete cascade,
      timestamp integer not null default (cast((julianday('now') - 2440587.5)*86400000 as integer)),
      sequence integer not null,
      role text not null,
      kind text not null,
      content_excerpt text not null
    );
  `));

  await withSqliteWriteRetry(() => db.run(sql`
    create table if not exists run_tasks (
      id integer primary key autoincrement,
      run_id text not null references runs(id) on delete cascade,
      role text not null,
      cycle integer not null default 0,
      status text not null,
      model_name text,
      profile_name text,
      strategy text,
      summary text,
      output_json text,
      artifacts_path text,
      started_at integer not null default (cast((julianday('now') - 2440587.5)*86400000 as integer)),
      finished_at integer
    );
  `));

  await withSqliteWriteRetry(() => db.run(sql`
    create table if not exists workers (
      id text primary key,
      hostname text not null,
      pid integer not null,
      started_at integer not null default (cast((julianday('now') - 2440587.5)*86400000 as integer)),
      last_heartbeat_at integer not null default (cast((julianday('now') - 2440587.5)*86400000 as integer)),
      status text not null,
      activity text not null,
      current_run_id text references runs(id) on delete set null,
      current_ticket_key text,
      current_step integer,
      last_error text,
      metadata text not null default '{}'
    );
  `));

  await withSqliteWriteRetry(() => db.run(sql`
    create table if not exists locks (
      id integer primary key autoincrement,
      resource_type text not null,
      resource_key text not null,
      owner_run_id text not null references runs(id) on delete cascade,
      expires_at integer not null
    );
  `));

  await withSqliteWriteRetry(() => db.run(sql`
    create table if not exists run_schedules (
      id text primary key,
      label text not null,
      ticket_key text not null,
      recurrence text not null default 'once',
      hour integer not null default 9,
      minute integer not null default 0,
      day_of_week integer,
      enabled integer not null default 1,
      next_run_at integer,
      last_run_at integer,
      last_run_id text references runs(id) on delete set null,
      created_at integer not null default (cast((julianday('now') - 2440587.5)*86400000 as integer)),
      updated_at integer not null default (cast((julianday('now') - 2440587.5)*86400000 as integer))
    );
  `));

  // Live SDK stream events emitted by the worker for the SSE endpoint to relay
  // to the dashboard. Worker and server run as separate processes so SQLite is
  // the IPC channel here. Rows are pruned by pruneRunHistory().
  await withSqliteWriteRetry(() => db.run(sql`
    create table if not exists agent_stream_events (
      id integer primary key autoincrement,
      run_id text not null references runs(id) on delete cascade,
      payload text not null,
      created_at integer not null default (cast((julianday('now') - 2440587.5)*86400000 as integer))
    );
  `));
  await withSqliteWriteRetry(() => db.run(sql`
    create index if not exists agent_stream_events_run_id_idx on agent_stream_events(run_id, id);
  `));

  await ensureColumn("runs", "worktree_retained", "alter table runs add column worktree_retained integer not null default 0");
  await ensureColumn("runs", "artifacts_path", "alter table runs add column artifacts_path text");
  await ensureColumn("runs", "worker_id", "alter table runs add column worker_id text");
  await ensureColumn("runs", "workflow_mode", "alter table runs add column workflow_mode text not null default 'plan_execute_review'");
  await ensureColumn("runs", "planner_profile", "alter table runs add column planner_profile text");
  await ensureColumn("runs", "executor_profile", "alter table runs add column executor_profile text");
  await ensureColumn("runs", "reviewer_profile", "alter table runs add column reviewer_profile text");
  await ensureColumn("runs", "planner_driver", "alter table runs add column planner_driver text");
  await ensureColumn("runs", "executor_driver", "alter table runs add column executor_driver text");
  await ensureColumn("runs", "reviewer_driver", "alter table runs add column reviewer_driver text");
  await ensureColumn("runs", "executor_type", "alter table runs add column executor_type text not null default 'openai_compatible_api'");
  await ensureColumn("runs", "current_role", "alter table runs add column current_role text");
  await ensureColumn("runs", "current_cycle", "alter table runs add column current_cycle integer not null default 0");
  await ensureColumn("runs", "plan_markdown", "alter table runs add column plan_markdown text");
  await ensureColumn("runs", "plan_risks", "alter table runs add column plan_risks text not null default '[]'");
  await ensureColumn("runs", "plan_open_questions", "alter table runs add column plan_open_questions text not null default '[]'");
  await ensureColumn("runs", "latest_review_summary", "alter table runs add column latest_review_summary text");
  await ensureColumn("runs", "latest_findings", "alter table runs add column latest_findings text not null default '[]'");
  await ensureColumn("runs", "pending_question", "alter table runs add column pending_question text");
  await ensureColumn("runs", "latest_human_response", "alter table runs add column latest_human_response text");
  await ensureColumn("run_tasks", "profile_name", "alter table run_tasks add column profile_name text");
  await ensureColumn("run_tasks", "strategy", "alter table run_tasks add column strategy text");

  // Cost tracking columns
  await ensureColumn("runs", "prompt_tokens", "alter table runs add column prompt_tokens integer");
  await ensureColumn("runs", "completion_tokens", "alter table runs add column completion_tokens integer");
  await ensureColumn("runs", "estimated_cost_usd", "alter table runs add column estimated_cost_usd text");
  await ensureColumn("runs", "archived_at", "alter table runs add column archived_at integer");
  await ensureColumn("run_tasks", "prompt_tokens", "alter table run_tasks add column prompt_tokens integer");
  await ensureColumn("run_tasks", "completion_tokens", "alter table run_tasks add column completion_tokens integer");
  await ensureColumn("run_tasks", "estimated_cost_usd", "alter table run_tasks add column estimated_cost_usd text");
  await ensureColumn("run_messages", "thinking_excerpt", "alter table run_messages add column thinking_excerpt text");
  await ensureColumn("repositories", "instructions", "alter table repositories add column instructions text");
  await ensureColumn("repositories", "enabled_tools", "alter table repositories add column enabled_tools text");
  await ensureColumn("runs", "plan_proposals", "alter table runs add column plan_proposals text");
  await ensureColumn("runs", "research_summary", "alter table runs add column research_summary text");

  await withSqliteWriteRetry(() => db.run(sql`create index if not exists runs_ticket_key_idx on runs(ticket_key);`));
  await withSqliteWriteRetry(() => db.run(sql`create index if not exists runs_status_idx on runs(status);`));
  await withSqliteWriteRetry(() =>
    db.run(sql`create index if not exists run_events_run_timestamp_idx on run_events(run_id, timestamp, id);`),
  );
  await withSqliteWriteRetry(() =>
    db.run(sql`create index if not exists run_logs_run_timestamp_idx on run_logs(run_id, timestamp, id);`),
  );
  await withSqliteWriteRetry(() =>
    db.run(sql`create index if not exists run_commands_run_timestamp_idx on run_commands(run_id, timestamp, id);`),
  );
  await withSqliteWriteRetry(() =>
    db.run(sql`create index if not exists run_messages_run_sequence_idx on run_messages(run_id, sequence, id);`),
  );
  await withSqliteWriteRetry(() =>
    db.run(sql`create index if not exists run_tasks_run_role_cycle_idx on run_tasks(run_id, role, cycle);`),
  );
  await withSqliteWriteRetry(() =>
    db.run(sql`create index if not exists run_tasks_run_started_idx on run_tasks(run_id, started_at);`),
  );
  await withSqliteWriteRetry(() =>
    db.run(sql`create index if not exists locks_resource_idx on locks(resource_type, resource_key);`),
  );
  await withSqliteWriteRetry(() =>
    db.run(sql`create unique index if not exists locks_resource_unique on locks(resource_type, resource_key);`),
  );
  await withSqliteWriteRetry(() =>
    db.run(sql`create index if not exists workers_last_heartbeat_idx on workers(last_heartbeat_at);`),
  );
  await withSqliteWriteRetry(() =>
    db.run(sql`create index if not exists run_schedules_next_run_idx on run_schedules(next_run_at, enabled);`),
  );
}

async function ensureColumn(tableName: string, columnName: string, statement: string) {
  try {
    await withSqliteWriteRetry(() => db.run(sql.raw(statement)));
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error && "cause" in error && error.cause instanceof Error
          ? error.cause.message
          : "";
    const causeMessage =
      error instanceof Error && "cause" in error && error.cause instanceof Error
        ? error.cause.message
        : "";
    if (
      message.includes(`duplicate column name: ${columnName}`) ||
      causeMessage.includes(`duplicate column name: ${columnName}`) ||
      message.includes(`no such table: ${tableName}`) ||
      causeMessage.includes(`no such table: ${tableName}`)
    ) {
      return;
    }
    throw error;
  }
}
