import { useCallback, useEffect, useState } from "react";
import { FolderGit2 } from "lucide-react";
import type { Repository } from "../types";
import { splitLines } from "../lib/format";
import {
  fetchRepositories,
  createRepository,
  updateRepository,
  deleteRepositoryApi,
} from "../api/client";
import { useToast } from "../context/ToastContext";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Input, Textarea, Checkbox } from "./ui/Input";
import { Modal, ModalTitle, ModalActions } from "./Modal";
import { ConfirmModal } from "./ConfirmModal";

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
  instructions: string;
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
  instructions: "",
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
    instructions: repo.instructions || "",
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
      toast.error(
        "Failed to load repositories: " + (e instanceof Error ? e.message : e),
      );
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

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
    const name = form.name.trim();
    const remoteUrl = form.remoteUrl.trim();
    if (!name) {
      toast.error("Name is required");
      return;
    }
    if (!remoteUrl) {
      toast.error("Remote URL is required");
      return;
    }
    const payload = {
      name,
      gitProvider: form.gitProvider,
      remoteUrl,
      localMirrorPath: form.localMirrorPath,
      defaultBranch: form.defaultBranch,
      enabled: form.enabled,
      gitlabProjectId: form.gitlabProjectId || undefined,
      allowedCommands: splitLines(form.allowedCommands),
      validationCommands: splitLines(form.validationCommands),
      instructions: form.instructions.trim() || null,
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
      <div
        style={{
          padding: 28,
          maxWidth: 960,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="animate-pulse"
            style={{
              background: "var(--surface-1)",
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius-md)",
              padding: 16,
              height: 92,
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div style={{ padding: 28, maxWidth: 960, margin: "0 auto" }}>
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 20 }}
      >
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-display-md)",
            fontWeight: 700,
            letterSpacing: "-0.015em",
            color: "var(--c-bone)",
          }}
        >
          Repositories
          <Badge tone="neutral" size="md" style={{ marginLeft: 10 }}>
            {repos.length}
          </Badge>
        </h2>
        <Button variant="primary" onClick={handleCreate}>
          Add Repository
        </Button>
      </div>

      {repos.length === 0 ? (
        <Card tone="default" padding={6}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "24px 16px",
              textAlign: "center",
            }}
          >
            <FolderGit2
              size={32}
              strokeWidth={1.5}
              aria-hidden="true"
              style={{ color: "var(--c-steel-300)", marginBottom: 12 }}
            />
            <h3
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-heading-lg)",
                fontWeight: 700,
                color: "var(--c-bone)",
                marginBottom: 6,
              }}
            >
              No repositories
            </h3>
            <p
              style={{
                fontSize: "var(--text-body-sm)",
                color: "var(--c-fog-300)",
                marginBottom: 16,
              }}
            >
              Add your first Git repository to start processing tickets.
            </p>
            <Button variant="primary" onClick={handleCreate}>
              Add Repository
            </Button>
          </div>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {repos.map((repo) => (
            <Card key={repo.id} tone="default" padding={4}>
              <div
                className="flex items-start justify-between"
                style={{ gap: 16 }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    className="flex items-center"
                    style={{ gap: 8, marginBottom: 6, flexWrap: "wrap" }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-display)",
                        fontSize: "var(--text-heading-md)",
                        fontWeight: 700,
                        letterSpacing: "-0.005em",
                        color: "var(--c-bone)",
                      }}
                    >
                      {repo.name}
                    </span>
                    <Badge tone={repo.enabled ? "success" : "danger"}>
                      {repo.enabled ? "enabled" : "disabled"}
                    </Badge>
                    <Badge tone="primary">{repo.gitProvider}</Badge>
                  </div>
                  <div
                    style={{
                      fontSize: "var(--text-body-sm)",
                      color: "var(--c-fog-300)",
                      wordBreak: "break-all",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {repo.remoteUrl}
                  </div>
                  <div
                    className="flex flex-wrap"
                    style={{
                      gap: 16,
                      marginTop: 8,
                      fontSize: "var(--text-label-md)",
                      color: "var(--c-steel-300)",
                    }}
                  >
                    <span>Branch: {repo.defaultBranch}</span>
                    <span>Commands: {(repo.allowedCommands || []).length}</span>
                    <span>
                      Validation: {(repo.validationCommands || []).length}
                    </span>
                    {repo.gitlabProjectId && (
                      <span>GitLab ID: {repo.gitlabProjectId}</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0" style={{ gap: 4 }}>
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => handleEdit(repo)}
                    aria-label={`Edit repository ${repo.name}`}
                  >
                    Edit
                  </Button>
                  <Button
                    size="xs"
                    variant="danger"
                    onClick={() => setDeleteId(repo.id)}
                    aria-label={`Delete repository ${repo.name}`}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </Card>
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

      <ConfirmModal
        isOpen={deleteId !== null}
        title="Delete repository?"
        body="This will permanently delete this repository configuration. Existing runs are not affected."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
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
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <Modal isOpen onClose={onClose} labelledBy="repo-form-title" size="lg">
      <ModalTitle id="repo-form-title">
        {mode === "create" ? "Add Repository" : "Edit Repository"}
      </ModalTitle>
      <form
        onSubmit={handleFormSubmit}
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        <Input
          name="name"
          label="Name *"
          value={form.name}
          onChange={(e) => setField("name", e.target.value)}
          required
          autoComplete="off"
        />
        <Input
          name="remoteUrl"
          label="Remote URL *"
          value={form.remoteUrl}
          onChange={(e) => setField("remoteUrl", e.target.value)}
          placeholder="https://gitlab.example.com/group/repo.git"
          required
          autoComplete="off"
          spellCheck={false}
        />
        <Input
          name="localMirrorPath"
          label="Local Mirror Path *"
          value={form.localMirrorPath}
          onChange={(e) => setField("localMirrorPath", e.target.value)}
          placeholder="./runtime/repos/my-repo"
          required
          autoComplete="off"
          spellCheck={false}
        />
        <div className="grid grid-cols-2" style={{ gap: 12 }}>
          <Input
            name="defaultBranch"
            label="Default Branch"
            value={form.defaultBranch}
            onChange={(e) => setField("defaultBranch", e.target.value)}
            autoComplete="off"
          />
          <FieldGroup label="Git Provider">
            <select
              name="gitProvider"
              value={form.gitProvider}
              onChange={(e) => setField("gitProvider", e.target.value)}
              style={selectStyle}
            >
              <option value="gitlab">GitLab</option>
              <option value="github">GitHub</option>
            </select>
          </FieldGroup>
        </div>
        <Input
          name="gitlabProjectId"
          label="GitLab Project ID"
          value={form.gitlabProjectId}
          onChange={(e) => setField("gitlabProjectId", e.target.value)}
          placeholder="Optional"
          autoComplete="off"
          spellCheck={false}
        />
        <Textarea
          name="allowedCommands"
          label="Allowed Commands (one per line)"
          value={form.allowedCommands}
          onChange={(e) => setField("allowedCommands", e.target.value)}
          placeholder={"pnpm lint\npnpm test"}
          spellCheck={false}
          rows={3}
        />
        <Textarea
          name="validationCommands"
          label="Validation Commands (one per line)"
          value={form.validationCommands}
          onChange={(e) => setField("validationCommands", e.target.value)}
          placeholder={"pnpm lint\npnpm typecheck"}
          spellCheck={false}
          rows={3}
        />
        <Textarea
          name="instructions"
          label="Agent Instructions (optional — team conventions, SOPs)"
          value={form.instructions}
          onChange={(e) => setField("instructions", e.target.value)}
          placeholder={
            "Always use Tailwind for styling, never CSS modules.\nGo errors: wrap with fmt.Errorf.\nTests must cover the happy path and at least one error case."
          }
          rows={4}
        />
        <Checkbox
          name="enabled"
          label="Enabled"
          checked={form.enabled}
          onChange={(e) => setField("enabled", e.target.checked)}
        />
        <ModalActions>
          <Button
            type="submit"
            variant="primary"
            isLoading={submitting}
            disabled={submitting}
          >
            {submitting ? "Saving" : mode === "create" ? "Create" : "Save"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}

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
