import { useCallback, useState } from "react";
import type { DashboardSnapshot, Repository } from "../types";
import {
  createRepository,
  createRepoRule,
  fetchRepositories,
  saveSetupCredentials,
  triggerManualRun,
} from "../api/client";
import { useToast } from "../context/ToastContext";

type Step = "credentials" | "repository" | "rule" | "run";

const STEPS: Array<{ key: Step; label: string; number: string }> = [
  { key: "credentials", label: "Check Setup", number: "1" },
  { key: "repository", label: "Add Repository", number: "2" },
  { key: "rule", label: "Add Rule", number: "3" },
  { key: "run", label: "Test Run", number: "4" },
];

const inputClass =
  "w-full bg-[var(--color-base-100)] border border-[var(--border-color)] rounded-[var(--rounded-box)] text-[var(--color-base-content)] px-2.5 py-1.5 text-xs font-[inherit] outline-none focus:border-[#58a6ff]";

function CheckItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs py-1">
      <span className={ok ? "text-[#3fb950]" : "text-[#f85149]"}>{ok ? "\u2713" : "\u2717"}</span>
      <span className={ok ? "text-[var(--color-base-content)]" : "text-[var(--fg2)]"}>{label}</span>
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

  // Credentials form
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
        if (credForm.gitlabBaseUrl.trim()) payload.gitlabBaseUrl = credForm.gitlabBaseUrl.trim();
      }
      if (credForm.jiraBaseUrl.trim() && credForm.jiraEmail.trim() && credForm.jiraApiToken.trim()) {
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

  // Repository form
  const [repoForm, setRepoForm] = useState({
    name: "",
    remoteUrl: "",
    localMirrorPath: "",
    defaultBranch: "main",
    gitProvider: "gitlab",
    gitlabProjectId: "",
  });

  // Rule form
  const [repos, setRepos] = useState<Repository[]>([]);
  const [ruleForm, setRuleForm] = useState({
    name: "",
    repositoryId: "",
    jiraProjectKey: "",
    priority: "100",
  });

  // Run form
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
    <div className="flex-1 flex items-center justify-center px-8 pt-20 pb-8">
      <div className="w-full max-w-lg">
        <h2 className="text-lg font-semibold text-[var(--color-base-content)] mb-1 text-center">
          Welcome to Arche
        </h2>
        <p className="text-xs text-[var(--fg2)] mb-6 text-center">
          Let's set up your first automated run in a few steps.
        </p>

        {/* Stepper */}
        <div className="flex items-center justify-center gap-1 mb-8">
          {STEPS.map((step, i) => {
            const isActive = i === stepIndex;
            const isDone = i < stepIndex;
            return (
              <div key={step.key} className="flex items-center gap-1">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold ${
                    isDone
                      ? "bg-[#3fb950] text-white"
                      : isActive
                        ? "bg-[#58a6ff] text-white"
                        : "bg-[var(--color-base-300)] text-[var(--fg3)]"
                  }`}
                >
                  {isDone ? "\u2713" : step.number}
                </div>
                <span className={`text-[10px] ${isActive ? "text-[var(--color-base-content)]" : "text-[var(--fg3)]"}`}>
                  {step.label}
                </span>
                {i < STEPS.length - 1 && (
                  <div className={`w-6 h-px mx-1 ${isDone ? "bg-[#3fb950]" : "bg-[var(--border-color)]"}`} />
                )}
              </div>
            );
          })}
        </div>

        <div className="bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] p-5">
          {/* Step 1: Credentials check */}
          {currentStep === "credentials" && (
            <div>
              <h3 className="text-sm font-semibold mb-3">Environment Check</h3>
              <CheckItem ok={snapshot.credentialEnv.openRouter} label="AI API Key (OpenRouter)" />
              <CheckItem ok={snapshot.services.dockerRunning} label="Docker daemon" />
              <CheckItem ok={snapshot.credentialEnv.gitlab} label="GitLab credentials (optional)" />
              <CheckItem ok={snapshot.credentialEnv.github} label="GitHub credentials (optional)" />
              <CheckItem ok={snapshot.credentialEnv.jira} label="Jira credentials (optional)" />
              <CheckItem ok={snapshot.summary.onlineWorkerCount > 0} label="Worker online" />

              {!snapshot.credentialEnv.openRouter && (
                <p className="text-[11px] text-[#d29922] mt-3 leading-snug">
                  OpenRouter key is required. Paste it below — it will be saved to <code>.arche/environment</code>.
                </p>
              )}

              <form
                onSubmit={(e) => { e.preventDefault(); handleCredentialsSubmit(); }}
                className="flex flex-col gap-2.5 mt-4 pt-3 border-t border-[var(--border-color)]"
              >
                <div>
                  <label className="block text-xs text-[var(--fg2)] mb-1">
                    OpenRouter API key {snapshot.credentialEnv.openRouter && <span className="text-[#3fb950] text-[10px]">(already set — leave blank to keep)</span>}
                  </label>
                  <input
                    className={inputClass}
                    type="password"
                    value={credForm.openRouterKey}
                    onChange={(e) => setCredForm((f) => ({ ...f, openRouterKey: e.target.value }))}
                    placeholder="sk-or-v1-…"
                    autoComplete="off"
                  />
                </div>

                <button
                  type="button"
                  className="text-[11px] text-[#58a6ff] hover:underline self-start"
                  onClick={() => setShowOptional((v) => !v)}
                >
                  {showOptional ? "Hide" : "Show"} optional credentials (GitHub, GitLab, Jira)
                </button>

                {showOptional && (
                  <div className="flex flex-col gap-2.5 pl-2 border-l-2 border-[var(--border-color)]">
                    <div>
                      <label className="block text-xs text-[var(--fg2)] mb-1">GitHub PAT (optional)</label>
                      <input
                        className={inputClass}
                        type="password"
                        value={credForm.githubToken}
                        onChange={(e) => setCredForm((f) => ({ ...f, githubToken: e.target.value }))}
                        placeholder="ghp_…"
                        autoComplete="off"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-[var(--fg2)] mb-1">GitLab base URL</label>
                        <input
                          className={inputClass}
                          value={credForm.gitlabBaseUrl}
                          onChange={(e) => setCredForm((f) => ({ ...f, gitlabBaseUrl: e.target.value }))}
                          placeholder="https://gitlab.com"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[var(--fg2)] mb-1">GitLab token</label>
                        <input
                          className={inputClass}
                          type="password"
                          value={credForm.gitlabToken}
                          onChange={(e) => setCredForm((f) => ({ ...f, gitlabToken: e.target.value }))}
                          placeholder="glpat-…"
                          autoComplete="off"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--fg2)] mb-1">Jira base URL</label>
                      <input
                        className={inputClass}
                        value={credForm.jiraBaseUrl}
                        onChange={(e) => setCredForm((f) => ({ ...f, jiraBaseUrl: e.target.value }))}
                        placeholder="https://yourco.atlassian.net"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-[var(--fg2)] mb-1">Jira email</label>
                        <input
                          className={inputClass}
                          value={credForm.jiraEmail}
                          onChange={(e) => setCredForm((f) => ({ ...f, jiraEmail: e.target.value }))}
                          placeholder="you@yourco.com"
                          autoComplete="off"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[var(--fg2)] mb-1">Jira API token</label>
                        <input
                          className={inputClass}
                          type="password"
                          value={credForm.jiraApiToken}
                          onChange={(e) => setCredForm((f) => ({ ...f, jiraApiToken: e.target.value }))}
                          autoComplete="off"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 mt-2">
                  <button type="submit" className="btn-default" disabled={submitting}>
                    {submitting ? "Saving…" : "Save Credentials"}
                  </button>
                  <button
                    type="button"
                    className="btn-primary ml-auto"
                    disabled={!snapshot.credentialEnv.openRouter}
                    title={snapshot.credentialEnv.openRouter ? "" : "Save an OpenRouter key first"}
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
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Step 2: Add repository */}
          {currentStep === "repository" && (
            <div>
              <h3 className="text-sm font-semibold mb-3">Add Your First Repository</h3>
              <form onSubmit={(e) => { e.preventDefault(); handleRepoSubmit(); }} className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs text-[var(--fg2)] mb-1">Name</label>
                  <input className={inputClass} value={repoForm.name} onChange={(e) => setRepoForm((f) => ({ ...f, name: e.target.value }))} required />
                </div>
                <div>
                  <label className="block text-xs text-[var(--fg2)] mb-1">Remote URL</label>
                  <input
                    className={inputClass}
                    value={repoForm.remoteUrl}
                    onChange={(e) => {
                      const url = e.target.value;
                      const detected = url.includes("github.com") ? "github" : "gitlab";
                      setRepoForm((f) => ({ ...f, remoteUrl: url, gitProvider: detected }));
                    }}
                    placeholder="git@gitlab.com:org/repo.git"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--fg2)] mb-1">Local Mirror Path</label>
                  <input className={inputClass} value={repoForm.localMirrorPath} onChange={(e) => setRepoForm((f) => ({ ...f, localMirrorPath: e.target.value }))} placeholder="/path/to/repo" required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--fg2)] mb-1">Default Branch</label>
                    <input className={inputClass} value={repoForm.defaultBranch} onChange={(e) => setRepoForm((f) => ({ ...f, defaultBranch: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--fg2)] mb-1">Git Provider</label>
                    <select className={inputClass} value={repoForm.gitProvider} onChange={(e) => setRepoForm((f) => ({ ...f, gitProvider: e.target.value }))}>
                      <option value="gitlab">GitLab</option>
                      <option value="github">GitHub</option>
                    </select>
                  </div>
                </div>
                {repoForm.gitProvider === "gitlab" && (
                  <div>
                    <label className="block text-xs text-[var(--fg2)] mb-1">GitLab Project ID (optional)</label>
                    <input className={inputClass} value={repoForm.gitlabProjectId} onChange={(e) => setRepoForm((f) => ({ ...f, gitlabProjectId: e.target.value }))} />
                  </div>
                )}
                <div className="flex gap-2 mt-1">
                  <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? "Adding..." : "Add Repository"}</button>
                  <button type="button" className="btn-default" onClick={() => setCurrentStep("credentials")}>Back</button>
                </div>
              </form>
            </div>
          )}

          {/* Step 3: Add rule */}
          {currentStep === "rule" && (
            <div>
              <h3 className="text-sm font-semibold mb-3">Add a Routing Rule</h3>
              <p className="text-xs text-[var(--fg2)] mb-3">Route Jira tickets to a repository.</p>
              <form onSubmit={(e) => { e.preventDefault(); handleRuleSubmit(); }} className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs text-[var(--fg2)] mb-1">Rule Name</label>
                  <input className={inputClass} value={ruleForm.name} onChange={(e) => setRuleForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. project-bugs" required />
                </div>
                <div>
                  <label className="block text-xs text-[var(--fg2)] mb-1">Repository</label>
                  <select className={inputClass} value={ruleForm.repositoryId} onChange={(e) => setRuleForm((f) => ({ ...f, repositoryId: e.target.value }))} required>
                    <option value="">Select...</option>
                    {repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[var(--fg2)] mb-1">Jira Project Key (optional)</label>
                  <input className={inputClass} value={ruleForm.jiraProjectKey} onChange={(e) => setRuleForm((f) => ({ ...f, jiraProjectKey: e.target.value }))} placeholder="PROJ" />
                </div>
                <div className="flex gap-2 mt-1">
                  <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? "Adding..." : "Add Rule"}</button>
                  <button type="button" className="btn-default" onClick={() => setCurrentStep("repository")}>Back</button>
                  <button type="button" className="text-xs text-[var(--fg3)] hover:text-[var(--fg2)] ml-auto" onClick={() => setCurrentStep("run")}>Skip</button>
                </div>
              </form>
            </div>
          )}

          {/* Step 4: Trigger test run */}
          {currentStep === "run" && (
            <div>
              <h3 className="text-sm font-semibold mb-3">Trigger a Test Run</h3>
              <p className="text-xs text-[var(--fg2)] mb-3">Enter a Jira ticket key to test the pipeline end-to-end.</p>
              <form onSubmit={(e) => { e.preventDefault(); handleRunSubmit(); }} className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs text-[var(--fg2)] mb-1">Jira Ticket Key</label>
                  <input className={inputClass} value={ticketKey} onChange={(e) => setTicketKey(e.target.value)} placeholder="PROJ-123" required />
                </div>
                <div className="flex gap-2 mt-1">
                  <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? "Triggering..." : "Trigger Run"}</button>
                  <button type="button" className="btn-default" onClick={() => setCurrentStep("rule")}>Back</button>
                  <button type="button" className="text-xs text-[var(--fg3)] hover:text-[var(--fg2)] ml-auto" onClick={onComplete}>Skip & go to dashboard</button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
