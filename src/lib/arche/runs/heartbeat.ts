import { heartbeatWorker } from "../workers";

const MIN_RUN_HEARTBEAT_INTERVAL_MS = 250;
const MAX_RUN_HEARTBEAT_INTERVAL_MS = 30_000;

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

export function startRunOwnershipHeartbeat(
  input: RunOwnershipHeartbeatInput,
  deps: RunOwnershipHeartbeatDeps,
) {
  const intervalMs = computeRunHeartbeatIntervalMs(input.leaseTtlSeconds);
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let failure: unknown = null;

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
      .catch((error) => {
        failure = error;
      })
      .finally(() => {
        inFlight = null;
      });

    await inFlight;
    if (failure) {
      throw failure;
    }
  };

  const timer = setInterval(() => {
    void beat();
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
