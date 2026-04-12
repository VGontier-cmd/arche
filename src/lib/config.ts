import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";

import { env } from "./env";

const defaultRuntimeRoot = env.ARCHE_RUNTIME_ROOT;
const defaultRuntimeConfig = {
  root_dir: defaultRuntimeRoot,
  repos_dir: `${defaultRuntimeRoot}/repos`,
  runs_dir: `${defaultRuntimeRoot}/runs`,
  logs_dir: `${defaultRuntimeRoot}/logs`,
  db_retention_days: 30,
  artifact_retention_days: 14,
  failed_worktree_retention_days: 3,
};

const defaultSandboxConfig = {
  image: "arche-app:local",
  network: "bridge",
  shell: "/bin/bash",
  read_only_rootfs: true,
  tmpfs_paths: ["/tmp"],
  cap_drop: ["ALL"],
  no_new_privileges: true,
  pids_limit: 256,
  memory_limit_mb: 2048,
  cpus: "2",
  env_allowlist: [],
  user: "",
};

const defaultWorkflowConfig = {
  mode: "plan_execute_review",
  max_review_cycles: 3,
  require_plan_approval: true,
  require_publish_approval: true,
} as const;

const defaultRoutingConfig = {
  default_repository: null,
} as const;

const defaultGitConfig = {
  branch_prefix: "arche/",
} as const;

const defaultExecutorProfile = {
  driver: "openai_compatible_api",
  base_url: "https://openrouter.ai/api/v1",
  model: "openai/gpt-5.4-mini",
  api_key_env: "USER_OPENROUTER_API_KEY",
  timeout_seconds: 60,
  max_actions: 8,
  temperature: 0.1,
} as const;

const defaultExecutorsConfig = {
  defaults: {
    planner: "default",
    executor: "default",
    reviewer: "default",
  },
  profiles: {
    default: defaultExecutorProfile,
  },
} as const;

const executorProfileSchema = z.object({
  driver: z.literal("openai_compatible_api").default(defaultExecutorProfile.driver),
  base_url: z.string().url().default(defaultExecutorProfile.base_url),
  model: z.string().min(1).default(defaultExecutorProfile.model),
  api_key_env: z.string().min(1).default(defaultExecutorProfile.api_key_env),
  timeout_seconds: z.number().int().positive().default(defaultExecutorProfile.timeout_seconds),
  max_actions: z.number().int().positive().default(defaultExecutorProfile.max_actions),
  temperature: z.number().min(0).max(2).default(defaultExecutorProfile.temperature),
});

const executorsConfigSchema = z
  .object({
    defaults: z
      .object({
        planner: z.string().min(1).default(defaultExecutorsConfig.defaults.planner),
        executor: z.string().min(1).default(defaultExecutorsConfig.defaults.executor),
        reviewer: z.string().min(1).default(defaultExecutorsConfig.defaults.reviewer),
      })
      .default(defaultExecutorsConfig.defaults),
    profiles: z.record(z.string().min(1), executorProfileSchema).default(defaultExecutorsConfig.profiles),
  })
  .superRefine((value, context) => {
    for (const role of ["planner", "executor", "reviewer"] as const) {
      const profileName = value.defaults[role];
      if (!(profileName in value.profiles)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["defaults", role],
          message: `Unknown executor profile: ${profileName}`,
        });
      }
    }
  });

