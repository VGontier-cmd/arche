import { z } from "zod";

// Accepts HTTP(S) URLs, Git SSH (`git@host:org/repo.git`), `ssh://...`, or
// absolute local paths (`/path/to/repo`). The OS-level git binary handles all
// of these — we just sanity-check the shape so empty strings don't slip in.
const remoteUrlSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      const trimmed = value.trim();
      if (trimmed.length === 0) return false;
      // HTTP/HTTPS/SSH URLs that the URL constructor parses.
      try {
        new URL(trimmed);
        return true;
      } catch {
        // Not a standard URL — accept Git SSH form and absolute local paths.
        return /^[\w.-]+@[\w.-]+:.+/.test(trimmed) || /^\//.test(trimmed);
      }
    },
    { message: "Invalid remote URL — expected http(s)://, git@host:..., ssh://, or absolute local path" },
  );

export const repositoryCreateSchema = z.object({
  name: z.string().min(1),
  gitProvider: z.string().default("gitlab"),
  remoteUrl: remoteUrlSchema,
  localMirrorPath: z.string().min(1),
  defaultBranch: z.string().default("main"),
  enabled: z.boolean().default(true),
  gitlabProjectId: z.string().optional().nullable(),
  allowedCommands: z.array(z.string()).default([]),
  validationCommands: z.array(z.string()).default([]),
  instructions: z.string().optional().nullable(),
  enabledTools: z.array(z.string()).optional().nullable(),
});

export const repoRuleCreateSchema = z
  .object({
    name: z.string().min(1),
    repositoryId: z.string().optional(),
    repositoryName: z.string().optional(),
    jiraProjectKey: z.string().optional().nullable(),
    label: z.string().optional().nullable(),
    issueType: z.string().optional().nullable(),
    priority: z.number().int().default(100),
    enabled: z.boolean().default(true),
  })
  .refine((value) => Boolean(value.repositoryId || value.repositoryName), {
    path: ["repositoryId"],
    message: "repositoryId or repositoryName is required",
  });

export const manualRunRequestSchema = z.object({
  ticketKey: z.string().min(1),
  force: z.boolean().default(false),
  // Optional inline ticket metadata to bypass Jira lookup. When `inline.title`
  // is provided, the run is created from these fields directly without
  // contacting Jira — useful for local dev, demos, and internal flows where
  // Jira is not configured.
  inline: z
    .object({
      title: z.string().min(1),
      description: z.string().optional(),
      projectKey: z.string().nullable().optional(),
      labels: z.array(z.string()).optional(),
      issueType: z.string().nullable().optional(),
    })
    .optional(),
});

export const jiraWebhookSchema = z.object({
  issue: z.unknown().optional(),
  issue_key: z.string().optional(),
});

export const runHumanResponseSchema = z.object({
  message: z.string().min(1),
});

export const repositoryUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  gitProvider: z.string().optional(),
  remoteUrl: remoteUrlSchema.optional(),
  localMirrorPath: z.string().min(1).optional(),
  defaultBranch: z.string().optional(),
  enabled: z.boolean().optional(),
  gitlabProjectId: z.string().optional().nullable(),
  allowedCommands: z.array(z.string()).optional(),
  validationCommands: z.array(z.string()).optional(),
  instructions: z.string().optional().nullable(),
  enabledTools: z.array(z.string()).optional().nullable(),
});

export const repoRuleUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  repositoryId: z.string().optional(),
  repositoryName: z.string().optional(),
  jiraProjectKey: z.string().optional().nullable(),
  label: z.string().optional().nullable(),
  issueType: z.string().optional().nullable(),
  priority: z.number().int().optional(),
  enabled: z.boolean().optional(),
});

export const configUpdateSchema = z
  .object({
    workflow: z
      .object({
        mode: z.literal("plan_execute_review").optional(),
        require_plan_approval: z.boolean().optional(),
        require_publish_approval: z.boolean().optional(),
      })
      .optional(),
    policy: z
      .object({
        assignee: z.string().optional(),
        required_status: z.string().optional(),
        required_label: z.string().optional(),
        allowed_issue_types: z.array(z.string()).optional(),
        max_changed_files: z.number().int().positive().optional(),
        max_changed_lines: z.number().int().positive().optional(),
        description_min_length: z.number().int().positive().optional(),
      })
      .optional(),
    worker: z
      .object({
        poll_interval_seconds: z.number().int().positive().optional(),
        lease_ttl_seconds: z.number().int().positive().optional(),
        max_agent_steps: z.number().int().positive().optional(),
        max_run_seconds: z.number().int().positive().optional(),
        human_input_timeout_hours: z.number().positive().optional(),
      })
      .optional(),
    defaults: z
      .object({
        allowed_commands: z.array(z.string()).optional(),
        validation_commands: z.array(z.string()).optional(),
      })
      .optional(),
    routing: z
      .object({
        default_repository: z.string().min(1).nullable().optional(),
      })
      .optional(),
    git: z
      .object({
        branch_prefix: z.string().optional(),
      })
      .optional(),
    executors: z
      .object({
        defaults: z
          .object({
            planner: z.string().min(1).optional(),
            executor: z.string().min(1).optional(),
            reviewer: z.string().min(1).optional(),
          })
          .optional(),
        profiles: z
          .record(
            z.string().min(1),
            z.object({
              driver: z.literal("openai_compatible_api").optional(),
              base_url: z.string().url().optional(),
              model: z.string().min(1).optional(),
              api_key_env: z.string().min(1).optional(),
              timeout_seconds: z.number().int().positive().optional(),
              max_actions: z.number().int().positive().optional(),
              temperature: z.number().min(0).max(2).optional(),
              thinking_enabled: z.boolean().optional(),
              thinking_budget_tokens: z.number().int().positive().optional(),
            }),
          )
          .optional(),
      })
      .optional(),
  })
  .strict();

export const runScheduleCreateSchema = z.object({
  label: z.string().min(1),
  ticketKey: z.string().min(1),
  recurrence: z.enum(["once", "daily", "weekly"]).default("once"),
  hour: z.number().int().min(0).max(23).default(9),
  minute: z.number().int().min(0).max(59).default(0),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  enabled: z.boolean().default(true),
});

export const runScheduleUpdateSchema = runScheduleCreateSchema.partial();

export const setupCredentialsSchema = z
  .object({
    openRouterKey: z.string().min(1).optional(),
    githubToken: z.string().min(1).optional(),
    gitlabToken: z.string().min(1).optional(),
    gitlabBaseUrl: z.string().url().optional(),
    jiraBaseUrl: z.string().url().optional(),
    jiraEmail: z.string().email().optional(),
    jiraApiToken: z.string().min(1).optional(),
  })
  .strict();

export type SetupCredentialsInput = z.infer<typeof setupCredentialsSchema>;

export type ConfigUpdateInput = z.infer<typeof configUpdateSchema>;
export type RunScheduleCreateInput = z.infer<typeof runScheduleCreateSchema>;
export type RunScheduleUpdateInput = z.infer<typeof runScheduleUpdateSchema>;

export type ManualRunRequest = z.infer<typeof manualRunRequestSchema>;

export type RepositoryCreateInput = z.infer<typeof repositoryCreateSchema>;
export type RepositoryUpdateInput = z.infer<typeof repositoryUpdateSchema>;
export type RepoRuleCreateInput = z.infer<typeof repoRuleCreateSchema>;
export type RepoRuleUpdateInput = z.infer<typeof repoRuleUpdateSchema>;
export type RunHumanResponseInput = z.infer<typeof runHumanResponseSchema>;
