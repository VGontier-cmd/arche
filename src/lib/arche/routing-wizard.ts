import * as p from "@clack/prompts";
import { resolve } from "node:path";

import { ensureArcheReady } from "../bootstrap";
import { getConfig } from "../config";
import { inferProvider } from "../git-utils";

import { createRepository, createRepoRule } from "./runs";

function guardPrompt<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  return value;
}

function validateRequired(value: string | undefined) {
  if (!value?.trim()) {
    return "Required";
  }
}

function validateRemoteUrl(value: string | undefined) {
  if (!value?.trim()) {
    return "Required";
  }
  const v = value.trim();
  if (v.startsWith("git@") || v.startsWith("ssh://")) {
    return;
  }
  try {
    const parsed = new URL(v);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "Use https://, http://, git@host:..., or ssh://...";
    }
  } catch {
    return "Invalid remote URL";
  }
}

async function promptRepositoryFields(
  config: Awaited<ReturnType<typeof getConfig>>,
) {
  const name = guardPrompt(
    await p.text({
      message: "Repository short name",
      placeholder: "my-service",
      validate: validateRequired,
    }),
  ).trim();

  const remoteUrl = guardPrompt(
    await p.text({
      message: "Git remote URL",
      placeholder: "https://gitlab.com/acme/my-service.git",
      validate: validateRemoteUrl,
    }),
  ).trim();

  const defaultMirror = resolve(config.runtime.repos_dir, name);
  const localMirrorPath = guardPrompt(
    await p.text({
      message: "Local mirror directory (bare/full clone path on this machine)",
      initialValue: defaultMirror,
      validate: validateRequired,
    }),
  ).trim();

  const defaultBranch = guardPrompt(
    await p.text({
      message: "Default branch",
      initialValue: "main",
      validate: validateRequired,
    }),
  ).trim();

  const gitProvider = inferProvider(remoteUrl);

  const addGitlabId = gitProvider === "gitlab" && guardPrompt(
    await p.confirm({
      message: "Set GitLab project ID now? (needed for merge requests via API)",
      initialValue: false,
    }),
  );

  let gitlabProjectId: string | null = null;
  if (addGitlabId) {
    gitlabProjectId = guardPrompt(
      await p.text({
        message: "GitLab project ID (numeric)",
        validate: validateRequired,
      }),
    ).trim();
  }

  return {
    name,
    gitProvider,
    remoteUrl,
    localMirrorPath: resolve(localMirrorPath),
    defaultBranch,
    enabled: true,
    gitlabProjectId,
    allowedCommands: [] as string[],
    validationCommands: [] as string[],
    instructions: null,
    enabledTools: null,
  };
}

async function promptRepoRuleFields(
  config: Awaited<ReturnType<typeof getConfig>>,
  repositoryName: string,
) {
  const ruleName = guardPrompt(
    await p.text({
      message: "Rule name (internal label)",
      placeholder: `${repositoryName}-default`,
      initialValue: `${repositoryName}-jira`,
      validate: validateRequired,
    }),
  ).trim();

  const jiraProjectKey = guardPrompt(
    await p.text({
      message: "Jira project key (optional, e.g. PROJ)",
      placeholder: "leave empty for any project",
    }),
  ).trim();

  const label = guardPrompt(
    await p.text({
      message: "Required Jira label (optional)",
      placeholder: config.policy.required_label,
      initialValue: config.policy.required_label,
    }),
  ).trim();

  const issueType = guardPrompt(
    await p.text({
      message: "Jira issue type (optional)",
      placeholder: config.policy.allowed_issue_types[0] ?? "Bug",
      initialValue: config.policy.allowed_issue_types[0] ?? "",
    }),
  ).trim();

  const priorityRaw = guardPrompt(
    await p.text({
      message: "Priority (lower runs first when multiple rules match)",
      initialValue: "100",
      validate: (v) => {
        if (!v?.trim()) {
          return "Required";
        }
        if (!Number.isFinite(Number(v))) {
          return "Must be a number";
        }
      },
    }),
  ).trim();

  return {
    name: ruleName,
    repositoryName,
    jiraProjectKey: jiraProjectKey.length > 0 ? jiraProjectKey : null,
    label: label.length > 0 ? label : null,
    issueType: issueType.length > 0 ? issueType : null,
    priority: Number(priorityRaw),
    enabled: true,
  };
}

/**
 * Interactive flow: register a Git repository, then optionally add a Jira → repo routing rule
 * (same data as `repositories add` + `repo-rules add`).
 */
export async function runSetupWizard() {
  await ensureArcheReady();
  const config = await getConfig();

  p.intro("Repository & routing setup");

  p.note(
    [
      "This registers a repository in Arche, then can add a routing rule for Jira.",
      "Use a clean HTTPS URL in the DB; Git auth can use tokens from .arche/environment.",
      `Policy hints from orchestrator.yml: label “${config.policy.required_label}”, type(s) ${config.policy.allowed_issue_types.join(", ")}.`,
      "Leave rule fields empty where you want a wildcard (where policy allows).",
    ].join("\n"),
    "Overview",
  );

  const repoFields = await promptRepositoryFields(config);
  const repository = await createRepository(repoFields);

  p.log.success(`Repository registered: ${repository.name} (${repository.id})`);

  const addRule = guardPrompt(
    await p.confirm({
      message: "Add a Jira → repository routing rule for this repository now?",
      initialValue: true,
    }),
  );

  let rule: Awaited<ReturnType<typeof createRepoRule>> | null = null;
  if (addRule) {
    const ruleFields = await promptRepoRuleFields(config, repository.name);
    rule = await createRepoRule(ruleFields);
    p.log.success(`Repo rule created: ${rule.name}`);
  }

  if (rule) {
    p.outro(`Done. Repository ${repository.name} and rule ${rule.name} are ready.`);
  } else {
    p.outro(
      `Repository ${repository.name} is ready. Add a rule later: arche repo-rules add …`,
    );
  }

  return { repository, rule };
}
