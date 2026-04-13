import { useCallback, useEffect, useRef, useState } from "react";
import type { RunSchedule } from "../types";
import {
  fetchSchedules,
  createScheduleApi,
  updateScheduleApi,
  deleteScheduleApi,
  fireScheduleApi,
} from "../api/client";
import { useToast } from "../context/ToastContext";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { formatRelativeTime } from "../lib/format";

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
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const setField = <K extends keyof FormData>(key: K, value: FormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleCreate = () => { setForm(emptyForm); setModalMode("create"); setEditingId(null); };
  const handleEdit = (s: RunSchedule) => { setForm(scheduleToForm(s)); setModalMode("edit"); setEditingId(s.id); };

  const handleSubmit = async () => {
    const payload = {
      label: form.label,
      ticketKey: form.ticketKey,
      recurrence: form.recurrence,
      hour: Number(form.hour),
      minute: Number(form.minute),
      dayOfWeek: form.recurrence === "weekly" ? Number(form.dayOfWeek) : undefined,
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
    <div className="p-5 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold">Scheduled Runs</h2>
        <button className="btn-primary" style={{ fontSize: "12px", padding: "5px 12px" }} onClick={handleCreate}>
          Add Schedule
        </button>
      </div>

      {loading && (
        <div className="flex flex-col gap-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-12 rounded bg-[var(--color-base-300)] animate-pulse" />
          ))}
        </div>
      )}

      {!loading && schedules.length === 0 && (
        <p className="text-[var(--fg3)] text-xs text-center py-8">No schedules yet. Create one to auto-trigger runs.</p>
      )}

      {!loading && schedules.length > 0 && (
        <div className="flex flex-col gap-2">
          {schedules.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 px-4 py-3 bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)]"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-semibold text-[var(--color-base-content)]">{s.label}</span>
                  <span className="text-[11px] text-[#58a6ff] font-mono">{s.ticketKey}</span>
                  {!s.enabled && (
                    <span className="text-[10px] text-[var(--fg3)] border border-[var(--border-color)] px-1 rounded">disabled</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-[var(--fg2)]">
                  <span>{formatRecurrence(s)}</span>
                  {s.nextRunAt && (
                    <span className="text-[var(--fg3)]">next: {formatRelativeTime(s.nextRunAt)}</span>
                  )}
                  {s.lastRunAt && (
                    <span className="text-[var(--fg3)]">last: {formatRelativeTime(s.lastRunAt)}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  className="btn-default"
                  style={{ fontSize: "11px", padding: "3px 8px" }}
                  onClick={() => handleFire(s.id)}
                  title="Fire now"
                >
                  Fire now
                </button>
                <button
                  className={s.enabled ? "btn-default" : "btn-primary"}
                  style={{ fontSize: "11px", padding: "3px 8px" }}
                  onClick={() => handleToggle(s)}
                >
                  {s.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  className="btn-default"
                  style={{ fontSize: "11px", padding: "3px 8px" }}
                  onClick={() => handleEdit(s)}
                >
                  Edit
                </button>
                <button
                  className="btn-danger"
                  style={{ fontSize: "11px", padding: "3px 8px" }}
                  onClick={() => setDeleteId(s.id)}
                >
                  Delete
                </button>
              </div>
            </div>
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

      {deleteId && (
        <DeleteConfirmModal
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
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
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true);

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className="bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] p-5 w-[90vw] max-w-[420px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-sm mb-4">{mode === "create" ? "New Schedule" : "Edit Schedule"}</h3>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-[var(--fg2)] font-semibold uppercase tracking-wide">Label</label>
            <input
              className="bg-[var(--color-base-100)] border border-[var(--border-color)] rounded-[var(--rounded-box)] px-2.5 py-1.5 text-xs font-[inherit] outline-none focus:border-[#58a6ff]"
              value={form.label}
              onChange={(e) => setField("label", e.target.value)}
              placeholder="Weekly maintenance"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-[var(--fg2)] font-semibold uppercase tracking-wide">Ticket Key</label>
            <input
              className="bg-[var(--color-base-100)] border border-[var(--border-color)] rounded-[var(--rounded-box)] px-2.5 py-1.5 text-xs font-[inherit] outline-none focus:border-[#58a6ff] font-mono"
              value={form.ticketKey}
              onChange={(e) => setField("ticketKey", e.target.value.toUpperCase())}
              placeholder="PROJ-123"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-[var(--fg2)] font-semibold uppercase tracking-wide">Recurrence</label>
            <select
              className="bg-[var(--color-base-100)] border border-[var(--border-color)] rounded-[var(--rounded-box)] px-2.5 py-1.5 text-xs font-[inherit] outline-none focus:border-[#58a6ff]"
              value={form.recurrence}
              onChange={(e) => setField("recurrence", e.target.value as FormData["recurrence"])}
            >
              <option value="once">Once</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
          {form.recurrence === "weekly" && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-[var(--fg2)] font-semibold uppercase tracking-wide">Day of Week</label>
              <select
                className="bg-[var(--color-base-100)] border border-[var(--border-color)] rounded-[var(--rounded-box)] px-2.5 py-1.5 text-xs font-[inherit] outline-none focus:border-[#58a6ff]"
                value={form.dayOfWeek}
                onChange={(e) => setField("dayOfWeek", e.target.value)}
              >
                {DAY_NAMES.map((d, i) => (
                  <option key={i} value={String(i)}>{d}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex gap-3">
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-[11px] text-[var(--fg2)] font-semibold uppercase tracking-wide">Hour (0–23)</label>
              <input
                type="number"
                min={0}
                max={23}
                className="bg-[var(--color-base-100)] border border-[var(--border-color)] rounded-[var(--rounded-box)] px-2.5 py-1.5 text-xs font-[inherit] outline-none focus:border-[#58a6ff]"
                value={form.hour}
                onChange={(e) => setField("hour", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-[11px] text-[var(--fg2)] font-semibold uppercase tracking-wide">Minute (0–59)</label>
              <input
                type="number"
                min={0}
                max={59}
                className="bg-[var(--color-base-100)] border border-[var(--border-color)] rounded-[var(--rounded-box)] px-2.5 py-1.5 text-xs font-[inherit] outline-none focus:border-[#58a6ff]"
                value={form.minute}
                onChange={(e) => setField("minute", e.target.value)}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setField("enabled", e.target.checked)}
              className="accent-[#58a6ff]"
            />
            <span>Enabled</span>
          </label>
        </div>
        <div className="flex gap-2 mt-5 justify-end">
          <button className="btn-default" style={{ fontSize: "12px" }} onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            style={{ fontSize: "12px" }}
            disabled={!form.label || !form.ticketKey}
            onClick={onSubmit}
          >
            {mode === "create" ? "Create" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true);

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center" onClick={onCancel}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className="bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] p-5 w-[90vw] max-w-[360px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-sm mb-2">Delete schedule?</h3>
        <p className="text-xs text-[var(--fg2)] mb-5">This cannot be undone. The schedule will stop firing.</p>
        <div className="flex gap-2 justify-end">
          <button className="btn-default" style={{ fontSize: "12px" }} onClick={onCancel}>Cancel</button>
          <button className="btn-danger" style={{ fontSize: "12px" }} onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}
