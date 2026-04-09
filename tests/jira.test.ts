import { describe, expect, it } from "vitest";

import { normalizeIssue } from "../src/lib/arche/jira";

describe("normalizeIssue", () => {
  it("extracts the Jira fields used by Arche", () => {
    const issue = normalizeIssue({
      key: "PROJ-123",
      fields: {
        summary: "Fix popup",
        description: "Detailed description",
        status: { name: "In Progress" },
        issuetype: { name: "Bug" },
        labels: ["agent-ready"],
        assignee: { displayName: "agent-dev" },
        project: { key: "PROJ" },
      },
    });

    expect(issue).toMatchObject({
      key: "PROJ-123",
      title: "Fix popup",
      description: "Detailed description",
      status: "In Progress",
      issueType: "Bug",
      labels: ["agent-ready"],
      assignee: "agent-dev",
      projectKey: "PROJ",
    });
  });
});
