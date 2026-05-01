import { useCallback, useEffect, useState } from "react";
import { Clock } from "lucide-react";
import type { RunSchedule } from "../types";
import {
  fetchSchedules,
  createScheduleApi,
  updateScheduleApi,
  deleteScheduleApi,
  fireScheduleApi,
} from "../api/client";
import { useToast } from "../context/ToastContext";
import { formatRelativeTime } from "../lib/format";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Input, Checkbox } from "./ui/Input";
import { Modal, ModalTitle, ModalActions } from "./Modal";
import { ConfirmModal } from "./ConfirmModal";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type FormData = {
  label: string;
  ticketKey: string;
  recurrence: "once" | "daily" | "weekly";
  hour: string;
  minute: string;
  dayOfWeek: string;
  enabled: boolean;
};

const emptyForm: FormData = {
  label: "",
  ticketKey: "",
  recurrence: "once",
  hour: "9",
  minute: "0",
  dayOfWeek: "1",
  enabled: true,
};

function scheduleToForm(s: RunSchedule): FormData {
  return {
    label: s.label,
    ticketKey: s.ticketKey,
    recurrence: s.recurrence,
    hour: String(s.hour),
    minute: String(s.minute),
    dayOfWeek: s.dayOfWeek !== null ? String(s.dayOfWeek) : "1",
    enabled: s.enabled,
  };
}

function formatRecurrence(s: RunSchedule): string {
  const time = `${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`;
  if (s.recurrence === "once") return `Once at ${time}`;
  if (s.recurrence === "daily") return `Daily at ${time}`;
  if (s.recurrence === "weekly") {
    const day = s.dayOfWeek !== null ? DAY_NAMES[s.dayOfWeek] : "?";
    return `Weekly — ${day} at ${time}`;
  }
  return s.recurrence;
}

