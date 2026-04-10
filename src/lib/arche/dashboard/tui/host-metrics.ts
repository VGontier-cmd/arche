import os from "node:os";

export type HostMetricsSample = {
  /** Approximate whole-VM CPU usage (0–100) from `os.cpus()` deltas between calls. */
  cpuPercent: number;
  /** Share of system memory in use (0–100). */
  ramPercent: number;
  /** Logical CPU count from `os.cpus()`. */
  logicalCores: number;
  /** Total system RAM in bytes (`os.totalmem()`). */
  totalMemBytes: number;
};

type CpuAggregate = { idle: number; total: number };

function readCpuAggregate(): CpuAggregate {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

let previousCpu: CpuAggregate | null = null;

/**
 * Call periodically (e.g. each dashboard poll). First call returns `cpuPercent: 0`
 * until a second sample exists; `ramPercent` is always meaningful.
 */
export function readHostMetrics(): HostMetricsSample {
  const now = readCpuAggregate();
  let cpuPercent = 0;
  if (previousCpu !== null) {
    const idleDelta = now.idle - previousCpu.idle;
    const totalDelta = now.total - previousCpu.total;
    if (totalDelta > 0) {
      const busyRatio = 1 - idleDelta / totalDelta;
      cpuPercent = Math.max(0, Math.min(100, Math.round(busyRatio * 100)));
    }
  }
  previousCpu = now;

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const ramPercent =
    totalMem > 0
      ? Math.max(0, Math.min(100, Math.round(100 * (1 - freeMem / totalMem))))
      : 0;

  return {
    cpuPercent,
    ramPercent,
    logicalCores: os.cpus().length,
    totalMemBytes: totalMem,
  };
}

/** Test helper: clear CPU baseline so the next `readHostMetrics` is a fresh first sample. */
export function resetHostCpuBaselineForTests() {
  previousCpu = null;
}
