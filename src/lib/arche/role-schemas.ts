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
