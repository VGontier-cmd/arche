import type { RepositoryRow } from "../db/schema";
import { env } from "../env";
import { GitLabServiceError } from "./errors";
import { withRetry } from "./retry";
import type { JiraIssue } from "./types";

export class GitLabClient {
  get configured() {
    return Boolean(env.USER_GITLAB_BASE_URL && env.USER_GITLAB_TOKEN);
  }

  private get baseUrl() {
    return env.USER_GITLAB_BASE_URL!.replace(/\/$/, "");
  }

  async createMergeRequest(repository: RepositoryRow, branchName: string, issue: JiraIssue, summary: string) {
    if (!this.configured) {
      throw new GitLabServiceError("GitLab client is not configured", "gitlab_not_configured");
    }
    const projectId = repository.gitlabProjectId ?? encodeURIComponent(repository.name);

    return withRetry(async () => {
      const response = await fetch(
        `${this.baseUrl}/api/v4/projects/${projectId}/merge_requests`,
        {
          method: "POST",
          headers: {
            "PRIVATE-TOKEN": env.USER_GITLAB_TOKEN!,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            source_branch: branchName,
            target_branch: repository.defaultBranch,
            title: `${issue.key}: ${issue.title}`,
            description: summary,
            remove_source_branch: false,
          }),
        },
      );
      if (!response.ok) {
        throw new GitLabServiceError(
          `GitLab MR creation failed: ${response.status} ${await response.text()}`,
          "gitlab_mr_failed",
          { operation: "createMergeRequest" },
        );
      }
      const body = (await response.json()) as { web_url?: string; url?: string };
      return body.web_url ?? body.url ?? "";
    });
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.configured) {
      return { ok: false, error: "GitLab client is not configured" };
    }
    try {
      const response = await fetch(`${this.baseUrl}/api/v4/user`, {
        headers: { "PRIVATE-TOKEN": env.USER_GITLAB_TOKEN! },
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
