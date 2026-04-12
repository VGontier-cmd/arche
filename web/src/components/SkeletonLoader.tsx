function Pulse({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-[var(--color-base-300)] rounded ${className}`} />;
}

export function SkeletonLoader() {
  return (
    <div className="min-h-screen bg-[var(--color-base-100)]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-[var(--color-base-200)] border-b border-[var(--border-color)]">
        <Pulse className="h-8 w-40" />
        <div className="flex gap-4">
          <Pulse className="h-4 w-20" />
          <Pulse className="h-4 w-20" />
          <Pulse className="h-4 w-28" />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-5 py-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="border border-[var(--border-color)] rounded-[var(--rounded-box)] p-3">
            <Pulse className="h-3 w-16 mb-2" />
            <Pulse className="h-6 w-10" />
          </div>
        ))}
      </div>

      {/* Sidebar + Detail */}
      <div className="flex flex-col lg:flex-row">
        {/* Sidebar */}
        <div className="w-full lg:w-[380px] border-r border-[var(--border-color)] p-4 space-y-4">
          {Array.from({ length: 3 }, (_, s) => (
            <div key={s} className="space-y-2">
              <Pulse className="h-3 w-20" />
              {Array.from({ length: 2 }, (_, r) => (
                <div key={r} className="flex items-center gap-2 p-2">
                  <Pulse className="h-4 w-16" />
                  <Pulse className="h-4 flex-1" />
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Detail pane */}
        <div className="flex-1 p-5 space-y-4">
          <Pulse className="h-5 w-48" />
          <div className="space-y-2">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex gap-3">
                <Pulse className="h-3 w-24" />
                <Pulse className="h-3 w-40" />
              </div>
            ))}
          </div>
          <Pulse className="h-32 w-full" />
        </div>
      </div>
    </div>
  );
}
