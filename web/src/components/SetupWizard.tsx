import { useCallback, useState } from "react";
import type { DashboardSnapshot, Repository } from "../types";
import { createRepository, createRepoRule, fetchRepositories, triggerManualRun } from "../api/client";
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
}: {
  snapshot: DashboardSnapshot;
  onComplete: () => void;
}) {
  const toast = useToast();
  const [currentStep, setCurrentStep] = useState<Step>("credentials");
  const [submitting, setSubmitting] = useState(false);

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
    <div className="flex-1 flex items-center justify-center p-8">
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
              <div className="mt-4">
                <button className="btn-primary" onClick={async () => {
                  const repoList = await fetchRepositories();
                  setRepos(repoList);
                  if (repoList.length > 0) {
                    setRuleForm((prev) => ({ ...prev, repositoryId: repoList[0].id }));
                  }
                  setCurrentStep("repository");
                }}>
                  Continue
                </button>
              </div>
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
                  <input className={inputClass} value={repoForm.remoteUrl} onChange={(e) => setRepoForm((f) => ({ ...f, remoteUrl: e.target.value }))} placeholder="git@gitlab.com:org/repo.git" required />
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