const orchestratorConfigSchema = z.object({
  runtime: z.object({
    root_dir: z.string().default(defaultRuntimeConfig.root_dir),
    repos_dir: z.string().default(defaultRuntimeConfig.repos_dir),
    runs_dir: z.string().default(defaultRuntimeConfig.runs_dir),
    logs_dir: z.string().default(defaultRuntimeConfig.logs_dir),
    db_retention_days: z.number().int().positive().default(defaultRuntimeConfig.db_retention_days),
    artifact_retention_days: z
      .number()
      .int()
      .positive()
      .default(defaultRuntimeConfig.artifact_retention_days),
    failed_worktree_retention_days: z
      .number()
      .int()
      .positive()
      .default(defaultRuntimeConfig.failed_worktree_retention_days),
  }),
  worker: z.object({
    poll_interval_seconds: z.number().int().positive().default(5),
    lease_ttl_seconds: z.number().int().positive().default(900),
    max_agent_steps: z.number().int().positive().default(8),
    max_run_seconds: z.number().int().positive().default(1200),
  }),
  policy: z.object({
    assignee: z.string().default("agent-dev"),
    required_status: z.string().default("In Progress"),
    required_label: z.string().default("agent-ready"),
    allowed_issue_types: z.array(z.string()).default(["Bug", "Task", "Chore"]),
    max_changed_files: z.number().int().positive().default(20),
    max_changed_lines: z.number().int().positive().default(500),
    description_min_length: z.number().int().positive().default(20),
  }),
  sandbox: z.object({
    image: z.string().default(defaultSandboxConfig.image),
    network: z.string().default(defaultSandboxConfig.network),
    shell: z.string().default(defaultSandboxConfig.shell),
    read_only_rootfs: z.boolean().default(defaultSandboxConfig.read_only_rootfs),
    tmpfs_paths: z.array(z.string()).default(defaultSandboxConfig.tmpfs_paths),
    cap_drop: z.array(z.string()).default(defaultSandboxConfig.cap_drop),
    no_new_privileges: z.boolean().default(defaultSandboxConfig.no_new_privileges),
    pids_limit: z.number().int().positive().default(defaultSandboxConfig.pids_limit),
    memory_limit_mb: z.number().int().positive().default(defaultSandboxConfig.memory_limit_mb),
    cpus: z.string().default(defaultSandboxConfig.cpus),
    env_allowlist: z.array(z.string()).default(defaultSandboxConfig.env_allowlist),
    user: z.string().default(defaultSandboxConfig.user),
  }),
  defaults: z.object({
    allowed_commands: z.array(z.string()).default([]),
    validation_commands: z.array(z.string()).default([]),
  }),
  routing: z
    .object({
      default_repository: z.string().min(1).nullable().default(defaultRoutingConfig.default_repository),
    })
    .default(defaultRoutingConfig),
  git: z
    .object({
      branch_prefix: z.string().default(defaultGitConfig.branch_prefix),
    })
    .default(defaultGitConfig),
  workflow: z
    .object({
      mode: z.literal("plan_execute_review").default(defaultWorkflowConfig.mode),
      max_review_cycles: z.number().int().positive().default(defaultWorkflowConfig.max_review_cycles),
      require_plan_approval: z.boolean().default(defaultWorkflowConfig.require_plan_approval),
      require_publish_approval: z.boolean().default(defaultWorkflowConfig.require_publish_approval),
    })
    .default(defaultWorkflowConfig),
  executors: executorsConfigSchema.default(defaultExecutorsConfig),
  bootstrap: z.object({
    repositories: z.array(z.record(z.string(), z.unknown())).default([]),
    repo_rules: z.array(z.record(z.string(), z.unknown())).default([]),
  }),
});

export type ExecutorProfileConfig = z.infer<typeof executorProfileSchema>;
export type ExecutorsConfig = z.infer<typeof executorsConfigSchema>;
export type OrchestratorConfig = z.infer<typeof orchestratorConfigSchema>;

export const defaultConfig: OrchestratorConfig = {
  runtime: defaultRuntimeConfig,
  worker: {
    poll_interval_seconds: 5,
    lease_ttl_seconds: 900,
    max_agent_steps: 8,
    max_run_seconds: 1200,
  },
  policy: {
    assignee: "agent-dev",
    required_status: "In Progress",
    required_label: "agent-ready",
    allowed_issue_types: ["Bug", "Task", "Chore"],
    max_changed_files: 20,
    max_changed_lines: 500,
    description_min_length: 20,
  },
  sandbox: {
    ...defaultSandboxConfig,
  },
  defaults: {
    allowed_commands: [],
    validation_commands: [],
  },
  routing: {
    ...defaultRoutingConfig,
  },
  git: {
    ...defaultGitConfig,
  },
  workflow: {
    ...defaultWorkflowConfig,
  },
  executors: {
    defaults: {
      ...defaultExecutorsConfig.defaults,
    },
    profiles: {
      default: {
        ...defaultExecutorProfile,
      },
    },
  },
  bootstrap: {
    repositories: [],
    repo_rules: [],
  },
};

let configPromise: Promise<OrchestratorConfig> | undefined;

async function loadConfig(): Promise<OrchestratorConfig> {
  let raw: string;
  try {
    raw = await readFile(env.ARCHE_CONFIG_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultConfig;
    }
    throw error;
  }

  return orchestratorConfigSchema.parse(parse(raw));
}

export async function getConfig(): Promise<OrchestratorConfig> {
  if (!configPromise) {
    configPromise = loadConfig();
    startConfigWatcher();
  }
  return configPromise;
}

let watcherStarted = false;
function startConfigWatcher() {
  if (watcherStarted) return;
  watcherStarted = true;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  import("node:fs").then(({ watch }) => {
    const watcher = watch(env.ARCHE_CONFIG_PATH, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        configPromise = loadConfig();
      }, 500).unref();
    });
    watcher.on("error", () => {
      // Silently ignore watch errors (file may not exist yet)
    });
    // Don't keep the process alive just for config watching
    watcher.unref();
  }).catch(() => {
    // fs.watch not available or file doesn't exist — skip hot-reload
  });
}
