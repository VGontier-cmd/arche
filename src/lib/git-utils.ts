/**
 * Infers the Git provider from a remote URL.
 * Defaults to "gitlab" for self-hosted instances.
 */
export function inferProvider(remoteUrl: string): "github" | "gitlab" {
  return remoteUrl.includes("github.com") ? "github" : "gitlab";
}

/**
 * Derives a short repo name from a remote URL.
 * e.g. https://github.com/org/my-service.git → "my-service"
 */
export function inferRepoName(remoteUrl: string): string {
  const cleaned = remoteUrl.replace(/\.git$/, "");
  const parts = cleaned.split(/[:/]/).filter(Boolean);
  return parts.at(-1) ?? "my-repo";
}