export function SchedulesView() {
  const [schedules, setSchedules] = useState<RunSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(() => {
    setLoading(true);
    fetchSchedules()
      .then(setSchedules)
      .catch((e: unknown) =>
        toast.error(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const setField = <K extends keyof FormData>(key: K, value: FormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleCreate = () => {
    setForm(emptyForm);
    setModalMode("create");
    setEditingId(null);
  };
  const handleEdit = (s: RunSchedule) => {
    setForm(scheduleToForm(s));
    setModalMode("edit");
    setEditingId(s.id);
  };

  const handleSubmit = async () => {
    const trimmedLabel = form.label.trim();
    const trimmedTicket = form.ticketKey.trim();
    if (!trimmedLabel) {
      toast.error("Label is required");
      return;
    }
    if (!trimmedTicket) {
      toast.error("Ticket key is required");
      return;
    }
    const hour = Number(form.hour);
    const minute = Number(form.minute);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      toast.error("Hour must be between 0 and 23");
      return;
    }
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
      toast.error("Minute must be between 0 and 59");
      return;
    }
    const payload = {
      label: trimmedLabel,
      ticketKey: trimmedTicket,
      recurrence: form.recurrence,
      hour,
      minute,
      dayOfWeek:
        form.recurrence === "weekly" ? Number(form.dayOfWeek) : undefined,
      enabled: form.enabled,
    };
    try {
      if (modalMode === "create") {
        await createScheduleApi(payload);
        toast.success("Schedule created");
      } else if (editingId) {
        await updateScheduleApi(editingId, payload);
        toast.success("Schedule updated");
      }
      setModalMode(null);
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteScheduleApi(deleteId);
      toast.success("Schedule deleted");
      setDeleteId(null);
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleFire = async (id: string) => {
    try {
      await fireScheduleApi(id);
      toast.success("Schedule fired — run created");
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleToggle = async (s: RunSchedule) => {
    try {
      await updateScheduleApi(s.id, { enabled: !s.enabled });
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div style={{ padding: 28, maxWidth: 960, margin: "0 auto" }}>
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 16 }}
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
          Scheduled Runs
        </h2>
        <Button variant="primary" onClick={handleCreate}>
          Add Schedule
        </Button>
      </div>

      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[1, 2].map((i) => (
            <div
              key={i}
              className="animate-pulse"
              style={{
                height: 56,
                background: "var(--surface-2)",
                borderRadius: "var(--radius-md)",
              }}
            />
          ))}
        </div>
      )}

      {!loading && schedules.length === 0 && (
        <Card tone="default" padding={6}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "16px",
              textAlign: "center",
            }}
          >
            <Clock
              size={32}
              strokeWidth={1.5}
              aria-hidden="true"
              style={{ color: "var(--c-steel-300)", marginBottom: 12 }}
            />
            <p
              style={{
                fontSize: "var(--text-body-sm)",
                color: "var(--c-fog-300)",
              }}
            >
              No schedules yet. Create one to auto-trigger runs.
            </p>
          </div>
        </Card>
      )}

      {!loading && schedules.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {schedules.map((s) => (
            <Card key={s.id} tone="default" padding={3}>
              <div className="flex items-center" style={{ gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className="flex items-center"
                    style={{ gap: 8, marginBottom: 4, flexWrap: "wrap" }}
                  >
                    <span
                      style={{
                        fontSize: "var(--text-body-sm)",
                        fontWeight: 700,
                        color: "var(--c-bone)",
                      }}
                    >
                      {s.label}
                    </span>
                    <span
                      style={{
                        fontSize: "var(--text-label-md)",
                        color: "var(--c-blue-200)",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {s.ticketKey}
                    </span>
                    {!s.enabled && (
                      <Badge tone="neutral" size="sm">
                        disabled
                      </Badge>
                    )}
                  </div>
                  <div
                    className="flex items-center flex-wrap"
                    style={{
                      gap: 12,
                      fontSize: "var(--text-label-md)",
                      color: "var(--c-fog-300)",
                    }}
                  >
                    <span>{formatRecurrence(s)}</span>
                    {s.nextRunAt && (
                      <span style={{ color: "var(--c-steel-300)" }}>
                        next: {formatRelativeTime(s.nextRunAt)}
                      </span>
                    )}
                    {s.lastRunAt && (
                      <span style={{ color: "var(--c-steel-300)" }}>
                        last: {formatRelativeTime(s.lastRunAt)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center shrink-0" style={{ gap: 4 }}>
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => handleFire(s.id)}
                    title="Fire this schedule now"
                    aria-label={`Fire schedule ${s.label} now`}
                  >
                    Fire now
                  </Button>
                  <Button
                    size="xs"
                    variant={s.enabled ? "secondary" : "primary"}
                    onClick={() => handleToggle(s)}
                    aria-label={`${s.enabled ? "Disable" : "Enable"} schedule ${s.label}`}
                  >
                    {s.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => handleEdit(s)}
                    aria-label={`Edit schedule ${s.label}`}
                  >
                    Edit
                  </Button>
                  <Button
                    size="xs"
                    variant="danger"
                    onClick={() => setDeleteId(s.id)}
                    aria-label={`Delete schedule ${s.label}`}
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
        <ScheduleFormModal
          mode={modalMode}
          form={form}
          setField={setField}
          onSubmit={handleSubmit}
          onClose={() => setModalMode(null)}
        />
      )}

      <ConfirmModal
        isOpen={deleteId !== null}
        title="Delete schedule?"
        body="This cannot be undone. The schedule will stop firing."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}

function ScheduleFormModal({
  mode,
  form,
  setField,
  onSubmit,
  onClose,
}: {
  mode: "create" | "edit";
  form: FormData;
  setField: <K extends keyof FormData>(key: K, value: FormData[K]) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <Modal isOpen onClose={onClose} labelledBy="schedule-form-title">
      <ModalTitle id="schedule-form-title">
        {mode === "create" ? "New Schedule" : "Edit Schedule"}
      </ModalTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Input
          name="label"
          label="Label"
          value={form.label}
          onChange={(e) => setField("label", e.target.value)}
          placeholder="Weekly maintenance"
          autoComplete="off"
        />
        <Input
          name="ticketKey"
          label="Ticket Key"
          value={form.ticketKey}
          onChange={(e) => setField("ticketKey", e.target.value.toUpperCase())}
          placeholder="PROJ-123"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="characters"
          style={{ fontFamily: "var(--font-mono)" }}
        />
        <FieldGroup label="Recurrence">
          <select
            name="recurrence"
            value={form.recurrence}
            onChange={(e) =>
              setField("recurrence", e.target.value as FormData["recurrence"])
            }
            style={selectStyle}
          >
            <option value="once">Once</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </FieldGroup>
        {form.recurrence === "weekly" && (
          <FieldGroup label="Day of Week">
            <select
              name="dayOfWeek"
              value={form.dayOfWeek}
              onChange={(e) => setField("dayOfWeek", e.target.value)}
              style={selectStyle}
            >
              {DAY_NAMES.map((d, i) => (
                <option key={i} value={String(i)}>
                  {d}
                </option>
              ))}
            </select>
          </FieldGroup>
        )}
        <div className="flex" style={{ gap: 12 }}>
          <Input
            name="hour"
            label="Hour (0–23)"
            type="number"
            inputMode="numeric"
            min={0}
            max={23}
            value={form.hour}
            onChange={(e) => setField("hour", e.target.value)}
          />
          <Input
            name="minute"
            label="Minute (0–59)"
            type="number"
            inputMode="numeric"
            min={0}
            max={59}
            value={form.minute}
            onChange={(e) => setField("minute", e.target.value)}
          />
        </div>
        <Checkbox
          name="enabled"
          label="Enabled"
          checked={form.enabled}
          onChange={(e) => setField("enabled", e.target.checked)}
        />
      </div>
      <ModalActions align="right">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!form.label || !form.ticketKey}
          onClick={onSubmit}
        >
          {mode === "create" ? "Create" : "Save"}
        </Button>
      </ModalActions>
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
