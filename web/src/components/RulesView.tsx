import { useCallback, useEffect, useRef, useState } from "react";
import type { RepoRule, Repository } from "../types";
import {
  fetchRepoRules,
  fetchRepositories,
  createRepoRule,
  updateRepoRule,
  deleteRepoRuleApi,
} from "../api/client";
import { useToast } from "../context/ToastContext";
import { useFocusTrap } from "../hooks/useFocusTrap";

type FormData = {
  name: string;
  repositoryId: string;
  jiraProjectKey: string;
  label: string;
  issueType: string;
  priority: string;
  enabled: boolean;
};

const emptyForm: FormData = {
  name: "",
  repositoryId: "",
  jiraProjectKey: "",
  label: "",
  issueType: "",
  priority: "100",
  enabled: true,
};

function ruleToForm(rule: RepoRule): FormData {
  return {
    name: rule.name,
    repositoryId: rule.repositoryId,
    jiraProjectKey: rule.jiraProjectKey || "",
    label: rule.label || "",
    issueType: rule.issueType || "",
    priority: String(rule.priority),
    enabled: rule.enabled,
  };
}

export function RulesView() {
  const [rules, setRules] = useState<RepoRule[]>([]);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [rulesData, reposData] = await Promise.all([fetchRepoRules(), fetchRepositories()]);
      setRules(rulesData);
      setRepos(reposData);
    } catch (e) {
      toast.error("Failed to load: " + (e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = () => {
    setForm(emptyForm);
    setEditingId(null);
    setModalMode("create");
  };

  const handleEdit = (rule: RepoRule) => {
    setForm(ruleToForm(rule));
    setEditingId(rule.id);
    setModalMode("edit");
  };

  const handleSubmit = async () => {
    const payload = {
      name: form.name,
      repositoryId: form.repositoryId || undefined,
      jiraProjectKey: form.jiraProjectKey || null,
      label: form.label || null,
      issueType: form.issueType || null,
      priority: Number(form.priority) || 100,
      enabled: form.enabled,
    };
    setSubmitting(true);
    try {
      if (modalMode === "edit" && editingId) {
        await updateRepoRule(editingId, payload);
        toast.success("Rule updated");
      } else {
        await createRepoRule(payload);
        toast.success("Rule created");
      }
      setModalMode(null);
      await load();
    } catch (e) {
      toast.error("Failed: " + (e instanceof Error ? e.message : e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteRepoRuleApi(deleteId);
      toast.success("Rule deleted");
      setDeleteId(null);
      await load();
    } catch (e) {
      toast.error("Delete failed: " + (e instanceof Error ? e.message : e));
    }
  };

  const setField = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div className="p-5 max-w-4xl space-y-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] p-4 space-y-3">
            <div className="animate-pulse rounded bg-[var(--color-base-300)] h-4 w-1/4" />
            <div className="animate-pulse rounded bg-[var(--color-base-300)] h-3 w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="p-5 max-w-4xl">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-[var(--color-base-content)]">
          Routing Rules ({rules.length})
        </h2>
        <button className="btn-primary" onClick={handleCreate}>+ Add Rule</button>
      </div>

      {rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="text-3xl mb-3 opacity-40">{"\u2699"}</div>
          <h3 className="text-sm font-semibold text-[var(--color-base-content)] mb-1">No routing rules</h3>
          <p className="text-xs text-[var(--fg2)] mb-4">Add a rule to route Jira tickets to repositories.</p>
          <button className="btn-primary" onClick={handleCreate}>+ Add Rule</button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm text-[var(--color-base-content)]">{rule.name}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${rule.enabled ? "bg-[#3fb95020] text-[#3fb950]" : "bg-[#f8514920] text-[#f85149]"}`}>
                      {rule.enabled ? "enabled" : "disabled"}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#d2a8ff20] text-[#d2a8ff] font-medium">
                      priority {rule.priority}
                    </span>
                  </div>
                  <div className="flex gap-4 mt-1 text-[11px] text-[var(--fg2)] flex-wrap">
                    <span>Repo: <strong>{rule.repositoryName || rule.repositoryId}</strong></span>
                    {rule.jiraProjectKey && <span>Jira: {rule.jiraProjectKey}</span>}
                    {rule.label && <span>Label: {rule.label}</span>}
                    {rule.issueType && <span>Type: {rule.issueType}</span>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button className="btn-default" style={{ padding: "3px 8px", fontSize: "10px" }} onClick={() => handleEdit(rule)}>
                    Edit
                  </button>
                  <button className="btn-danger" style={{ padding: "3px 8px", fontSize: "10px" }} onClick={() => setDeleteId(rule.id)}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalMode && (
        <RuleFormModal
          mode={modalMode}
          form={form}
          setField={setField}
          repos={repos}
          onSubmit={handleSubmit}
          onClose={() => setModalMode(null)}
          submitting={submitting}
        />
      )}

      {deleteId && (
        <DeleteConfirmModal
          title="Delete rule?"
          body="This will permanently delete this routing rule."
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}

function RuleFormModal({
  mode,
  form,
  setField,
  repos,
  onSubmit,
  onClose,
  submitting,
}: {
  mode: "create" | "edit";
  form: FormData;
  setField: <K extends keyof FormData>(key: K, value: FormData[K]) => void;
  submitting?: boolean;
  repos: Repository[];
  onSubmit: () => void;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, true);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  const inputClass = "w-full bg-[var(--color-base-100)] border border-[var(--border-color)] rounded-[var(--rounded-box)] text-[var(--color-base-content)] px-2.5 py-1.5 text-xs font-[inherit] outline-none focus:border-[#58a6ff]";

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center">
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        className="bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] p-5 w-[90vw] max-w-[480px]"
      >
        <h3 className="mb-4 font-semibold">{mode === "create" ? "Add Routing Rule" : "Edit Rule"}</h3>
        <form onSubmit={handleFormSubmit} className="flex flex-col gap-3">
          <Field label="Name *">
            <input className={inputClass} value={form.name} onChange={(e) => setField("name", e.target.value)} required />
          </Field>
          <Field label="Repository *">
            <select className={inputClass} value={form.repositoryId} onChange={(e) => setField("repositoryId", e.target.value)} required>
              <option value="">Select a repository</option>
              {repos.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Jira Project Key">
              <input className={inputClass} value={form.jiraProjectKey} onChange={(e) => setField("jiraProjectKey", e.target.value)} placeholder="PROJ" />
            </Field>
            <Field label="Label">
              <input className={inputClass} value={form.label} onChange={(e) => setField("label", e.target.value)} placeholder="agent-ready" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Issue Type">
              <input className={inputClass} value={form.issueType} onChange={(e) => setField("issueType", e.target.value)} placeholder="Bug, Task..." />
            </Field>
            <Field label="Priority">
              <input className={inputClass} type="number" value={form.priority} onChange={(e) => setField("priority", e.target.value)} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--fg2)] cursor-pointer">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setField("enabled", e.target.checked)} className="accent-[#58a6ff]" />
            Enabled
          </label>
          <div className="flex gap-2 mt-2">
            <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? "Saving..." : mode === "create" ? "Create" : "Save"}</button>
            <button type="button" className="btn-default" onClick={onClose} disabled={submitting}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-[var(--fg2)] mb-1">{label}</label>
      {children}
    </div>
  );
}

function DeleteConfirmModal({
  title,
  body,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, true);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center">
      <div ref={containerRef} role="dialog" aria-modal="true" className="bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] p-5 w-[90vw] max-w-[400px]">
        <h3 className="mb-2 font-semibold">{title}</h3>
        <p className="text-xs text-[var(--fg2)] mb-4">{body}</p>
        <div className="flex gap-2">
          <button className="btn-danger" onClick={onConfirm}>Delete</button>
          <button className="btn-default" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
