import { useEffect, useRef, useState } from "react";
import type { OrchestratorConfigView, ExecutorProfile } from "../types";
import { fetchConfig, updateConfig, fetchOpenRouterModels, type OpenRouterModel } from "../api/client";
import { useToast } from "../context/ToastContext";
import { splitLines } from "../lib/format";

type SectionKey = "workflow" | "policy" | "worker" | "defaults" | "routing" | "git" | "executors";

const inputClass =
  "w-full bg-[var(--color-base-100)] border border-[var(--border-color)] rounded-[var(--rounded-box)] text-[var(--color-base-content)] px-2.5 py-1.5 text-xs font-[inherit] outline-none focus:border-[#58a6ff]";

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
      .catch((e) => toast.error("Failed to load config: " + (e instanceof Error ? e.message : e)))
      .finally(() => setLoading(false));
  }, [toast]);

  const startEdit = (key: SectionKey) => {
    if (!config) return;
    // Deep clone the section data for the form
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
      const updated = await updateConfig({ [editingSection]: sectionForm } as Partial<OrchestratorConfigView>);
      setConfig(updated);
      setEditingSection(null);
      setSectionForm({});
      toast.success("Configuration saved");
    } catch (e) {
      toast.error("Failed to save: " + (e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  };

  const updateField = (key: string, value: unknown) => {
    setSectionForm((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div className="p-5 max-w-4xl space-y-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] p-4 space-y-3">
            <div className="animate-pulse rounded bg-[var(--color-base-300)] h-4 w-1/4 mb-2" />
            <div className="space-y-2">
              <div className="flex gap-3"><div className="animate-pulse rounded bg-[var(--color-base-300)] h-3 w-1/5" /><div className="animate-pulse rounded bg-[var(--color-base-300)] h-3 w-2/5" /></div>
              <div className="flex gap-3"><div className="animate-pulse rounded bg-[var(--color-base-300)] h-3 w-1/5" /><div className="animate-pulse rounded bg-[var(--color-base-300)] h-3 w-1/3" /></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!config) {
    return <div className="p-8 text-center text-[var(--fg3)] text-sm">Failed to load configuration.</div>;
  }

  return (
    <div className="p-5 max-w-4xl">
      <h2 className="text-sm font-semibold text-[var(--color-base-content)] mb-5">
        Configuration
        <span className="font-normal text-[var(--fg3)] text-xs ml-2">(from orchestrator.yml)</span>
      </h2>

      <div className="flex flex-col gap-4">
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
              <div className="text-[10px] text-[var(--fg3)] mb-2">
                Defaults: planner={config.executors.defaults.planner}, executor={config.executors.defaults.executor}, reviewer={config.executors.defaults.reviewer}
              </div>
              {Object.entries(config.executors.profiles).map(([name, profile]) => (
                <div key={name} className="bg-[var(--color-base-100)] rounded-[var(--rounded-box)] p-3 mb-2">
                  <div className="font-semibold text-xs text-[#58a6ff] mb-1">{name}</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-[11px]">
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
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-[11px]">
              <CheckField
                label="Require Plan Approval"
                checked={(sectionForm as Record<string, unknown>).require_plan_approval as boolean}
                onChange={(v) => updateField("require_plan_approval", v)}
              />
              <CheckField
                label="Require Publish Approval"
                checked={(sectionForm as Record<string, unknown>).require_publish_approval as boolean}
                onChange={(v) => updateField("require_publish_approval", v)}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              <KV label="Mode" value={config.workflow.mode} />
              <BoolKV label="Require Plan Approval" value={config.workflow.require_plan_approval} />
              <BoolKV label="Require Publish Approval" value={config.workflow.require_publish_approval} />
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
            <PolicyEditForm form={sectionForm as Record<string, unknown>} updateField={updateField} />
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              <KV label="Assignee" value={config.policy.assignee} />
              <KV label="Required Status" value={config.policy.required_status} />
              <KV label="Required Label" value={config.policy.required_label} />
              <KV label="Allowed Types" value={config.policy.allowed_issue_types.join(", ")} />
              <KV label="Max Changed Files" value={String(config.policy.max_changed_files)} />
              <KV label="Max Changed Lines" value={String(config.policy.max_changed_lines)} />
              <KV label="Min Description Length" value={String(config.policy.description_min_length)} />
            </div>
          )}
        </ConfigSection>

        {/* Sandbox (read-only) */}
        <ConfigSection title="Sandbox" subtitle="read-only — requires restart">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <KV label="Image" value={config.sandbox.image} />
            <KV label="Network" value={config.sandbox.network} />
            <KV label="Shell" value={config.sandbox.shell} />
            <KV label="Memory" value={`${config.sandbox.memory_limit_mb} MB`} />
            <KV label="CPUs" value={config.sandbox.cpus} />
            <KV label="PID Limit" value={String(config.sandbox.pids_limit)} />
            <BoolKV label="Read-only Rootfs" value={config.sandbox.read_only_rootfs} />
            <BoolKV label="No New Privileges" value={config.sandbox.no_new_privileges} />
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
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-[11px]">
              <Field label="Poll Interval (seconds)">
                <input type="number" className={inputClass} value={(sectionForm as Record<string, unknown>).poll_interval_seconds as number} onChange={(e) => updateField("poll_interval_seconds", Number(e.target.value))} />
              </Field>
              <Field label="Lease TTL (seconds)">
                <input type="number" className={inputClass} value={(sectionForm as Record<string, unknown>).lease_ttl_seconds as number} onChange={(e) => updateField("lease_ttl_seconds", Number(e.target.value))} />
              </Field>
              <Field label="Max Agent Steps">
                <input type="number" className={inputClass} value={(sectionForm as Record<string, unknown>).max_agent_steps as number} onChange={(e) => updateField("max_agent_steps", Number(e.target.value))} />
              </Field>
              <Field label="Max Run Seconds">
                <input type="number" className={inputClass} value={(sectionForm as Record<string, unknown>).max_run_seconds as number} onChange={(e) => updateField("max_run_seconds", Number(e.target.value))} />
              </Field>
              <Field label="Human Input Timeout (hours)">
                <input type="number" className={inputClass} value={(sectionForm as Record<string, unknown>).human_input_timeout_hours as number} onChange={(e) => updateField("human_input_timeout_hours", Number(e.target.value))} />
              </Field>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              <KV label="Poll Interval" value={`${config.worker.poll_interval_seconds}s`} />
              <KV label="Lease TTL" value={`${config.worker.lease_ttl_seconds}s`} />
              <KV label="Max Agent Steps" value={String(config.worker.max_agent_steps)} />
              <KV label="Max Run Seconds" value={`${config.worker.max_run_seconds}s`} />
              <KV label="Human Input Timeout" value={`${config.worker.human_input_timeout_hours}h`} />
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
            <div className="flex flex-col gap-3 text-[11px]">
              <Field label="Allowed Commands (one per line)">
                <textarea
                  className={inputClass + " min-h-[60px] resize-y"}
                  value={((sectionForm as Record<string, unknown>).allowed_commands as string[]).join("\n")}
                  onChange={(e) => updateField("allowed_commands", splitLines(e.target.value))}
                />
              </Field>
              <Field label="Validation Commands (one per line)">
                <textarea
                  className={inputClass + " min-h-[60px] resize-y"}
                  value={((sectionForm as Record<string, unknown>).validation_commands as string[]).join("\n")}
                  onChange={(e) => updateField("validation_commands", splitLines(e.target.value))}
                />
              </Field>
            </div>
          ) : (
            <div className="text-[11px]">
              <div className="mb-2">
                <span className="text-[var(--fg2)]">Allowed Commands:</span>
                {config.defaults.allowed_commands.length > 0 ? (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {config.defaults.allowed_commands.map((cmd, i) => (
                      <span key={i} className="px-1.5 py-0.5 bg-[var(--color-base-100)] rounded text-[10px] text-[var(--fg2)]">{cmd}</span>
                    ))}
                  </div>
                ) : (
                  <span className="text-[var(--fg3)] ml-1">none</span>
                )}
              </div>
              <div>
                <span className="text-[var(--fg2)]">Validation Commands:</span>
                {config.defaults.validation_commands.length > 0 ? (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {config.defaults.validation_commands.map((cmd, i) => (
                      <span key={i} className="px-1.5 py-0.5 bg-[var(--color-base-100)] rounded text-[10px] text-[var(--fg2)]">{cmd}</span>
                    ))}
                  </div>
                ) : (
                  <span className="text-[var(--fg3)] ml-1">none</span>
                )}
              </div>
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
                routing: (sectionForm as Record<string, unknown>)._routing as OrchestratorConfigView["routing"] | undefined,
              });
              setConfig(updated);
              setEditingSection(null);
              setSectionForm({});
              toast.success("Configuration saved");
            } catch (e) {
              toast.error("Failed to save: " + (e instanceof Error ? e.message : e));
            } finally {
              setSaving(false);
            }
          }}
          onCancel={cancelEdit}
          saving={saving}
        >
          {editingSection === "git" ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-[11px]">
              <Field label="Branch Prefix">
                <input className={inputClass} value={(sectionForm as Record<string, unknown>).branch_prefix as string} onChange={(e) => updateField("branch_prefix", e.target.value)} />
              </Field>
              <Field label="Default Repository">
                <input className={inputClass} value={((sectionForm as Record<string, unknown>)._routing as Record<string, unknown> | undefined)?.default_repository as string ?? config.routing.default_repository ?? ""} onChange={(e) => updateField("_routing", { default_repository: e.target.value || null })} placeholder="none" />
              </Field>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              <KV label="Branch Prefix" value={config.git.branch_prefix} />
              <KV label="Default Repository" value={config.routing.default_repository || "none"} />
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
    <div className="bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-[11px] font-semibold text-[var(--fg2)] uppercase tracking-wide">{title}</h3>
          {subtitle && (
            <span className="text-[9px] text-[var(--fg3)]">({subtitle})</span>
          )}
        </div>
        {editable && !isEditing && (
          <button className="btn-default" style={{ padding: "2px 8px", fontSize: "10px" }} onClick={onEdit}>
            Edit
          </button>
        )}
        {isEditing && (
          <div className="flex gap-1">
            <button className="btn-primary" style={{ padding: "2px 8px", fontSize: "10px" }} onClick={onSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
            <button className="btn-default" style={{ padding: "2px 8px", fontSize: "10px" }} onClick={onCancel} disabled={saving}>
              Cancel
            </button>
          </div>
        )}
      </div>
      {children}
    </div>
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
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-[11px]">
      <Field label="Assignee">
        <input className={inputClass} value={form.assignee as string} onChange={(e) => updateField("assignee", e.target.value)} />
      </Field>
      <Field label="Required Status">
        <input className={inputClass} value={form.required_status as string} onChange={(e) => updateField("required_status", e.target.value)} />
      </Field>
      <Field label="Required Label">
        <input className={inputClass} value={form.required_label as string} onChange={(e) => updateField("required_label", e.target.value)} />
      </Field>
      <Field label="Allowed Issue Types (comma-separated)">
        <input
          className={inputClass}
          value={(form.allowed_issue_types as string[]).join(", ")}
          onChange={(e) => updateField("allowed_issue_types", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
        />
      </Field>
      <Field label="Max Changed Files">
        <input type="number" className={inputClass} value={form.max_changed_files as number} onChange={(e) => updateField("max_changed_files", Number(e.target.value))} />
      </Field>
      <Field label="Max Changed Lines">
        <input type="number" className={inputClass} value={form.max_changed_lines as number} onChange={(e) => updateField("max_changed_lines", Number(e.target.value))} />
      </Field>
      <Field label="Min Description Length">
        <input type="number" className={inputClass} value={form.description_min_length as number} onChange={(e) => updateField("description_min_length", Number(e.target.value))} />
      </Field>
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
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-x-4 gap-y-3 text-[11px]">
        <Field label="Default Planner">
          <select className={inputClass} value={form.defaults.planner} onChange={(e) => updateDefaults("planner", e.target.value)}>
            {profileNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="Default Executor">
          <select className={inputClass} value={form.defaults.executor} onChange={(e) => updateDefaults("executor", e.target.value)}>
            {profileNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="Default Reviewer">
          <select className={inputClass} value={form.defaults.reviewer} onChange={(e) => updateDefaults("reviewer", e.target.value)}>
            {profileNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
      </div>
      {Object.entries(form.profiles).map(([name, profile]) => (
        <ProfileEditCard key={name} name={name} profile={profile} onUpdate={(k, v) => updateProfile(name, k, v)} />
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

  // Sync query when value changes externally
  useEffect(() => {
    setQuery(value);
  }, [value]);

  const filtered = query.trim().length > 0
    ? models
        .filter((m) =>
          m.id.toLowerCase().includes(query.toLowerCase()) ||
          m.name.toLowerCase().includes(query.toLowerCase()),
        )
        .slice(0, 30)
    : models.slice(0, 30);

  return (
    <div className="relative">
      <input
        className={inputClass}
        value={query}
        placeholder={loading ? "Loading models..." : "Search or type model ID..."}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { closeTimer.current = setTimeout(() => setOpen(false), 150); }}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-10 w-full bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] mt-0.5 max-h-48 overflow-y-auto text-xs shadow-lg">
          {filtered.map((m) => (
            <div
              key={m.id}
              className="px-3 py-1.5 hover:bg-[var(--color-base-300)] cursor-pointer"
              onMouseDown={() => {
                if (closeTimer.current) clearTimeout(closeTimer.current);
                onChange(m.id);
                setQuery(m.id);
                setOpen(false);
              }}
            >
              <span className="text-[#e6edf3]">{m.id}</span>
              {m.name !== m.id && (
                <span className="ml-2 text-[var(--fg3)] text-[10px]">{m.name}</span>
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
    <div className="bg-[var(--color-base-100)] rounded-[var(--rounded-box)] p-3">
      <div className="font-semibold text-xs text-[#58a6ff] mb-2">{name}</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-[11px]">
        <Field label="Model">
          <ModelSearchSelect value={profile.model} onChange={(v) => onUpdate("model", v)} />
        </Field>
        <Field label="Base URL">
          <input className={inputClass} value={profile.base_url} onChange={(e) => onUpdate("base_url", e.target.value)} />
        </Field>
        <Field label="API Key Env">
          <input className={inputClass} value={profile.api_key_env} onChange={(e) => onUpdate("api_key_env", e.target.value)} />
        </Field>
        <Field label="Temperature">
          <input type="number" step="0.1" min="0" max="2" className={inputClass} value={profile.temperature} onChange={(e) => onUpdate("temperature", Number(e.target.value))} />
        </Field>
        <Field label="Max Actions">
          <input type="number" className={inputClass} value={profile.max_actions} onChange={(e) => onUpdate("max_actions", Number(e.target.value))} />
        </Field>
        <Field label="Timeout (seconds)">
          <input type="number" className={inputClass} value={profile.timeout_seconds} onChange={(e) => onUpdate("timeout_seconds", Number(e.target.value))} />
        </Field>
        <Field label="Thinking Budget (tokens)">
          <input type="number" className={inputClass} value={profile.thinking_budget_tokens ?? 5000} onChange={(e) => onUpdate("thinking_budget_tokens", Number(e.target.value))} />
        </Field>
      </div>
      <div className="mt-2">
        <CheckField
          label="Enable thinking tokens (Claude / o-series models only)"
          checked={profile.thinking_enabled ?? false}
          onChange={(v) => onUpdate("thinking_enabled", v)}
        />
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

function KV({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-[var(--fg2)]">{label}</span>
      <span className="text-[var(--color-base-content)]">{value}</span>
    </>
  );
}

function BoolKV({ label, value }: { label: string; value: boolean }) {
  return (
    <>
      <span className="text-[var(--fg2)]">{label}</span>
      <span className={value ? "text-[#3fb950]" : "text-[#f85149]"}>
        {value ? "yes" : "no"}
      </span>
    </>
  );
}

function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-[var(--fg2)] cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[#58a6ff]" />
      {label}
    </label>
  );
}
