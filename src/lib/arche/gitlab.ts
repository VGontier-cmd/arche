import type { RepositoryRow } from "../db/schema";
import { env } from "../env";
import { ExternalServiceError } from "./errors";
import type { JiraIssue } from "./types";

export class GitLabClient {
  get configured() {
    return Boolean(env.ARCHE_GITLAB_BASE_URL && env.ARCHE_GITLAB_TOKEN);
  }

  async createMergeRequest(repository: RepositoryRow, branchName: string, issue: JiraIssue, summary: string) {
    if (!this.configured) {
      throw new ExternalServiceError("GitLab client is not configured");
    }
    const projectId = repository.gitlabProjectId ?? encodeURIComponent(repository.name);
    const response = await fetch(
      `${env.ARCHE_GITLAB_BASE_URL!.replace(/\/$/, "")}/api/v4/projects/${projectId}/merge_requests`,
      {
        method: "POST",
        headers: {
          "PRIVATE-TOKEN": env.ARCHE_GITLAB_TOKEN!,
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
      throw new ExternalServiceError(
        `GitLab MR creation failed: ${response.status} ${await response.text()}`,
      );
    }
    const body = (await response.json()) as { web_url?: string; url?: string };
    return body.web_url ?? body.url ?? "";
  }
}
