import { useCallback, useEffect, useRef, useState } from "react";
import type { Repository } from "../types";
import {
  fetchRepositories,
  createRepository,
  updateRepository,
  deleteRepositoryApi,
} from "../api/client";
import { useToast } from "../context/ToastContext";
import { useFocusTrap } from "../hooks/useFocusTrap";

type FormData = {
  name: string;
  gitProvider: string;
  remoteUrl: string;
  localMirrorPath: string;
  defaultBranch: string;
  enabled: boolean;
  gitlabProjectId: string;
  allowedCommands: string;
  validationCommands: string;
};

const emptyForm: FormData = {
  name: "",
  gitProvider: "gitlab",
  remoteUrl: "",
  localMirrorPath: "",
  defaultBranch: "main",
  enabled: true,
  gitlabProjectId: "",
  allowedCommands: "",
  validationCommands: "",
};

function repoToForm(repo: Repository): FormData {
  return {
    name: repo.name,
    gitProvider: repo.gitProvider,
    remoteUrl: repo.remoteUrl,
    localMirrorPath: repo.localMirrorPath,
    defaultBranch: repo.defaultBranch,
    enabled: repo.enabled,
    gitlabProjectId: repo.gitlabProjectId || "",
    allowedCommands: (repo.allowedCommands || []).join("\n"),
    validationCommands: (repo.validationCommands || []).join("\n"),
  };
}

export function RepositoriesView() {
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
      const data = await fetchRepositories();
      setRepos(data);
    } catch (e) {
      toast.error("Failed to load repositories: " + (e instanceof Error ? e.message : e));
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

  const handleEdit = (repo: Repository) => {
    setForm(repoToForm(repo));
    setEditingId(repo.id);
    setModalMode("edit");
  };

  const handleSubmit = async () => {
    const payload = {
      name: form.name,
      gitProvider: form.gitProvider,
      remoteUrl: form.remoteUrl,
      localMirrorPath: form.localMirrorPath,
      defaultBranch: form.defaultBranch,
      enabled: form.enabled,
      gitlabProjectId: form.gitlabProjectId || undefined,
      allowedCommands: form.allowedCommands.split("\n").map((s) => s.trim()).filter(Boolean),
      validationCommands: form.validationCommands.split("\n").map((s) => s.trim()).filter(Boolean),
    };
    setSubmitting(true);
    try {
      if (modalMode === "edit" && editingId) {
        await updateRepository(editingId, payload);
        toast.success("Repository updated");
      } else {
        await createRepository(payload);
        toast.success("Repository created");
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
      await deleteRepositoryApi(deleteId);
      toast.success("Repository deleted");
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
            <div className="animate-pulse rounded bg-[var(--color-base-300)] h-4 w-1/3" />
            <div className="animate-pulse rounded bg-[var(--color-base-300)] h-3 w-2/3" />
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
          Repositories ({repos.length})
        </h2>
        <button className="btn-primary" onClick={handleCreate}>+ Add Repository</button>
      </div>

      {repos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="text-3xl mb-3 opacity-40">{"\u2630"}</div>
          <h3 className="text-sm font-semibold text-[var(--color-base-content)] mb-1">No repositories</h3>
          <p className="text-xs text-[var(--fg2)] mb-4">Add your first Git repository to start processing tickets.</p>
          <button className="btn-primary" onClick={handleCreate}>+ Add Repository</button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {repos.map((repo) => (
            <div
              key={repo.id}
              className="bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm text-[var(--color-base-content)]">{repo.name}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${repo.enabled ? "bg-[#3fb95020] text-[#3fb950]" : "bg-[#f8514920] text-[#f85149]"}`}>
                      {repo.enabled ? "enabled" : "disabled"}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#58a6ff20] text-[#58a6ff] font-medium">
                      {repo.gitProvider}
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--fg2)] break-all">{repo.remoteUrl}</div>
                  <div className="flex gap-4 mt-2 text-[10px] text-[var(--fg3)]">
                    <span>Branch: {repo.defaultBranch}</span>
                    <span>Commands: {(repo.allowedCommands || []).length}</span>
                    <span>Validation: {(repo.validationCommands || []).length}</span>
                    {repo.gitlabProjectId && <span>GitLab ID: {repo.gitlabProjectId}</span>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button className="btn-default" style={{ padding: "3px 8px", fontSize: "10px" }} onClick={() => handleEdit(repo)}>
                    Edit
                  </button>
                  <button className="btn-danger" style={{ padding: "3px 8px", fontSize: "10px" }} onClick={() => setDeleteId(repo.id)}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalMode && (
        <RepoFormModal
          mode={modalMode}
          form={form}
          setField={setField}
          onSubmit={handleSubmit}
          onClose={() => setModalMode(null)}
          submitting={submitting}
        />
      )}

      {deleteId && (
        <DeleteConfirmModal
          title="Delete repository?"
          body="This will permanently delete this repository configuration. Existing runs are not affected."
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}

function RepoFormModal({
  mode,
  form,
  setField,
  onSubmit,
  onClose,
  submitting,
}: {
  mode: "create" | "edit";
  form: FormData;
  setField: <K extends keyof FormData>(key: K, value: FormData[K]) => void;
  onSubmit: () => void;
  onClose: () => void;
  submitting?: boolean;
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
        className="bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] p-5 w-[90vw] max-w-[520px] max-h-[85vh] overflow-y-auto"
      >
        <h3 className="mb-4 font-semibold">{mode === "create" ? "Add Repository" : "Edit Repository"}</h3>
        <form onSubmit={handleFormSubmit} className="flex flex-col gap-3">
          <Field label="Name *">
            <input className={inputClass} value={form.name} onChange={(e) => setField("name", e.target.value)} required />
          </Field>
          <Field label="Remote URL *">
            <input className={inputClass} value={form.remoteUrl} onChange={(e) => setField("remoteUrl", e.target.value)} placeholder="https://gitlab.example.com/group/repo.git" required />
          </Field>
          <Field label="Local Mirror Path *">
            <input className={inputClass} value={form.localMirrorPath} onChange={(e) => setField("localMirrorPath", e.target.value)} placeholder="./runtime/repos/my-repo" required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Default Branch">
              <input className={inputClass} value={form.defaultBranch} onChange={(e) => setField("defaultBranch", e.target.value)} />
            </Field>
            <Field label="Git Provider">
              <select className={inputClass} value={form.gitProvider} onChange={(e) => setField("gitProvider", e.target.value)}>
                <option value="gitlab">GitLab</option>
                <option value="github">GitHub</option>
              </select>
            </Field>
          </div>
          <Field label="GitLab Project ID">
            <input className={inputClass} value={form.gitlabProjectId} onChange={(e) => setField("gitlabProjectId", e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Allowed Commands (one per line)">
            <textarea className={inputClass + " min-h-[60px] resize-y"} value={form.allowedCommands} onChange={(e) => setField("allowedCommands", e.target.value)} placeholder="pnpm lint&#10;pnpm test" />
          </Field>
          <Field label="Validation Commands (one per line)">
            <textarea className={inputClass + " min-h-[60px] resize-y"} value={form.validationCommands} onChange={(e) => setField("validationCommands", e.target.value)} placeholder="pnpm lint&#10;pnpm typecheck" />
          </Field>
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
