import type { RepositoryRow } from "../db/schema";
import { env } from "../env";
import { ExternalServiceError } from "./errors";
import { withRetry } from "./retry";
import type { JiraIssue } from "./types";

function parseOwnerRepo(remoteUrl: string): { owner: string; repo: string } {
  // Handle SSH: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
  // Handle HTTPS: https://github.com/owner/repo.git
  const httpsMatch = remoteUrl.match(/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
  throw new ExternalServiceError(`Cannot parse owner/repo from remote URL: ${remoteUrl}`);
}

export class GitHubClient {
  get configured() {
    return Boolean(env.USER_GITHUB_TOKEN);
  }

  async createPullRequest(repository: RepositoryRow, branchName: string, issue: JiraIssue, summary: string) {
    if (!this.configured) {
      throw new ExternalServiceError("GitHub client is not configured (USER_GITHUB_TOKEN)");
    }
    const { owner, repo } = parseOwnerRepo(repository.remoteUrl);

    return withRetry(async () => {
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.USER_GITHUB_TOKEN}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            head: branchName,
            base: repository.defaultBranch,
            title: `${issue.key}: ${issue.title}`,
            body: summary,
          }),
        },
      );
      if (!response.ok) {
        throw new ExternalServiceError(
          `GitHub PR creation failed: ${response.status} ${await response.text()}`,
        );
      }
      const body = (await response.json()) as { html_url?: string };
      return body.html_url ?? "";
    });
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.configured) {
      return { ok: false, error: "GitHub client is not configured" };
    }
    try {
      const response = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${env.USER_GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
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
