import { z } from "zod";

export const reviewFindingSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  file: z.string().nullable().optional(),
});

export const plannerRoleOutputSchema = z
  .object({
    planMarkdown: z.string().min(1),
    risks: z.array(z.string()).default([]),
    openQuestions: z.array(z.string()).default([]),
    needsHumanInput: z.boolean(),
    question: z.string().nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.needsHumanInput && !value.question && value.openQuestions.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "planner question or openQuestions is required when needsHumanInput is true",
        path: ["question"],
      });
    }
  });

export const plannerSchemaHint = `{
  "planMarkdown": "string (required) — detailed step-by-step implementation plan in markdown",
  "risks": ["string — potential risk or concern"],
  "openQuestions": ["string — question that needs to be answered"],
  "needsHumanInput": false,
  "question": "string | null — a question for the human, required when needsHumanInput is true"
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

export const executorActionSchemaHint = `One of:
- {"action":"read_files","paths":["path/to/file.ts"]}
- {"action":"read_files","files":[{"path":"file.ts","offset":0,"limit":4096}]}
- {"action":"run_command","command":"npm test"}
- {"action":"write_file","path":"src/foo.ts","content":"full file content here"}
- {"action":"delete_file","path":"src/old-file.ts"}
- {"action":"finish","summary":"string (required)","implementedPlanDelta":"string (required)"}
- {"action":"needs_human_input","question":"string (required)"}`;
