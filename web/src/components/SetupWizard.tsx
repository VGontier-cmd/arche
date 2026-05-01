import { useCallback, useState } from "react";
import { Check, X } from "lucide-react";
import type { DashboardSnapshot, Repository } from "../types";
import {
  createRepository,
  createRepoRule,
  fetchRepositories,
  saveSetupCredentials,
  triggerManualRun,
} from "../api/client";
import { useToast } from "../context/ToastContext";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

type Step = "credentials" | "repository" | "rule" | "run";

// Slant figlet — same banner as the Header. Used here as the welcome hero.
const ARCHE_ASCII = `    ___    ____  ________  ________
   /   |  / __ \\/ ____/ / / / ____/
  / /| | / /_/ / /   / /_/ / __/
 / ___ |/ _, _/ /___/ __  / /___
/_/  |_/_/ |_|\\____/_/ /_/_____/`;

const STEPS: Array<{ key: Step; label: string; number: string }> = [
  { key: "credentials", label: "Check Setup", number: "1" },
  { key: "repository",  label: "Add Repository", number: "2" },
  { key: "rule",        label: "Add Rule", number: "3" },
  { key: "run",         label: "Test Run", number: "4" },
];

const selectStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--surface-0)",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius-sm)",
  color: "var(--c-fog-100)",
  padding: "6px 10px",
  fontSize: "var(--text-body-sm)",
  fontFamily: "inherit",
  outline: "none",
};

function CheckItem({ ok, label }: { ok: boolean; label: string }) {
  const Icon = ok ? Check : X;
  return (
    <div
      className="flex items-center"
      style={{
        gap: 8,
        fontSize: "var(--text-body-sm)",
        padding: "4px 0",
      }}
    >
      <Icon
        size={12}
        strokeWidth={2.5}
        aria-hidden="true"
        style={{ color: ok ? "var(--c-success-fg)" : "var(--c-error-fg)" }}
      />
      <span style={{ color: ok ? "var(--c-fog-100)" : "var(--c-fog-300)" }}>
        {label}
      </span>
    </div>
  );
}

