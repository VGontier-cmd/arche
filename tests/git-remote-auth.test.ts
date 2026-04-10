import { describe, expect, it } from "vitest";

import { resolveAuthenticatedRemoteUrlWithContext } from "../src/lib/arche/git-remote-auth.js";

describe("resolveAuthenticatedRemoteUrlWithContext", () => {
  it("leaves ssh URLs unchanged", () => {
    const url = "git@gitlab.com:acme/app.git";
    expect(
      resolveAuthenticatedRemoteUrlWithContext(url, {
        gitlabBaseUrl: "https://gitlab.com",
        gitlabToken: "glpat-xx",
        githubToken: null,
      }),
    ).toBe(url);
  });

  it("leaves https URLs that already embed credentials", () => {
    const url = "https://user:pass@gitlab.com/acme/app.git";
    expect(
      resolveAuthenticatedRemoteUrlWithContext(url, {
        gitlabBaseUrl: "https://gitlab.com",
        gitlabToken: "glpat-xx",
        githubToken: null,
      }),
    ).toBe(url);
  });

  it("injects GitLab oauth2 PAT when host matches USER_GITLAB_BASE_URL", () => {
    const out = resolveAuthenticatedRemoteUrlWithContext(
      "https://gitlab.com/acme/app.git",
      {
        gitlabBaseUrl: "https://gitlab.com",
        gitlabToken: "glpat-secret",
        githubToken: null,
      },
    );
    const u = new URL(out);
    expect(u.username).toBe("oauth2");
    expect(u.password).toBe("glpat-secret");
    expect(u.hostname).toBe("gitlab.com");
    expect(u.pathname).toBe("/acme/app.git");
  });

  it("does not inject GitLab token when host differs", () => {
    const url = "https://other.com/acme/app.git";
    expect(
      resolveAuthenticatedRemoteUrlWithContext(url, {
        gitlabBaseUrl: "https://gitlab.com",
        gitlabToken: "glpat-xx",
        githubToken: null,
      }),
    ).toBe(url);
  });

  it("injects GitHub token for github.com", () => {
    const out = resolveAuthenticatedRemoteUrlWithContext("https://github.com/acme/app.git", {
      gitlabBaseUrl: undefined,
      gitlabToken: null,
      githubToken: "ghp_github_pat",
    });
    const u = new URL(out);
    expect(u.username).toBe("x-access-token");
    expect(u.password).toBe("ghp_github_pat");
  });
});
