import { useEffect, useRef, useState } from "react";
import type { OrchestratorConfigView, ExecutorProfile } from "../types";
import {
  fetchConfig,
  updateConfig,
  fetchOpenRouterModels,
  type OpenRouterModel,
} from "../api/client";
import { useToast } from "../context/ToastContext";
import { splitLines } from "../lib/format";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { Input, Textarea, Checkbox } from "./ui/Input";
import { Badge } from "./ui/Badge";

type SectionKey =
  | "workflow"
  | "policy"
  | "worker"
  | "defaults"
  | "routing"
  | "git"
  | "executors";

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

export function SettingsView() {
  const [config, setConfig] = useState<OrchestratorConfigView | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingSection, setEditingSection] = useState<SectionKey | null>(null);
  const [sectionForm, setSectionForm] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    fetchConfig()
      .then(setConfig)
      .catch((e) =>
        toast.error(
          "Failed to load config: " + (e instanceof Error ? e.message : e),
        ),
      )
      .finally(() => setLoading(false));
  }, [toast]);

  const startEdit = (key: SectionKey) => {
    if (!config) return;
    setSectionForm(JSON.parse(JSON.stringify(config[key])));
    setEditingSection(key);
  };

  const cancelEdit = () => {
    setEditingSection(null);
    setSectionForm({});
  };

  const handleSave = async () => {
    if (!editingSection) return;
    setSaving(true);
    try {
      const updated = await updateConfig({
        [editingSection]: sectionForm,
      } as Partial<OrchestratorConfigView>);
      setConfig(updated);
      setEditingSection(null);
      setSectionForm({});
      toast.success("Configuration saved");
    } catch (e) {
      toast.error(
        "Failed to save: " + (e instanceof Error ? e.message : e),
      );
    } finally {
      setSaving(false);
    }
  };

  const updateField = (key: string, value: unknown) => {
    setSectionForm((prev) => ({ ...prev, [key]: value }));
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
          gap: 16,
        }}
      >
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="animate-pulse"
            style={{
              background: "var(--surface-1)",
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius-md)",
              padding: 16,
              height: 96,
            }}
          />
        ))}
      </div>
    );
  }

  if (!config) {
    return (
      <div
        style={{
          padding: 32,
          textAlign: "center",
          color: "var(--c-steel-300)",
          fontSize: "var(--text-body-sm)",
        }}
      >
        Failed to load configuration.
      </div>
    );
  }

  return (
    <div style={{ padding: 28, maxWidth: 960, margin: "0 auto" }}>
      <h2
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-display-md)",
          fontWeight: 700,
          letterSpacing: "-0.015em",
          color: "var(--c-bone)",
          marginBottom: 20,
        }}
      >
        Configuration
        <span
          style={{
            fontWeight: 400,
            color: "var(--c-steel-300)",
            fontSize: "var(--text-body-sm)",
            marginLeft: 8,
            fontFamily: "var(--font-mono)",
          }}
        >
          (from orchestrator.yml)
        </span>
      </h2>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Execution Profiles */}
        <ConfigSection
          title="Execution Profiles"
          editable
          isEditing={editingSection === "executors"}
          onEdit={() => startEdit("executors")}
          onSave={handleSave}
          onCancel={cancelEdit}
          saving={saving}
        >
          {editingSection === "executors" ? (
            <ExecutorsEditForm
              form={sectionForm as unknown as OrchestratorConfigView["executors"]}
              onChange={setSectionForm}
            />
          ) : (
            <>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--c-steel-300)",
                  marginBottom: 10,
                }}
              >
                Defaults: planner={config.executors.defaults.planner}, executor=
                {config.executors.defaults.executor}, reviewer=
                {config.executors.defaults.reviewer}
              </div>
              {Object.entries(config.executors.profiles).map(([name, profile]) => (
                <div
                  key={name}
                  style={{
                    background: "var(--surface-0)",
                    border: "1px solid var(--hairline)",
                    borderRadius: "var(--radius-sm)",
                    padding: 12,
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--font-display)",
                      fontWeight: 700,
                      fontSize: "var(--text-body-sm)",
                      color: "var(--c-blue-200)",
                      marginBottom: 6,
                    }}
                  >
                    {name}
                  </div>
                  <div
                    className="grid grid-cols-2 sm:grid-cols-3"
                    style={{ columnGap: 16, rowGap: 4, fontSize: 11 }}
                  >
                    <KV label="Model" value={profile.model} />
                    <KV label="Driver" value={profile.driver} />
                    <KV label="Base URL" value={profile.base_url} />
                    <KV label="Temperature" value={String(profile.temperature)} />
                    <KV label="Max Actions" value={String(profile.max_actions)} />
                    <KV label="Timeout" value={`${profile.timeout_seconds}s`} />
                    <KV label="API Key Env" value={profile.api_key_env} />
                  </div>
                </div>
              ))}
            </>
          )}
        </ConfigSection>

        {/* Workflow */}
        <ConfigSection
          title="Workflow"
          editable
          isEditing={editingSection === "workflow"}
          onEdit={() => startEdit("workflow")}
          onSave={handleSave}
          onCancel={cancelEdit}
          saving={saving}
        >
          {editingSection === "workflow" ? (
            <div
              className="grid grid-cols-2"
              style={{ columnGap: 16, rowGap: 12, fontSize: 11 }}
            >
              <Checkbox
                name="require_plan_approval"
                label="Require Plan Approval"
                checked={
                  (sectionForm as Record<string, unknown>).require_plan_approval as boolean
                }
                onChange={(e) =>
                  updateField("require_plan_approval", e.target.checked)
                }
              />
              <Checkbox
                name="require_publish_approval"
                label="Require Publish Approval"
                checked={
                  (sectionForm as Record<string, unknown>).require_publish_approval as boolean
                }
                onChange={(e) =>
                  updateField("require_publish_approval", e.target.checked)
                }
              />
            </div>
          ) : (
            <div
              className="grid grid-cols-2"
              style={{ columnGap: 16, rowGap: 4, fontSize: 11 }}
            >
              <KV label="Mode" value={config.workflow.mode} />
              <BoolKV
                label="Require Plan Approval"
                value={config.workflow.require_plan_approval}
              />
              <BoolKV
                label="Require Publish Approval"
                value={config.workflow.require_publish_approval}
              />
            </div>
          )}
        </ConfigSection>

        {/* Policy */}
        <ConfigSection
          title="Policy"
          editable
          isEditing={editingSection === "policy"}
          onEdit={() => startEdit("policy")}
          onSave={handleSave}
          onCancel={cancelEdit}
          saving={saving}
        >
          {editingSection === "policy" ? (
            <PolicyEditForm
              form={sectionForm as Record<string, unknown>}
              updateField={updateField}
            />
          ) : (
            <div
              className="grid grid-cols-2"
              style={{ columnGap: 16, rowGap: 4, fontSize: 11 }}
            >
              <KV label="Assignee" value={config.policy.assignee} />
              <KV label="Required Status" value={config.policy.required_status} />
              <KV label="Required Label" value={config.policy.required_label} />
              <KV
                label="Allowed Types"
                value={config.policy.allowed_issue_types.join(", ")}
              />
              <KV
                label="Max Changed Files"
                value={String(config.policy.max_changed_files)}
              />
              <KV
                label="Max Changed Lines"
                value={String(config.policy.max_changed_lines)}
              />
              <KV
                label="Min Description Length"
                value={String(config.policy.description_min_length)}
              />
            </div>
          )}
        </ConfigSection>

        {/* Sandbox (read-only) */}
        <ConfigSection title="Sandbox" subtitle="read-only — requires restart">
          <div
            className="grid grid-cols-2"
            style={{ columnGap: 16, rowGap: 4, fontSize: 11 }}
          >
            <KV label="Image" value={config.sandbox.image} />
            <KV label="Network" value={config.sandbox.network} />
            <KV label="Shell" value={config.sandbox.shell} />
            <KV label="Memory" value={`${config.sandbox.memory_limit_mb} MB`} />
            <KV label="CPUs" value={config.sandbox.cpus} />
            <KV label="PID Limit" value={String(config.sandbox.pids_limit)} />
            <BoolKV
              label="Read-only Rootfs"
              value={config.sandbox.read_only_rootfs}
            />
            <BoolKV
              label="No New Privileges"
              value={config.sandbox.no_new_privileges}
            />
          </div>
        </ConfigSection>

        {/* Worker */}
        <ConfigSection
          title="Worker"
          editable
          isEditing={editingSection === "worker"}
          onEdit={() => startEdit("worker")}
          onSave={handleSave}
          onCancel={cancelEdit}
          saving={saving}
        >
          {editingSection === "worker" ? (
            <div
              className="grid grid-cols-2"
              style={{ columnGap: 16, rowGap: 12 }}
            >
              <Input
                name="poll_interval_seconds"
                label="Poll Interval (seconds)"
                type="number"
                inputMode="numeric"
                value={
                  (sectionForm as Record<string, unknown>).poll_interval_seconds as number
                }
                onChange={(e) =>
                  updateField("poll_interval_seconds", Number(e.target.value))
                }
              />
              <Input
                name="lease_ttl_seconds"
                label="Lease TTL (seconds)"
                type="number"
                inputMode="numeric"
                value={
                  (sectionForm as Record<string, unknown>).lease_ttl_seconds as number
                }
                onChange={(e) =>
                  updateField("lease_ttl_seconds", Number(e.target.value))
                }
              />
              <Input
                name="max_agent_steps"
                label="Max Agent Steps"
                type="number"
                inputMode="numeric"
                value={
                  (sectionForm as Record<string, unknown>).max_agent_steps as number
                }
                onChange={(e) =>
                  updateField("max_agent_steps", Number(e.target.value))
                }
              />
              <Input
                name="max_run_seconds"
                label="Max Run Seconds"
                type="number"
                inputMode="numeric"
                value={
                  (sectionForm as Record<string, unknown>).max_run_seconds as number
                }
                onChange={(e) =>
                  updateField("max_run_seconds", Number(e.target.value))
                }
              />
              <Input
                name="human_input_timeout_hours"
                label="Human Input Timeout (hours)"
                type="number"
                inputMode="numeric"
                value={
                  (sectionForm as Record<string, unknown>).human_input_timeout_hours as number
                }
                onChange={(e) =>
                  updateField("human_input_timeout_hours", Number(e.target.value))
                }
              />
            </div>
          ) : (
            <div
              className="grid grid-cols-2"
              style={{ columnGap: 16, rowGap: 4, fontSize: 11 }}
            >
              <KV
                label="Poll Interval"
                value={`${config.worker.poll_interval_seconds}s`}
              />
              <KV
                label="Lease TTL"
                value={`${config.worker.lease_ttl_seconds}s`}
              />
              <KV
                label="Max Agent Steps"
                value={String(config.worker.max_agent_steps)}
              />
              <KV
                label="Max Run Seconds"
                value={`${config.worker.max_run_seconds}s`}
              />
              <KV
                label="Human Input Timeout"
                value={`${config.worker.human_input_timeout_hours}h`}
              />
            </div>
          )}
        </ConfigSection>

        {/* Defaults */}
        <ConfigSection
          title="Default Commands"
          editable
          isEditing={editingSection === "defaults"}
          onEdit={() => startEdit("defaults")}
          onSave={handleSave}
          onCancel={cancelEdit}
          saving={saving}
        >
          {editingSection === "defaults" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Textarea
                name="allowed_commands"
                label="Allowed Commands (one per line)"
                value={(
                  (sectionForm as Record<string, unknown>).allowed_commands as string[]
                ).join("\n")}
                onChange={(e) =>
                  updateField("allowed_commands", splitLines(e.target.value))
                }
                spellCheck={false}
                rows={3}
              />
              <Textarea
                name="validation_commands"
                label="Validation Commands (one per line)"
                value={(
                  (sectionForm as Record<string, unknown>).validation_commands as string[]
                ).join("\n")}
                onChange={(e) =>
                  updateField("validation_commands", splitLines(e.target.value))
                }
                spellCheck={false}
                rows={3}
              />
            </div>
          ) : (
            <div style={{ fontSize: 11 }}>
              <CommandPills
                label="Allowed Commands"
                commands={config.defaults.allowed_commands}
              />
              <CommandPills
                label="Validation Commands"
                commands={config.defaults.validation_commands}
              />
            </div>
          )}
        </ConfigSection>

        {/* Git & Routing */}
        <ConfigSection
          title="Git & Routing"
          editable
          isEditing={editingSection === "git" || editingSection === "routing"}
          onEdit={() => startEdit("git")}
          onSave={async () => {
            if (!config) return;
            setSaving(true);
            try {
              const updated = await updateConfig({
                git: sectionForm as OrchestratorConfigView["git"],
                routing: (sectionForm as Record<string, unknown>)
                  ._routing as OrchestratorConfigView["routing"] | undefined,
              });
              setConfig(updated);
              setEditingSection(null);
              setSectionForm({});
              toast.success("Configuration saved");
            } catch (e) {
              toast.error(
                "Failed to save: " + (e instanceof Error ? e.message : e),
              );
            } finally {
              setSaving(false);
            }
          }}
          onCancel={cancelEdit}
          saving={saving}
        >
          {editingSection === "git" ? (
            <div
              className="grid grid-cols-2"
              style={{ columnGap: 16, rowGap: 12 }}
            >
              <Input
                name="branch_prefix"
                label="Branch Prefix"
                value={(sectionForm as Record<string, unknown>).branch_prefix as string}
                onChange={(e) => updateField("branch_prefix", e.target.value)}
              />
              <Input
                name="default_repository"
                label="Default Repository"
                value={
                  (((sectionForm as Record<string, unknown>)._routing as Record<string, unknown> | undefined)?.default_repository as string) ??
                  config.routing.default_repository ??
                  ""
                }
                onChange={(e) =>
                  updateField("_routing", {
                    default_repository: e.target.value || null,
                  })
                }
                placeholder="none"
              />
            </div>
          ) : (
            <div
              className="grid grid-cols-2"
              style={{ columnGap: 16, rowGap: 4, fontSize: 11 }}
            >
              <KV label="Branch Prefix" value={config.git.branch_prefix} />
              <KV
                label="Default Repository"
                value={config.routing.default_repository || "none"}
              />
            </div>
          )}
        </ConfigSection>
      </div>
    </div>
  );
}