export function SetupWizard({
  snapshot,
  onComplete,
  onRefresh,
}: {
  snapshot: DashboardSnapshot;
  onComplete: () => void;
  onRefresh?: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [currentStep, setCurrentStep] = useState<Step>("credentials");
  const [submitting, setSubmitting] = useState(false);

  const [credForm, setCredForm] = useState({
    openRouterKey: "",
    githubToken: "",
    gitlabToken: "",
    gitlabBaseUrl: "https://gitlab.com",
    jiraBaseUrl: "",
    jiraEmail: "",
    jiraApiToken: "",
  });
  const [showOptional, setShowOptional] = useState(false);

  const handleCredentialsSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      const payload: Record<string, string> = {};
      if (credForm.openRouterKey.trim()) payload.openRouterKey = credForm.openRouterKey.trim();
      if (credForm.githubToken.trim()) payload.githubToken = credForm.githubToken.trim();
      if (credForm.gitlabToken.trim()) {
        payload.gitlabToken = credForm.gitlabToken.trim();
        if (credForm.gitlabBaseUrl.trim())
          payload.gitlabBaseUrl = credForm.gitlabBaseUrl.trim();
      }
      if (
        credForm.jiraBaseUrl.trim() &&
        credForm.jiraEmail.trim() &&
        credForm.jiraApiToken.trim()
      ) {
        payload.jiraBaseUrl = credForm.jiraBaseUrl.trim();
        payload.jiraEmail = credForm.jiraEmail.trim();
        payload.jiraApiToken = credForm.jiraApiToken.trim();
      }
      if (Object.keys(payload).length === 0) {
        toast.error("Enter at least one credential");
        return;
      }
      await saveSetupCredentials(payload);
      toast.success("Credentials saved");
      setCredForm((f) => ({
        ...f,
        openRouterKey: "",
        githubToken: "",
        gitlabToken: "",
        jiraApiToken: "",
      }));
      if (onRefresh) await onRefresh();
    } catch (e) {
      toast.error("Failed: " + (e instanceof Error ? e.message : e));
    } finally {
      setSubmitting(false);
    }
  }, [credForm, toast, onRefresh]);

  const [repoForm, setRepoForm] = useState({
    name: "",
    remoteUrl: "",
    localMirrorPath: "",
    defaultBranch: "main",
    gitProvider: "gitlab",
    gitlabProjectId: "",
  });

  const [repos, setRepos] = useState<Repository[]>([]);
  const [ruleForm, setRuleForm] = useState({
    name: "",
    repositoryId: "",
    jiraProjectKey: "",
    priority: "100",
  });

  const [ticketKey, setTicketKey] = useState("");

  const handleRepoSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      await createRepository({
        name: repoForm.name,
        gitProvider: repoForm.gitProvider,
        remoteUrl: repoForm.remoteUrl,
        localMirrorPath: repoForm.localMirrorPath,
        defaultBranch: repoForm.defaultBranch,
        enabled: true,
        gitlabProjectId: repoForm.gitlabProjectId || undefined,
        allowedCommands: [],
        validationCommands: [],
      });
      toast.success("Repository added");
      const repoList = await fetchRepositories();
      setRepos(repoList);
      if (repoList.length > 0) {
        setRuleForm((prev) => ({ ...prev, repositoryId: repoList[0].id }));
      }
      setCurrentStep("rule");
    } catch (e) {
      toast.error("Failed: " + (e instanceof Error ? e.message : e));
    } finally {
      setSubmitting(false);
    }
  }, [repoForm, toast]);

  const handleRuleSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      await createRepoRule({
        name: ruleForm.name,
        repositoryId: ruleForm.repositoryId,
        jiraProjectKey: ruleForm.jiraProjectKey || null,
        priority: Number(ruleForm.priority) || 100,
        enabled: true,
      });
      toast.success("Rule added");
      setCurrentStep("run");
    } catch (e) {
      toast.error("Failed: " + (e instanceof Error ? e.message : e));
    } finally {
      setSubmitting(false);
    }
  }, [ruleForm, toast]);

  const handleRunSubmit = useCallback(async () => {
    const key = ticketKey.trim();
    if (!key) return;
    setSubmitting(true);
    try {
      await triggerManualRun(key, true);
      toast.success(`Run triggered for ${key}`);
      onComplete();
    } catch (e) {
      toast.error("Failed: " + (e instanceof Error ? e.message : e));
    } finally {
      setSubmitting(false);
    }
  }, [ticketKey, toast, onComplete]);

  const stepIndex = STEPS.findIndex((s) => s.key === currentStep);

  return (
    <div
      className="flex-1 flex items-center justify-center"
      style={{ padding: "80px 32px 32px" }}
    >
      <div style={{ width: "100%", maxWidth: 540 }}>
        {/* Brand anchor — frame the wizard with the logo to make first
            impression unambiguous: this is Arche, you are setting up. */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: 16,
          }}
        >
          <pre
            translate="no"
            aria-label="Arche"
            className="select-none"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              lineHeight: 1.1,
              color: "var(--c-bone)",
              margin: 0,
              letterSpacing: 0,
            }}
          >
            {ARCHE_ASCII}
          </pre>
        </div>
        <p
          style={{
            fontSize: "var(--text-body-sm)",
            color: "var(--c-fog-300)",
            textAlign: "center",
            marginBottom: 28,
          }}
        >
          Welcome — let's set up your first automated run in a few steps.
        </p>

        {/* Stepper */}
        <Stepper steps={STEPS} stepIndex={stepIndex} />

        <Card tone="default" padding={5} style={{ marginTop: 24 }}>
          {/* Step 1: Credentials */}
          {currentStep === "credentials" && (
            <div>
              <h3
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "var(--text-heading-lg)",
                  fontWeight: 700,
                  color: "var(--c-bone)",
                  marginBottom: 12,
                }}
              >
                Environment Check
              </h3>
              <CheckItem ok={snapshot.credentialEnv.openRouter} label="AI API Key (OpenRouter)" />
              <CheckItem ok={snapshot.services.dockerRunning} label="Docker daemon" />
              <CheckItem ok={snapshot.credentialEnv.gitlab} label="GitLab credentials (optional)" />
              <CheckItem ok={snapshot.credentialEnv.github} label="GitHub credentials (optional)" />
              <CheckItem ok={snapshot.credentialEnv.jira} label="Jira credentials (optional)" />
              <CheckItem ok={snapshot.summary.onlineWorkerCount > 0} label="Worker online" />

              {!snapshot.credentialEnv.openRouter && (
                <p
                  style={{
                    fontSize: 11,
                    color: "var(--c-gold-300)",
                    marginTop: 12,
                    lineHeight: 1.5,
                  }}
                >
                  OpenRouter key is required. Paste it below — it will be saved
                  to <code>.arche/environment</code>.
                </p>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleCredentialsSubmit();
                }}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  marginTop: 16,
                  paddingTop: 14,
                  borderTop: "1px solid var(--hairline)",
                }}
              >
                <Input
                  name="openRouterKey"
                  type="password"
                  label={
                    snapshot.credentialEnv.openRouter
                      ? "OpenRouter API key (already set — leave blank to keep)"
                      : "OpenRouter API key"
                  }
                  value={credForm.openRouterKey}
                  onChange={(e) =>
                    setCredForm((f) => ({ ...f, openRouterKey: e.target.value }))
                  }
                  placeholder="sk-or-v1-…"
                  autoComplete="off"
                  spellCheck={false}
                />

                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => setShowOptional((v) => !v)}
                >
                  {showOptional ? "Hide" : "Show"} optional credentials (GitHub, GitLab, Jira)
                </Button>

                {showOptional && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                      paddingLeft: 12,
                      borderLeft: "2px solid var(--hairline)",
                    }}
                  >
                    <Input
                      name="githubToken"
                      type="password"
                      label="GitHub PAT (optional)"
                      value={credForm.githubToken}
                      onChange={(e) =>
                        setCredForm((f) => ({ ...f, githubToken: e.target.value }))
                      }
                      placeholder="ghp_…"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <div className="grid grid-cols-2" style={{ gap: 10 }}>
                      <Input
                        name="gitlabBaseUrl"
                        label="GitLab base URL"
                        value={credForm.gitlabBaseUrl}
                        onChange={(e) =>
                          setCredForm((f) => ({ ...f, gitlabBaseUrl: e.target.value }))
                        }
                        placeholder="https://gitlab.com"
                        autoComplete="off"
                      />
                      <Input
                        name="gitlabToken"
                        type="password"
                        label="GitLab token"
                        value={credForm.gitlabToken}
                        onChange={(e) =>
                          setCredForm((f) => ({ ...f, gitlabToken: e.target.value }))
                        }
                        placeholder="glpat-…"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                    <Input
                      name="jiraBaseUrl"
                      label="Jira base URL"
                      value={credForm.jiraBaseUrl}
                      onChange={(e) =>
                        setCredForm((f) => ({ ...f, jiraBaseUrl: e.target.value }))
                      }
                      placeholder="https://yourco.atlassian.net"
                      autoComplete="off"
                    />
                    <div className="grid grid-cols-2" style={{ gap: 10 }}>
                      <Input
                        name="jiraEmail"
                        type="email"
                        label="Jira email"
                        value={credForm.jiraEmail}
                        onChange={(e) =>
                          setCredForm((f) => ({ ...f, jiraEmail: e.target.value }))
                        }
                        placeholder="you@yourco.com"
                        autoComplete="email"
                      />
                      <Input
                        name="jiraApiToken"
                        type="password"
                        label="Jira API token"
                        value={credForm.jiraApiToken}
                        onChange={(e) =>
                          setCredForm((f) => ({ ...f, jiraApiToken: e.target.value }))
                        }
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                  </div>
                )}

                <div
                  className="flex"
                  style={{ gap: 8, marginTop: 4, alignItems: "center" }}
                >
                  <Button
                    type="submit"
                    variant="secondary"
                    disabled={submitting}
                    isLoading={submitting}
                  >
                    {submitting ? "Saving" : "Save Credentials"}
                  </Button>
                  <span style={{ marginLeft: "auto" }}>
                    <Button
                      type="button"
                      variant="primary"
                      disabled={!snapshot.credentialEnv.openRouter}
                      title={
                        snapshot.credentialEnv.openRouter
                          ? ""
                          : "Save an OpenRouter key first"
                      }
                      onClick={async () => {
                        const repoList = await fetchRepositories();
                        setRepos(repoList);
                        if (repoList.length > 0) {
                          setRuleForm((prev) => ({ ...prev, repositoryId: repoList[0].id }));
                        }
                        setCurrentStep("repository");
                      }}
                    >
                      Continue
                    </Button>
                  </span>
                </div>
              </form>
            </div>
          )}

          {/* Step 2: Repository */}
          {currentStep === "repository" && (
            <div>
              <StepHeading>Add Your First Repository</StepHeading>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleRepoSubmit();
                }}
                style={{ display: "flex", flexDirection: "column", gap: 12 }}
              >
                <Input
                  name="name"
                  label="Name"
                  value={repoForm.name}
                  onChange={(e) =>
                    setRepoForm((f) => ({ ...f, name: e.target.value }))
                  }
                  required
                  autoComplete="off"
                />
                <Input
                  name="remoteUrl"
                  label="Remote URL"
                  value={repoForm.remoteUrl}
                  onChange={(e) => {
                    const url = e.target.value;
                    const detected = url.includes("github.com") ? "github" : "gitlab";
                    setRepoForm((f) => ({
                      ...f,
                      remoteUrl: url,
                      gitProvider: detected,
                    }));
                  }}
                  placeholder="git@gitlab.com:org/repo.git"
                  required
                  autoComplete="off"
                  spellCheck={false}
                />
                <Input
                  name="localMirrorPath"
                  label="Local Mirror Path"
                  value={repoForm.localMirrorPath}
                  onChange={(e) =>
                    setRepoForm((f) => ({ ...f, localMirrorPath: e.target.value }))
                  }
                  placeholder="/path/to/repo"
                  required
                  autoComplete="off"
                  spellCheck={false}
                />
                <div className="grid grid-cols-2" style={{ gap: 12 }}>
                  <Input
                    name="defaultBranch"
                    label="Default Branch"
                    value={repoForm.defaultBranch}
                    onChange={(e) =>
                      setRepoForm((f) => ({ ...f, defaultBranch: e.target.value }))
                    }
                    autoComplete="off"
                  />
                  <FieldGroup label="Git Provider">
                    <select
                      name="gitProvider"
                      value={repoForm.gitProvider}
                      onChange={(e) =>
                        setRepoForm((f) => ({ ...f, gitProvider: e.target.value }))
                      }
                      style={selectStyle}
                    >
                      <option value="gitlab">GitLab</option>
                      <option value="github">GitHub</option>
                    </select>
                  </FieldGroup>
                </div>
                {repoForm.gitProvider === "gitlab" && (
                  <Input
                    name="gitlabProjectId"
                    label="GitLab Project ID (optional)"
                    value={repoForm.gitlabProjectId}
                    onChange={(e) =>
                      setRepoForm((f) => ({ ...f, gitlabProjectId: e.target.value }))
                    }
                    autoComplete="off"
                  />
                )}
                <div className="flex" style={{ gap: 8, marginTop: 4 }}>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={submitting}
                    isLoading={submitting}
                  >
                    {submitting ? "Adding" : "Add Repository"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setCurrentStep("credentials")}
                  >
                    Back
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* Step 3: Rule */}
          {currentStep === "rule" && (
            <div>
              <StepHeading>Add a Routing Rule</StepHeading>
              <p
                style={{
                  fontSize: "var(--text-body-sm)",
                  color: "var(--c-fog-300)",
                  marginBottom: 12,
                }}
              >
                Route Jira tickets to a repository.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleRuleSubmit();
                }}
                style={{ display: "flex", flexDirection: "column", gap: 12 }}
              >
                <Input
                  name="name"
                  label="Rule Name"
                  value={ruleForm.name}
                  onChange={(e) =>
                    setRuleForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="e.g. project-bugs"
                  required
                  autoComplete="off"
                />
                <FieldGroup label="Repository">
                  <select
                    name="repositoryId"
                    value={ruleForm.repositoryId}
                    onChange={(e) =>
                      setRuleForm((f) => ({ ...f, repositoryId: e.target.value }))
                    }
                    required
                    style={selectStyle}
                  >
                    <option value="">Select…</option>
                    {repos.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </FieldGroup>
                <Input
                  name="jiraProjectKey"
                  label="Jira Project Key (optional)"
                  value={ruleForm.jiraProjectKey}
                  onChange={(e) =>
                    setRuleForm((f) => ({ ...f, jiraProjectKey: e.target.value }))
                  }
                  placeholder="PROJ"
                  autoComplete="off"
                />
                <div className="flex items-center" style={{ gap: 8, marginTop: 4 }}>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={submitting}
                    isLoading={submitting}
                  >
                    {submitting ? "Adding" : "Add Rule"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setCurrentStep("repository")}
                  >
                    Back
                  </Button>
                  <span style={{ marginLeft: "auto" }}>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setCurrentStep("run")}
                    >
                      Skip
                    </Button>
                  </span>
                </div>
              </form>
            </div>
          )}

          {/* Step 4: Test run */}
          {currentStep === "run" && (
            <div>
              <StepHeading>Trigger a Test Run</StepHeading>
              <p
                style={{
                  fontSize: "var(--text-body-sm)",
                  color: "var(--c-fog-300)",
                  marginBottom: 12,
                }}
              >
                Enter a Jira ticket key to test the pipeline end-to-end.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleRunSubmit();
                }}
                style={{ display: "flex", flexDirection: "column", gap: 12 }}
              >
                <Input
                  name="ticketKey"
                  label="Jira Ticket Key"
                  value={ticketKey}
                  onChange={(e) => setTicketKey(e.target.value)}
                  placeholder="PROJ-123"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="characters"
                />
                <div className="flex items-center" style={{ gap: 8, marginTop: 4 }}>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={submitting}
                    isLoading={submitting}
                  >
                    {submitting ? "Triggering" : "Trigger Run"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setCurrentStep("rule")}
                  >
                    Back
                  </Button>
                  <span style={{ marginLeft: "auto" }}>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={onComplete}
                    >
                      Skip & go to dashboard
                    </Button>
                  </span>
                </div>
              </form>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function StepHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        fontFamily: "var(--font-display)",
        fontSize: "var(--text-heading-lg)",
        fontWeight: 700,
        color: "var(--c-bone)",
        marginBottom: 12,
      }}
    >
      {children}
    </h3>
  );
}

function FieldGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        style={{
          display: "block",
          fontSize: "var(--text-label-md)",
          fontWeight: 600,
          color: "var(--c-fog-300)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginBottom: 6,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function Stepper({
  steps,
  stepIndex,
}: {
  steps: typeof STEPS;
  stepIndex: number;
}) {
  return (
    <div
      role="list"
      aria-label="Setup progress"
      className="flex items-center justify-center"
      style={{ gap: 6, flexWrap: "wrap" }}
    >
      {steps.map((step, i) => {
        const isActive = i === stepIndex;
        const isDone = i < stepIndex;
        const bg = isDone
          ? "var(--c-success-bg)"
          : isActive
          ? "var(--c-blue-950)"
          : "var(--surface-2)";
        const fg = isDone
          ? "var(--c-success-fg)"
          : isActive
          ? "var(--c-blue-200)"
          : "var(--c-steel-300)";
        return (
          <div
            key={step.key}
            role="listitem"
            aria-current={isActive ? "step" : undefined}
            className="flex items-center"
            style={{ gap: 6 }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: bg,
                color: fg,
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: 13,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                transition:
                  "background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)",
              }}
            >
              {isDone ? <Check size={14} strokeWidth={2.5} /> : step.number}
            </span>
            <span
              style={{
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: isActive ? "var(--c-fog-100)" : "var(--c-steel-300)",
              }}
            >
              {step.label}
            </span>
            {i < steps.length - 1 && (
              <div
                aria-hidden="true"
                style={{
                  width: 24,
                  height: 1,
                  margin: "0 4px",
                  background: isDone
                    ? "var(--c-success-fg)"
                    : "var(--hairline)",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
