import { env, readSecretEnv } from "../env";

export type GitRemoteAuthContext = {
  gitlabBaseUrl: string | undefined;
  gitlabToken: string | null;
  githubToken: string | null;
};

/** Reads Git HTTPS auth from process env (and parsed Arche env). */
export function readGitRemoteAuthContext(): GitRemoteAuthContext {
  return {
    gitlabBaseUrl: env.USER_GITLAB_BASE_URL,
    gitlabToken: readSecretEnv("USER_GITLAB_TOKEN"),
    githubToken: readSecretEnv("USER_GITHUB_TOKEN"),
  };
}

/**
 * Builds an HTTPS remote URL with embedded credentials when env is configured.
 * - GitLab: same host/port as `USER_GITLAB_BASE_URL`, username `oauth2`, password = PAT
 *   (see GitLab HTTPS clone docs).
 * - GitHub.com: optional `USER_GITHUB_TOKEN`, username `x-access-token`
 *
 * SSH remotes, URLs that already carry userinfo, or HTTP(S) without matching token
 * are returned unchanged. The canonical (tokenless) URL stays in the DB; only local
 * Git operations use the resolved URL (see `GitManager.ensureLocalClone`).
 */
export function resolveAuthenticatedRemoteUrl(remoteUrl: string): string {
  return resolveAuthenticatedRemoteUrlWithContext(remoteUrl, readGitRemoteAuthContext());
}

export function resolveAuthenticatedRemoteUrlWithContext(
  remoteUrl: string,
  ctx: GitRemoteAuthContext,
): string {
  const proto = protocolOf(remoteUrl);
  if (proto !== "http" && proto !== "https") {
    return remoteUrl;
  }

  let parsed: URL;
  try {
    parsed = new URL(remoteUrl);
  } catch {
    return remoteUrl;
  }

  if (parsed.username || parsed.password) {
    return remoteUrl;
  }

  const glUrl = gitLabAuthenticatedUrl(parsed, ctx);
  if (glUrl) {
    return glUrl;
  }

  const ghUrl = gitHubAuthenticatedUrl(parsed, ctx);
  if (ghUrl) {
    return ghUrl;
  }

  return remoteUrl;
}

function protocolOf(remoteUrl: string): string | null {
  const idx = remoteUrl.indexOf("://");
  if (idx === -1) {
    return null;
  }
  return remoteUrl.slice(0, idx).toLowerCase();
}

function defaultPort(protocol: string): string {
  if (protocol === "https:") {
    return "443";
  }
  if (protocol === "http:") {
    return "80";
  }
  return "";
}

function originKey(url: URL): string {
  const port = url.port || defaultPort(url.protocol);
  return `${url.protocol}//${url.hostname.toLowerCase()}:${port}`;
}

function gitLabAuthenticatedUrl(parsed: URL, ctx: GitRemoteAuthContext): string | null {
  const { gitlabBaseUrl, gitlabToken } = ctx;
  if (!gitlabBaseUrl || !gitlabToken) {
    return null;
  }
  let base: URL;
  try {
    base = new URL(gitlabBaseUrl);
  } catch {
    return null;
  }
  if (originKey(parsed) !== originKey(base)) {
    return null;
  }
  return injectBasicAuth(parsed, "oauth2", gitlabToken);
}

function gitHubAuthenticatedUrl(parsed: URL, ctx: GitRemoteAuthContext): string | null {
  const { githubToken } = ctx;
  if (!githubToken) {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") {
    return null;
  }
  return injectBasicAuth(parsed, "x-access-token", githubToken);
}

function injectBasicAuth(parsed: URL, username: string, password: string): string {
  const next = new URL(parsed.href);
  next.username = username;
  next.password = password;
  return next.toString();
}
