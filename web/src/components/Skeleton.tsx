function Pulse({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-[var(--color-base-300)] ${className}`}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] p-4 space-y-3">
      <Pulse className="h-4 w-1/3" />
      <Pulse className="h-3 w-2/3" />
      <Pulse className="h-3 w-1/2" />
    </div>
  );
}

export function SkeletonTable({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-4 py-2">
          <Pulse className="h-3 w-1/4" />
          <Pulse className="h-3 w-1/3" />
          <Pulse className="h-3 w-1/6" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonSection() {
  return (
    <div className="bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] p-4 space-y-3">
      <Pulse className="h-4 w-1/4 mb-2" />
      <div className="space-y-2">
        <div className="flex gap-3">
          <Pulse className="h-3 w-1/5" />
          <Pulse className="h-3 w-2/5" />
        </div>
        <div className="flex gap-3">
          <Pulse className="h-3 w-1/5" />
          <Pulse className="h-3 w-1/3" />
        </div>
        <div className="flex gap-3">
          <Pulse className="h-3 w-1/5" />
          <Pulse className="h-3 w-1/4" />
        </div>
      </div>
    </div>
  );
}
