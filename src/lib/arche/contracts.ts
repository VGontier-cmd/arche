import { z } from "zod";

export const repositoryCreateSchema = z.object({
  name: z.string().min(1),
  gitProvider: z.string().default("gitlab"),
  remoteUrl: z.string().url(),
  localMirrorPath: z.string().min(1),
  defaultBranch: z.string().default("main"),
  enabled: z.boolean().default(true),
  gitlabProjectId: z.string().optional().nullable(),
  allowedCommands: z.array(z.string()).default([]),
  validationCommands: z.array(z.string()).default([]),
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
});

export const jiraWebhookSchema = z.object({
  issue: z.unknown().optional(),
  issue_key: z.string().optional(),
});

export const runHumanResponseSchema = z.object({
  message: z.string().min(1),
});

export type ManualRunRequest = z.infer<typeof manualRunRequestSchema>;

export type RepositoryCreateInput = z.infer<typeof repositoryCreateSchema>;
export type RepoRuleCreateInput = z.infer<typeof repoRuleCreateSchema>;
export type RunHumanResponseInput = z.infer<typeof runHumanResponseSchema>;
