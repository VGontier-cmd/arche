import { useCallback, useEffect, useState } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import type { RepoRule, Repository } from "../types";
import {
  fetchRepoRules,
  fetchRepositories,
  createRepoRule,
  updateRepoRule,
  deleteRepoRuleApi,
} from "../api/client";
import { useToast } from "../context/ToastContext";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Input, Checkbox } from "./ui/Input";
import { ConfirmModal } from "./ConfirmModal";
import { Modal, ModalTitle, ModalActions } from "./Modal";

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
      const [rulesData, reposData] = await Promise.all([
        fetchRepoRules(),
        fetchRepositories(),
      ]);
      setRules(rulesData);
      setRepos(reposData);
    } catch (e) {
      toast.error("Failed to load: " + (e instanceof Error ? e.message : e));
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
      <div style={{ padding: 28, maxWidth: 960, margin: "0 auto", display: "flex", flexDirection: "column", gap: 12 }}>
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="animate-pulse"
            style={{
              background: "var(--surface-1)",
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius-md)",
              padding: 16,
              height: 80,
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
          Routing Rules
          <Badge tone="neutral" size="md" style={{ marginLeft: 10 }}>
            {rules.length}
          </Badge>
        </h2>
        <Button variant="primary" onClick={handleCreate}>
          Add Rule
        </Button>
      </div>

      {rules.length === 0 ? (
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
            <SettingsIcon
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
              No routing rules
            </h3>
            <p
              style={{
                fontSize: "var(--text-body-sm)",
                color: "var(--c-fog-300)",
                marginBottom: 16,
              }}
            >
              Add a rule to route Jira tickets to repositories.
            </p>
            <Button variant="primary" onClick={handleCreate}>
              Add Rule
            </Button>
          </div>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rules.map((rule) => (
            <Card key={rule.id} tone="default" padding={4}>
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
                      {rule.name}
                    </span>
                    <Badge tone={rule.enabled ? "success" : "danger"}>
                      {rule.enabled ? "enabled" : "disabled"}
                    </Badge>
                    <Badge tone="primary">priority {rule.priority}</Badge>
                  </div>
                  <div
                    className="flex flex-wrap"
                    style={{
                      gap: 16,
                      marginTop: 4,
                      fontSize: "var(--text-body-sm)",
                      color: "var(--c-fog-300)",
                    }}
                  >
                    <span>
                      Repo:{" "}
                      <strong style={{ color: "var(--c-fog-100)" }}>
                        {rule.repositoryName || rule.repositoryId}
                      </strong>
                    </span>
                    {rule.jiraProjectKey && <span>Jira: {rule.jiraProjectKey}</span>}
                    {rule.label && <span>Label: {rule.label}</span>}
                    {rule.issueType && <span>Type: {rule.issueType}</span>}
                  </div>
                </div>
                <div className="flex shrink-0" style={{ gap: 4 }}>
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => handleEdit(rule)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="xs"
                    variant="danger"
                    onClick={() => setDeleteId(rule.id)}
                    aria-label={`Delete rule ${rule.name}`}
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

      <ConfirmModal
        isOpen={deleteId !== null}
        title="Delete rule?"
        body="This will permanently delete this routing rule."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
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
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <Modal isOpen onClose={onClose} labelledBy="rule-form-title">
      <ModalTitle id="rule-form-title">
        {mode === "create" ? "Add Routing Rule" : "Edit Rule"}
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
        <FieldGroup label="Repository *">
          <select
            name="repositoryId"
            value={form.repositoryId}
            onChange={(e) => setField("repositoryId", e.target.value)}
            required
            style={selectStyle}
          >
            <option value="">Select a repository</option>
            {repos.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </FieldGroup>
        <div
          className="grid grid-cols-2"
          style={{ gap: 12 }}
        >
          <Input
            name="jiraProjectKey"
            label="Jira Project Key"
            value={form.jiraProjectKey}
            onChange={(e) => setField("jiraProjectKey", e.target.value)}
            placeholder="PROJ"
            autoComplete="off"
            spellCheck={false}
          />
          <Input
            name="label"
            label="Label"
            value={form.label}
            onChange={(e) => setField("label", e.target.value)}
            placeholder="agent-ready"
            autoComplete="off"
          />
        </div>
        <div className="grid grid-cols-2" style={{ gap: 12 }}>
          <Input
            name="issueType"
            label="Issue Type"
            value={form.issueType}
            onChange={(e) => setField("issueType", e.target.value)}
            placeholder="Bug, Task…"
            autoComplete="off"
          />
          <Input
            name="priority"
            label="Priority"
            type="number"
            inputMode="numeric"
            value={form.priority}
            onChange={(e) => setField("priority", e.target.value)}
          />
        </div>
        <Checkbox
          name="enabled"
          label="Enabled"
          checked={form.enabled}
          onChange={(e) => setField("enabled", e.target.checked)}
        />
        <ModalActions>
          <Button type="submit" variant="primary" isLoading={submitting} disabled={submitting}>
            {submitting ? "Saving" : mode === "create" ? "Create" : "Save"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
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
