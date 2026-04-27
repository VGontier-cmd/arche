export const RUN_STATES = [
  "pending",
  "planning",
  "awaiting_plan_approval",
  "executing",
  "reviewing",
  "needs_human_input",
  "awaiting_publish_approval",
  "publish_approved",
  "validating",
  "preparing_repo",
  "creating_sandbox",
  "running_agent",
  "validating_changes",
  "publishing",
  "pushed",
  "success",
  "failed",
  "cancelled",
  "publish_rejected",
] as const;

export type RunStatus = (typeof RUN_STATES)[number];

export const RUN_TASK_ROLES = ["planner", "executor", "reviewer"] as const;
export type RunTaskRole = (typeof RUN_TASK_ROLES)[number];

export const RUN_TASK_STATUSES = [
  "running",
  "completed",
  "failed",
  "needs_human_input",
] as const;
export type RunTaskStatus = (typeof RUN_TASK_STATUSES)[number];

export type JiraIssue = {
  key: string;
  title: string;
  description: string;
  status: string | null;
  issueType: string | null;
  labels: string[];
  assignee: string | null;
  projectKey: string | null;
  /** Image attachments (screenshots) usable for multimodal model input. */
  attachmentImages?: Array<{ filename: string; url: string; mimeType?: string }>;
  raw: Record<string, unknown>;
};

export type RunCommand = {
  timestamp: string;
  command: string;
  returncode: number;
  stdout?: string;
  stderr?: string;
  phase?: string;
  durationMs?: number;
};

export type ProviderReadFileRequest = {
  path: string;
  offset?: number;
  limit?: number;
};

export type ProviderAction =
  | {
      action: "read_files";
      paths?: string[];
      files?: ProviderReadFileRequest[];
      notes?: string;
    }
  | { action: "run_command"; command: string; notes?: string }
  | { action: "write_file"; path: string; content: string; notes?: string }
  | { action: "delete_file"; path: string; notes?: string }
  | { action: "apply_patch"; patch: string; notes?: string }
  | { action: "finish"; summary: string; implementedPlanDelta: string; notes?: string }
  | { action: "needs_human_input"; question: string; notes?: string };

export type RunTaskStrategy = "direct" | "patch_loop";

export type ReviewFinding = {
  title: string;
  body: string;
  file?: string | null;
};

export type PlanProposal = {
  approach: "conservative" | "balanced" | "thorough";
  planMarkdown: string;
  risks: string[];
  openQuestions: string[];
  estimatedSteps: number;
};

export type PlannerRoleOutput = {
  proposals?: PlanProposal[];
  needsHumanInput: boolean;
  question?: string | null;
  // Fields used by executor/reviewer (populated from selected proposal)
  planMarkdown?: string;
  risks: string[];
  openQuestions: string[];
};

export type ExecutorRoleOutput = {
  summary: string;
  implementedPlanDelta: string;
  needsHumanInput: boolean;
  question?: string | null;
};

export type ReviewerRoleOutput = {
  decision: "approve" | "request_changes" | "needs_human_input";
  summary: string;
  findings: ReviewFinding[];
  question?: string | null;
};

export type PolicyDecision = {
  eligible: boolean;
  reasons: string[];
};
