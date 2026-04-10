import { env } from "../env";
import { ExternalServiceError, NotFoundError } from "./errors";
import type { JiraIssue } from "./types";

export function normalizeIssue(rawIssue: unknown): JiraIssue {
  const issue = rawIssue as {
    key: string;
    fields?: {
      summary?: string;
      description?: unknown;
      status?: { name?: string };
      issuetype?: { name?: string };
      labels?: string[];
      assignee?: { displayName?: string; name?: string; emailAddress?: string };
      project?: { key?: string };
    };
  };
  const fields = issue.fields ?? {};
  const description =
    typeof fields.description === "string"
      ? fields.description
      : fields.description
        ? JSON.stringify(fields.description)
        : "";

  return {
    key: issue.key,
    title: fields.summary ?? issue.key,
    description,
    status: fields.status?.name ?? null,
    issueType: fields.issuetype?.name ?? null,
    labels: fields.labels ?? [],
    assignee:
      fields.assignee?.displayName ??
      fields.assignee?.name ??
      fields.assignee?.emailAddress ??
      null,
    projectKey: fields.project?.key ?? null,
    raw: (rawIssue ?? {}) as Record<string, unknown>,
  };
}

export class JiraClient {
  get configured() {
    return Boolean(env.USER_JIRA_BASE_URL && env.USER_JIRA_EMAIL && env.USER_JIRA_API_TOKEN);
  }

  private get headers() {
    if (!this.configured) {
      throw new ExternalServiceError("Jira client is not configured");
    }
    const token = Buffer.from(
      `${env.USER_JIRA_EMAIL}:${env.USER_JIRA_API_TOKEN}`,
      "utf8",
    ).toString("base64");
    return {
      Authorization: `Basic ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
  }

  async fetchIssue(issueKey: string) {
    if (!this.configured) {
      throw new ExternalServiceError("Jira client is not configured");
    }

    const response = await fetch(
      `${env.USER_JIRA_BASE_URL!.replace(/\/$/, "")}/rest/api/3/issue/${issueKey}`,
      {
        headers: this.headers,
      },
    );

    if (response.status === 404) {
      const site = env.USER_JIRA_BASE_URL!.replace(/\/$/, "");
      throw new NotFoundError(
        `Jira issue ${issueKey} not found (404). Site: ${site}. Check the key exists on this instance, USER_JIRA_BASE_URL matches that site, and the API user can browse the project.`,
      );
    }
    if (!response.ok) {
      throw new ExternalServiceError(`Jira issue fetch failed: ${response.status} ${await response.text()}`);
    }

    return normalizeIssue(await response.json());
  }

  async commentIssue(issueKey: string, comment: string) {
    if (!this.configured) return;
    const response = await fetch(
      `${env.USER_JIRA_BASE_URL!.replace(/\/$/, "")}/rest/api/3/issue/${issueKey}/comment`,
      {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ body: comment }),
      },
    );
    if (!response.ok) {
      throw new ExternalServiceError(`Jira comment failed: ${response.status} ${await response.text()}`);
    }
  }
}
