import { and, eq, lte } from "drizzle-orm";

import { db, withSqliteWriteRetry } from "../../db/client";
import { runSchedules, type RunScheduleRow } from "../../db/schema";
import { NotFoundError } from "../errors";
import { makeId } from "../utils";
import type { RunScheduleCreateInput, RunScheduleUpdateInput } from "../contracts";
import { createManualRunForTicket } from "./run-ingress";

type ScheduleRecurrence = "once" | "daily" | "weekly";

function computeNextRunAt(
  recurrence: ScheduleRecurrence,
  hour: number,
  minute: number,
  dayOfWeek: number | null,
  afterMs = Date.now(),
): Date | null {
  if (recurrence === "once") {
    const d = new Date(afterMs);
    d.setSeconds(0, 0);
    d.setHours(hour, minute, 0, 0);
    if (d.getTime() <= afterMs) {
      d.setDate(d.getDate() + 1);
    }
    return d;
  }

  if (recurrence === "daily") {
    const d = new Date(afterMs);
    d.setSeconds(0, 0);
    d.setHours(hour, minute, 0, 0);
    if (d.getTime() <= afterMs) {
      d.setDate(d.getDate() + 1);
    }
    return d;
  }

  if (recurrence === "weekly" && dayOfWeek !== null) {
    const d = new Date(afterMs);
    d.setSeconds(0, 0);
    d.setHours(hour, minute, 0, 0);
    const currentDay = d.getDay();
    let daysUntil = (dayOfWeek - currentDay + 7) % 7;
    if (daysUntil === 0 && d.getTime() <= afterMs) {
      daysUntil = 7;
    }
    d.setDate(d.getDate() + daysUntil);
    return d;
  }

  return null;
}

export function presentSchedule(row: RunScheduleRow) {
  return {
    ...row,
    nextRunAt: row.nextRunAt ? row.nextRunAt.toISOString() : null,
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listSchedules() {
  const rows = await db.select().from(runSchedules);
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return rows.map(presentSchedule);
}

export async function getScheduleById(id: string) {
  const [row] = await db.select().from(runSchedules).where(eq(runSchedules.id, id)).limit(1);
  if (!row) throw new NotFoundError(`Schedule ${id} not found`);
  return row;
}

export async function createSchedule(input: RunScheduleCreateInput) {
  const recurrence = input.recurrence ?? "once";
  const hour = input.hour ?? 9;
  const minute = input.minute ?? 0;
  const dayOfWeek = input.dayOfWeek ?? null;
  const nextRunAt = computeNextRunAt(recurrence as ScheduleRecurrence, hour, minute, dayOfWeek);

  const record: RunScheduleRow = {
    id: makeId(),
    label: input.label,
    ticketKey: input.ticketKey,
    recurrence,
    hour,
    minute,
    dayOfWeek: dayOfWeek ?? null,
    enabled: input.enabled ?? true,
    nextRunAt,
    lastRunAt: null,
    lastRunId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const [row] = await withSqliteWriteRetry(() =>
    db.insert(runSchedules).values(record).returning(),
  );
  return presentSchedule(row);
}

export async function updateSchedule(id: string, input: RunScheduleUpdateInput) {
  const existing = await getScheduleById(id);
  const recurrence = (input.recurrence ?? existing.recurrence) as ScheduleRecurrence;
  const hour = input.hour ?? existing.hour;
  const minute = input.minute ?? existing.minute;
  const dayOfWeek = input.dayOfWeek !== undefined ? input.dayOfWeek : existing.dayOfWeek;

  const recomputeNext =
    input.recurrence !== undefined ||
    input.hour !== undefined ||
    input.minute !== undefined ||
    input.dayOfWeek !== undefined;

  const nextRunAt = recomputeNext
    ? computeNextRunAt(recurrence, hour, minute, dayOfWeek ?? null)
    : existing.nextRunAt;

  const [row] = await withSqliteWriteRetry(() =>
    db
      .update(runSchedules)
      .set({
        label: input.label ?? existing.label,
        ticketKey: input.ticketKey ?? existing.ticketKey,
        recurrence,
        hour,
        minute,
        dayOfWeek: dayOfWeek ?? null,
        enabled: input.enabled ?? existing.enabled,
        nextRunAt,
        updatedAt: new Date(),
      })
      .where(eq(runSchedules.id, id))
      .returning(),
  );
  return presentSchedule(row);
}

export async function deleteSchedule(id: string) {
  await getScheduleById(id);
  await withSqliteWriteRetry(() =>
    db.delete(runSchedules).where(eq(runSchedules.id, id)),
  );
}

export async function fireSchedule(id: string) {
  const schedule = await getScheduleById(id);
  const run = await createManualRunForTicket({ ticketKey: schedule.ticketKey, force: true });
  const now = new Date();
  const recurrence = schedule.recurrence as ScheduleRecurrence;
  const nextRunAt =
    recurrence === "once"
      ? null
      : computeNextRunAt(recurrence, schedule.hour, schedule.minute, schedule.dayOfWeek, now.getTime());

  await withSqliteWriteRetry(() =>
    db
      .update(runSchedules)
      .set({
        lastRunAt: now,
        lastRunId: run.id,
        nextRunAt,
        enabled: recurrence !== "once",
        updatedAt: now,
      })
      .where(eq(runSchedules.id, id)),
  );
  return run;
}

export async function fireSchedules(): Promise<void> {
  const now = new Date();
  const due = await db
    .select()
    .from(runSchedules)
    .where(
      and(
        eq(runSchedules.enabled, true),
        lte(runSchedules.nextRunAt, now),
      ),
    );

  for (const schedule of due) {
    try {
      await fireSchedule(schedule.id);
    } catch {
      // Non-fatal: log is handled by the caller
    }
  }
}