// === Sub-components ===

function ConfigSection({
  title,
  subtitle,
  editable,
  isEditing,
  onEdit,
  onSave,
  onCancel,
  saving,
  children,
}: {
  title: string;
  subtitle?: string;
  editable?: boolean;
  isEditing?: boolean;
  onEdit?: () => void;
  onSave?: () => void;
  onCancel?: () => void;
  saving?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card tone="default" padding={4}>
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 12 }}
      >
        <div className="flex items-center" style={{ gap: 8 }}>
          <h3
            style={{
              fontSize: "var(--text-label-md)",
              fontWeight: 700,
              color: "var(--c-fog-300)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {title}
          </h3>
          {subtitle && (
            <span
              style={{
                fontSize: 9,
                color: "var(--c-steel-300)",
                fontFamily: "var(--font-mono)",
              }}
            >
              ({subtitle})
            </span>
          )}
        </div>
        {editable && !isEditing && (
          <Button size="xs" variant="secondary" onClick={onEdit}>
            Edit
          </Button>
        )}
        {isEditing && (
          <div className="flex" style={{ gap: 4 }}>
            <Button
              size="xs"
              variant="primary"
              onClick={onSave}
              disabled={saving}
              isLoading={saving}
            >
              {saving ? "Saving" : "Save"}
            </Button>
            <Button
              size="xs"
              variant="secondary"
              onClick={onCancel}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
      {children}
    </Card>
  );
}

function PolicyEditForm({
  form,
  updateField,
}: {
  form: Record<string, unknown>;
  updateField: (key: string, value: unknown) => void;
}) {
  return (
    <div className="grid grid-cols-2" style={{ columnGap: 16, rowGap: 12 }}>
      <Input
        name="assignee"
        label="Assignee"
        value={form.assignee as string}
        onChange={(e) => updateField("assignee", e.target.value)}
      />
      <Input
        name="required_status"
        label="Required Status"
        value={form.required_status as string}
        onChange={(e) => updateField("required_status", e.target.value)}
      />
      <Input
        name="required_label"
        label="Required Label"
        value={form.required_label as string}
        onChange={(e) => updateField("required_label", e.target.value)}
      />
      <Input
        name="allowed_issue_types"
        label="Allowed Issue Types (comma-separated)"
        value={(form.allowed_issue_types as string[]).join(", ")}
        onChange={(e) =>
          updateField(
            "allowed_issue_types",
            e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
      />
      <Input
        name="max_changed_files"
        label="Max Changed Files"
        type="number"
        inputMode="numeric"
        value={form.max_changed_files as number}
        onChange={(e) => updateField("max_changed_files", Number(e.target.value))}
      />
      <Input
        name="max_changed_lines"
        label="Max Changed Lines"
        type="number"
        inputMode="numeric"
        value={form.max_changed_lines as number}
        onChange={(e) => updateField("max_changed_lines", Number(e.target.value))}
      />
      <Input
        name="description_min_length"
        label="Min Description Length"
        type="number"
        inputMode="numeric"
        value={form.description_min_length as number}
        onChange={(e) =>
          updateField("description_min_length", Number(e.target.value))
        }
      />
    </div>
  );
}

function ExecutorsEditForm({
  form,
  onChange,
}: {
  form: OrchestratorConfigView["executors"];
  onChange: (value: Record<string, unknown>) => void;
}) {
  const profileNames = Object.keys(form.profiles);

  const updateDefaults = (key: string, value: string) => {
    onChange({
      ...form,
      defaults: { ...form.defaults, [key]: value },
    });
  };

  const updateProfile = (name: string, key: string, value: unknown) => {
    onChange({
      ...form,
      profiles: {
        ...form.profiles,
        [name]: { ...form.profiles[name], [key]: value },
      },
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="grid grid-cols-3" style={{ columnGap: 16, rowGap: 12 }}>
        <FieldGroup label="Default Planner">
          <select
            name="defaults.planner"
            value={form.defaults.planner}
            onChange={(e) => updateDefaults("planner", e.target.value)}
            style={selectStyle}
          >
            {profileNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </FieldGroup>
        <FieldGroup label="Default Executor">
          <select
            name="defaults.executor"
            value={form.defaults.executor}
            onChange={(e) => updateDefaults("executor", e.target.value)}
            style={selectStyle}
          >
            {profileNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </FieldGroup>
        <FieldGroup label="Default Reviewer">
          <select
            name="defaults.reviewer"
            value={form.defaults.reviewer}
            onChange={(e) => updateDefaults("reviewer", e.target.value)}
            style={selectStyle}
          >
            {profileNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </FieldGroup>
      </div>
      {Object.entries(form.profiles).map(([name, profile]) => (
        <ProfileEditCard
          key={name}
          name={name}
          profile={profile}
          onUpdate={(k, v) => updateProfile(name, k, v)}
        />
      ))}
    </div>
  );
}

function ModelSearchSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchOpenRouterModels()
      .then(setModels)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const filtered =
    query.trim().length > 0
      ? models
          .filter(
            (m) =>
              m.id.toLowerCase().includes(query.toLowerCase()) ||
              m.name.toLowerCase().includes(query.toLowerCase()),
          )
          .slice(0, 30)
      : models.slice(0, 30);

  return (
    <div style={{ position: "relative" }}>
      <Input
        name="model"
        value={query}
        placeholder={loading ? "Loading models…" : "Search or type model ID…"}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          closeTimer.current = setTimeout(() => setOpen(false), 150);
        }}
        autoComplete="off"
        spellCheck={false}
      />
      {open && filtered.length > 0 && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            zIndex: 10,
            width: "100%",
            background: "var(--surface-1)",
            border: "1px solid var(--hairline)",
            borderRadius: "var(--radius-sm)",
            marginTop: 2,
            maxHeight: 192,
            overflowY: "auto",
            fontSize: "var(--text-body-sm)",
            boxShadow: "var(--glow-blue), 0 12px 24px rgba(0, 0, 0, 0.4)",
          }}
        >
          {filtered.map((m) => (
            <div
              key={m.id}
              role="option"
              aria-selected={query === m.id}
              tabIndex={0}
              style={{
                padding: "6px 12px",
                cursor: "pointer",
                transition: "background var(--dur-fast) var(--ease-out)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--surface-2)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
              onMouseDown={() => {
                if (closeTimer.current) clearTimeout(closeTimer.current);
                onChange(m.id);
                setQuery(m.id);
                setOpen(false);
              }}
            >
              <span style={{ color: "var(--c-bone)" }}>{m.id}</span>
              {m.name !== m.id && (
                <span
                  style={{
                    marginLeft: 8,
                    color: "var(--c-steel-300)",
                    fontSize: 10,
                  }}
                >
                  {m.name}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProfileEditCard({
  name,
  profile,
  onUpdate,
}: {
  name: string;
  profile: ExecutorProfile;
  onUpdate: (key: string, value: unknown) => void;
}) {
  return (
    <div
      style={{
        background: "var(--surface-0)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius-sm)",
        padding: 12,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: "var(--text-body-sm)",
          color: "var(--c-blue-200)",
          marginBottom: 10,
        }}
      >
        {name}
      </div>
      <div
        className="grid grid-cols-2 sm:grid-cols-3"
        style={{ columnGap: 16, rowGap: 12 }}
      >
        <FieldGroup label="Model">
          <ModelSearchSelect
            value={profile.model}
            onChange={(v) => onUpdate("model", v)}
          />
        </FieldGroup>
        <Input
          name="base_url"
          label="Base URL"
          value={profile.base_url}
          onChange={(e) => onUpdate("base_url", e.target.value)}
        />
        <Input
          name="api_key_env"
          label="API Key Env"
          value={profile.api_key_env}
          onChange={(e) => onUpdate("api_key_env", e.target.value)}
        />
        <Input
          name="temperature"
          label="Temperature"
          type="number"
          step="0.1"
          min="0"
          max="2"
          value={profile.temperature}
          onChange={(e) => onUpdate("temperature", Number(e.target.value))}
        />
        <Input
          name="max_actions"
          label="Max Actions"
          type="number"
          inputMode="numeric"
          value={profile.max_actions}
          onChange={(e) => onUpdate("max_actions", Number(e.target.value))}
        />
        <Input
          name="timeout_seconds"
          label="Timeout (seconds)"
          type="number"
          inputMode="numeric"
          value={profile.timeout_seconds}
          onChange={(e) => onUpdate("timeout_seconds", Number(e.target.value))}
        />
        <Input
          name="thinking_budget_tokens"
          label="Thinking Budget (tokens)"
          type="number"
          inputMode="numeric"
          value={profile.thinking_budget_tokens ?? 5000}
          onChange={(e) =>
            onUpdate("thinking_budget_tokens", Number(e.target.value))
          }
        />
      </div>
      <div style={{ marginTop: 10 }}>
        <Checkbox
          name="thinking_enabled"
          label="Enable thinking tokens (Claude / o-series models only)"
          checked={profile.thinking_enabled ?? false}
          onChange={(e) => onUpdate("thinking_enabled", e.target.checked)}
        />
      </div>
    </div>
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

function KV({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span style={{ color: "var(--c-fog-300)" }}>{label}</span>
      <span
        style={{
          color: "var(--c-fog-100)",
          fontFamily: "var(--font-mono)",
        }}
      >
        {value}
      </span>
    </>
  );
}

function BoolKV({ label, value }: { label: string; value: boolean }) {
  return (
    <>
      <span style={{ color: "var(--c-fog-300)" }}>{label}</span>
      <span
        style={{
          color: value ? "var(--c-success-fg)" : "var(--c-error-fg)",
          fontWeight: 600,
        }}
      >
        {value ? "yes" : "no"}
      </span>
    </>
  );
}

function CommandPills({
  label,
  commands,
}: {
  label: string;
  commands: string[];
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <span style={{ color: "var(--c-fog-300)" }}>{label}:</span>
      {commands.length > 0 ? (
        <div
          className="flex flex-wrap"
          style={{ gap: 4, marginTop: 6 }}
        >
          {commands.map((cmd, i) => (
            <Badge key={i} tone="neutral" size="sm">
              {cmd}
            </Badge>
          ))}
        </div>
      ) : (
        <span style={{ color: "var(--c-steel-300)", marginLeft: 6 }}>none</span>
      )}
    </div>
  );
}
