import { describe, expect, it } from "vitest";

import { evaluateIssueEligibility } from "../src/lib/arche/policy";
import type { JiraIssue } from "../src/lib/arche/types";

const baseIssue: JiraIssue = {
  key: "PROJ-123",
  title: "Fix popup alignment",
  description: "Investigate popup overflow and ship a bounded fix.",
  status: "In Progress",
  issueType: "Bug",
  labels: ["agent-ready"],
  assignee: "agent-dev",
  projectKey: "PROJ",
  raw: {},
};

const basePolicy = {
  assignee: "agent-dev",
  required_status: "In Progress",
  required_label: "agent-ready",
  allowed_issue_types: ["Bug", "Task", "Chore"],
  max_changed_files: 20,
  max_changed_lines: 500,
  description_min_length: 20,
};

describe("evaluateIssueEligibility", () => {
  it("accepts an issue matching all constraints", () => {
    const result = evaluateIssueEligibility(baseIssue, basePolicy, {
      hasActiveRun: false,
      repoResolved: true,
    });

    expect(result).toEqual({ eligible: true, reasons: [] });
  });

  it("reports all blocking reasons", () => {
    const result = evaluateIssueEligibility(
      {
        ...baseIssue,
        description: "too short",
        labels: [],
        assignee: "someone-else",
        status: "Todo",
      },
      basePolicy,
      {
        hasActiveRun: true,
        repoResolved: false,
      },
    );

    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("Required label missing");
    expect(result.reasons).toContain("Issue assignee does not match configured agent");
    expect(result.reasons).toContain("Issue status is not eligible");
    expect(result.reasons).toContain("Issue description is too short");
    expect(result.reasons).toContain("No repository mapping matched the issue");
    expect(result.reasons).toContain("An active run already exists for this ticket");
  });
});
