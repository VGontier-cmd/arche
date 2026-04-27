import { z } from "zod";

export const reviewFindingSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  file: z.string().nullable().optional(),
});

export const planProposalSchema = z.object({
  approach: z.enum(["conservative", "balanced", "thorough"]),
  planMarkdown: z.string().min(1),
  risks: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  estimatedSteps: z.number().int().positive().default(5),
});

export type PlanProposal = z.infer<typeof planProposalSchema>;

// Accept legacy flat planner outputs ({planMarkdown, risks, openQuestions, ...})
// and lift them into a single-proposal `proposals[]` so older models, fixtures,
// and stored DB rows keep working with the new schema.
const liftLegacyPlannerOutput = (raw: unknown): unknown => {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.proposals)) return obj;
  if (typeof obj.planMarkdown !== "string") return obj;
  return {
    ...obj,
    proposals: [
      {
        approach: "balanced" as const,
        planMarkdown: obj.planMarkdown,
        risks: Array.isArray(obj.risks) ? obj.risks : [],
        openQuestions: Array.isArray(obj.openQuestions) ? obj.openQuestions : [],
        estimatedSteps:
          typeof obj.estimatedSteps === "number" && obj.estimatedSteps > 0 ? obj.estimatedSteps : 5,
      },
    ],
  };
};

export const plannerRoleOutputSchema = z
  .preprocess(
    liftLegacyPlannerOutput,
    z.object({
      proposals: z.array(planProposalSchema).min(1).max(3),
      needsHumanInput: z.boolean(),
      question: z.string().nullable().optional(),
    }),
  )
  .superRefine((value, context) => {
    if (value.needsHumanInput && !value.question) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "planner question is required when needsHumanInput is true",
        path: ["question"],
      });
    }
  });

export const plannerSchemaHint = `{
  "proposals": [
    {
      "approach": "conservative",
      "planMarkdown": "string — minimal-change plan",
      "risks": ["string"],
      "openQuestions": ["string"],
      "estimatedSteps": 5
    },
    {
      "approach": "balanced",
      "planMarkdown": "string — complete implementation plan",
      "risks": ["string"],
      "openQuestions": ["string"],
      "estimatedSteps": 10
    },
    {
      "approach": "thorough",
      "planMarkdown": "string — comprehensive plan including tests and edge cases",
      "risks": ["string"],
      "openQuestions": ["string"],
      "estimatedSteps": 15
    }
  ],
  "needsHumanInput": false,
  "question": "string | null — required when needsHumanInput is true"
}`;

export const executorRoleOutputSchema = z
  .object({
    summary: z.string().min(1),
    implementedPlanDelta: z.string().min(1),
    needsHumanInput: z.boolean(),
    question: z.string().nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.needsHumanInput && !value.question) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "executor question is required when needsHumanInput is true",
        path: ["question"],
      });
    }
  });

export const reviewerRoleOutputSchema = z
  .object({
    decision: z.enum(["approve", "request_changes", "needs_human_input"]),
    summary: z.string().min(1),
    findings: z.array(reviewFindingSchema).default([]),
    question: z.string().nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.decision === "request_changes" && value.findings.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "reviewer findings are required when requesting changes",
        path: ["findings"],
      });
    }
    if (value.decision === "needs_human_input" && !value.question) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "reviewer question is required when human input is needed",
        path: ["question"],
      });
    }
  });

export const reviewerSchemaHint = `{
  "decision": "approve | request_changes | needs_human_input",
  "summary": "string (required) — review summary",
  "findings": [{"title": "string", "body": "string", "file": "string | null"}],
  "question": "string | null — required when decision is needs_human_input"
}`;

export const researcherRoleOutputSchema = z.object({
  summary: z.string().min(1).describe("Overview of the codebase relevant to this ticket"),
  relevantFiles: z.array(z.string()).default([]).describe("File paths likely impacted"),
  architectureNotes: z.string().default("").describe("Patterns, conventions, key constraints detected"),
  externalDeps: z.array(z.string()).default([]).describe("External dependencies or APIs to be aware of"),
  potentialRisks: z.array(z.string()).default([]).describe("Risks identified before implementation"),
});

export type ResearcherRoleOutput = z.infer<typeof researcherRoleOutputSchema>;

export const researcherSchemaHint = `{
  "summary": "string — what's relevant in this codebase for this ticket",
  "relevantFiles": ["path/to/file.ts"],
  "architectureNotes": "string — patterns, conventions, constraints",
  "externalDeps": ["string — lib or API to be aware of"],
  "potentialRisks": ["string — risk before implementation"]
}`;

export const executorActionSchemaHint = `One of:
- {"action":"read_files","paths":["path/to/file.ts"]}
- {"action":"read_files","files":[{"path":"file.ts","offset":0,"limit":4096}]}
- {"action":"run_command","command":"npm test"}
- {"action":"write_file","path":"src/foo.ts","content":"full file content here"}
- {"action":"delete_file","path":"src/old-file.ts"}
- {"action":"finish","summary":"string (required)","implementedPlanDelta":"string (required)"}
- {"action":"needs_human_input","question":"string (required)"}`;
