import { ExternalServiceError } from "../errors";
import { heartbeatWorker } from "../workers";

const MIN_RUN_HEARTBEAT_INTERVAL_MS = 250;
const MAX_RUN_HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_TRANSIENT_HEARTBEAT_FAILURES = 2;

export type RunOwnershipHeartbeatInput = {
  runId: string;
  ticketKey: string;
  workerId: string;
  leaseTtlSeconds: number;
};

export type RunOwnershipHeartbeatDeps = {
  refreshLease: (runId: string, workerId: string, leaseTtlSeconds: number) => Promise<void>;
  refreshLock: (
    resourceType: string,
    resourceKey: string,
    ownerRunId: string,
    ttlSeconds: number,
  ) => Promise<unknown>;
};

function computeRunHeartbeatIntervalMs(leaseTtlSeconds: number) {
  return Math.min(
    MAX_RUN_HEARTBEAT_INTERVAL_MS,
    Math.max(MIN_RUN_HEARTBEAT_INTERVAL_MS, Math.floor((leaseTtlSeconds * 1000) / 3)),
  );
}

function isOwnershipLostError(error: unknown): boolean {
  if (!(error instanceof ExternalServiceError)) return false;
  return error.code === "lease_lost" || error.code === "lock_lost";
}

export function startRunOwnershipHeartbeat(
  input: RunOwnershipHeartbeatInput,
  deps: RunOwnershipHeartbeatDeps,
) {
  const intervalMs = computeRunHeartbeatIntervalMs(input.leaseTtlSeconds);
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let failure: unknown = null;
  let consecutiveFailures = 0;

  const beat = async () => {
    if (stopped || inFlight || failure) {
      if (failure) {
        throw failure;
      }
      return;
    }

    inFlight = (async () => {
      await Promise.all([
        deps.refreshLease(input.runId, input.workerId, input.leaseTtlSeconds),
        deps.refreshLock("ticket", input.ticketKey, input.runId, input.leaseTtlSeconds),
        heartbeatWorker(input.workerId),
      ]);
    })()
      .then(() => {
        consecutiveFailures = 0;
      })
      .catch((error) => {
        consecutiveFailures += 1;
        // Ownership-loss errors are non-recoverable: surface immediately so the
        // worker stops touching a run it no longer owns.
        if (isOwnershipLostError(error) || consecutiveFailures > MAX_TRANSIENT_HEARTBEAT_FAILURES) {
          failure = error;
        }
      })
      .finally(() => {
        inFlight = null;
      });

    await inFlight;
    if (failure) {
      throw failure;
    }
  };

  // CRITICAL: the interval callback MUST swallow rejections itself. If we
  // simply `void beat()` a promise that rejects (lease_lost, DB error,
  // network blip), Node 20+ flags it as an unhandled rejection and — by
  // default in Node 22 — terminates the entire worker process. The failure
  // is already recorded on the `failure` ref so the next caller-driven
  // `prime()` / `stop()` can surface it; the timer's job is just to keep
  // the lease alive in the background, never to escalate.
  const timer = setInterval(() => {
    if (stopped || failure) {
      // Ownership already lost or stop requested — nothing useful to do.
      // We don't clearInterval() here because stop() owns the lifecycle.
      return;
    }
    beat().catch(() => {
      // Swallow — `failure` was set inside beat()'s own .catch(), and
      // re-throwing here would crash the worker process.
    });
  }, intervalMs);
  timer.unref?.();

  return {
    prime() {
      return beat();
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      if (inFlight) {
        await inFlight;
      }
      if (failure) {
        throw failure;
      }
    },
  };
}

export async function withRunOwnershipHeartbeat<T>(
  input: RunOwnershipHeartbeatInput,
  deps: RunOwnershipHeartbeatDeps,
  operation: () => Promise<T>,
) {
  const heartbeat = startRunOwnershipHeartbeat(input, deps);
  await heartbeat.prime();

  try {
    const result = await operation();
    await heartbeat.stop();
    return result;
  } catch (error) {
    try {
      await heartbeat.stop();
    } catch {
      // Preserve the primary workflow error.
    }
    throw error;
  }
}
