import { describe, expect, it } from "vitest";

import {
  defaultInstallEnvValues,
  preserveUnmanagedEnvValues,
  renderInstallEnvFile,
  resolveInstallEnvValues,
} from "../src/lib/install";

describe("resolveInstallEnvValues", () => {
  it("uses defaults and process overrides", () => {
    const values = resolveInstallEnvValues({
      processValues: {
        ARCHE_RUNTIME_ROOT: "/srv/arche",
      },
    });

    expect(values.ARCHE_RUNTIME_ROOT).toBe("/srv/arche");
    expect(values.DATABASE_URL).toBe("/srv/arche/arche.db");
    expect(values.ARCHE_CONFIG_PATH).toBe(defaultInstallEnvValues.ARCHE_CONFIG_PATH);
  });

  it("prefers existing database paths when already customized", () => {
    const values = resolveInstallEnvValues({
      existingValues: {
        DATABASE_URL: "/data/arche.sqlite",
        ARCHE_RUNTIME_ROOT: "/srv/arche",
      },
    });

    expect(values.DATABASE_URL).toBe("/srv/arche/arche.db");
  });
});

describe("preserveUnmanagedEnvValues", () => {
  it("keeps unrelated secrets", () => {
    const values = preserveUnmanagedEnvValues({
      exampleValues: {
        EXTRA_SERVICE_TOKEN: "change-me",
        DATABASE_URL: "./runtime/arche.db",
      },
    });

    expect(values).toEqual({
      EXTRA_SERVICE_TOKEN: "change-me",
    });
  });
});

describe("renderInstallEnvFile", () => {
  it("renders managed and preserved variables", () => {
    const output = renderInstallEnvFile(defaultInstallEnvValues, {
      EXTRA_SERVICE_TOKEN: "change-me",
    });

    expect(output).toContain("ARCHE_SERVER_HOST=127.0.0.1");
    expect(output).toContain('ARCHE_SERVER_AUTH_TOKEN=""');
    expect(output).toContain("ARCHE_GIT_AUTHOR_NAME=arche-bot");
    expect(output).toContain("ARCHE_GIT_AUTHOR_EMAIL=arche-bot@example.invalid");
    expect(output).toContain('ARCHE_JIRA_BASE_URL=""');
    expect(output).toContain('ARCHE_DEFAULT_API_KEY=""');
    expect(output).toContain("EXTRA_SERVICE_TOKEN=change-me");
  });
});
