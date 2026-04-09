import { and, eq } from "drizzle-orm";

import { db, withSqliteWriteRetry } from "../../db/client";
import { locks } from "../../db/schema";
import { ExternalServiceError } from "../errors";
import { appendRunEvent } from "./run-writer";

export async function refreshLock(
  resourceType: string,
  resourceKey: string,
  ownerRunId: string,
  ttlSeconds: number,
) {
  const [updated] = await withSqliteWriteRetry(() =>
    db
      .update(locks)
      .set({
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      })
      .where(
        and(
          eq(locks.resourceType, resourceType),
          eq(locks.resourceKey, resourceKey),
          eq(locks.ownerRunId, ownerRunId),
        ),
      )
      .returning(),
  );

  if (!updated) {
    throw new ExternalServiceError(
      `Lock no longer held for ${resourceType}:${resourceKey}`,
      "lock_lost",
    );
  }

  return updated;
}

export async function acquireLock(resourceType: string, resourceKey: string, ownerRunId: string, ttlSeconds: number) {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(locks)
    .where(and(eq(locks.resourceType, resourceType), eq(locks.resourceKey, resourceKey)))
    .limit(1);

  if (existing && existing.expiresAt > now) {
    throw new ExternalServiceError(`Lock already held for ${resourceType}:${resourceKey}`);
  }
  if (existing) {
    await withSqliteWriteRetry(() => db.delete(locks).where(eq(locks.id, existing.id)));
  }
  try {
    await withSqliteWriteRetry(() => db.insert(locks).values({
      resourceType,
      resourceKey,
      ownerRunId,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    }));
    await appendRunEvent(ownerRunId, "lock.acquired", {
      resourceType,
      resourceKey,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      throw new ExternalServiceError(`Lock already held for ${resourceType}:${resourceKey}`);
    }
    throw error;
  }
}

export async function releaseLock(resourceType: string, resourceKey: string, ownerRunId: string) {
  await withSqliteWriteRetry(() => db
    .delete(locks)
    .where(
      and(
        eq(locks.resourceType, resourceType),
        eq(locks.resourceKey, resourceKey),
        eq(locks.ownerRunId, ownerRunId),
      ),
    ));
  await appendRunEvent(ownerRunId, "lock.released", {
    resourceType,
    resourceKey,
  });
}
