import { env } from "../env";
import { JiraServiceError, NotFoundError } from "./errors";
import { withRetry } from "./retry";
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
      attachment?: Array<{
        filename?: string;
        content?: string;
        mimeType?: string;
      }>;
    };
  };
  const fields = issue.fields ?? {};
  const description =
    typeof fields.description === "string"
      ? fields.description
      : fields.description
        ? JSON.stringify(fields.description)
        : "";

  // Extract image attachments — these are forwarded to the planner as
  // multimodal input so screenshots from UI bug tickets are actually visible
  // to the model instead of being dropped on the floor.
  const attachmentImages = (fields.attachment ?? [])
    .filter((a): a is { filename: string; content: string; mimeType: string } =>
      typeof a?.filename === "string" &&
      typeof a?.content === "string" &&
      typeof a?.mimeType === "string" &&
      a.mimeType.startsWith("image/"),
    )
    .map((a) => ({ filename: a.filename, url: a.content, mimeType: a.mimeType }));

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
    attachmentImages: attachmentImages.length > 0 ? attachmentImages : undefined,
    raw: (rawIssue ?? {}) as Record<string, unknown>,
  };
}

export class JiraClient {
  get configured() {
    return Boolean(env.USER_JIRA_BASE_URL && env.USER_JIRA_EMAIL && env.USER_JIRA_API_TOKEN);
  }

  private get headers() {
    if (!this.configured) {
      throw new JiraServiceError("Jira client is not configured", "jira_not_configured");
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

  private get baseUrl() {
    return env.USER_JIRA_BASE_URL!.replace(/\/$/, "");
  }

  async fetchIssue(issueKey: string) {
    if (!this.configured) {
      throw new JiraServiceError("Jira client is not configured", "jira_not_configured");
    }

    return withRetry(async () => {
      const response = await fetch(
        `${this.baseUrl}/rest/api/3/issue/${issueKey}`,
        { headers: this.headers },
      );

      if (response.status === 404) {
        throw new NotFoundError(
          `Jira issue ${issueKey} not found (404). Site: ${this.baseUrl}. Check the key exists on this instance, USER_JIRA_BASE_URL matches that site, and the API user can browse the project.`,
        );
      }
      if (!response.ok) {
        throw new JiraServiceError(
          `Jira issue fetch failed: ${response.status} ${await response.text()}`,
          "jira_fetch_failed",
          { operation: "fetchIssue", ticketKey: issueKey },
        );
      }

      return normalizeIssue(await response.json());
    });
  }

  async commentIssue(issueKey: string, comment: string) {
    if (!this.configured) return;

    return withRetry(async () => {
      const response = await fetch(
        `${this.baseUrl}/rest/api/3/issue/${issueKey}/comment`,
        {
          method: "POST",
          headers: this.headers,
          body: JSON.stringify({ body: comment }),
        },
      );
      if (!response.ok) {
        throw new JiraServiceError(
          `Jira comment failed: ${response.status} ${await response.text()}`,
          "jira_comment_failed",
          { operation: "commentIssue", ticketKey: issueKey },
        );
      }
    });
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.configured) {
      return { ok: false, error: "Jira client is not configured" };
    }
    try {
      const response = await fetch(`${this.baseUrl}/rest/api/3/myself`, {
        headers: this.headers,
      });
      if (!response.ok) {
        return { ok: false, error: `HTTP ${response.status}` };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }
}
