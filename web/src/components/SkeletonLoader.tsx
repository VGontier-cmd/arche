function Pulse({
  width,
  height = 12,
  style,
}: {
  width: string | number;
  height?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="animate-pulse"
      aria-hidden="true"
      style={{
        background: "var(--surface-2)",
        borderRadius: "var(--radius-xs)",
        width,
        height,
        ...style,
      }}
    />
  );
}

export function SkeletonLoader() {
  return (
    <div
      role="status"
      aria-label="Loading dashboard"
      style={{
        minHeight: "100vh",
        background: "var(--surface-0)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between"
        style={{
          padding: "12px 20px",
          background: "var(--surface-1)",
          borderBottom: "1px solid var(--c-blue-900)",
        }}
      >
        <Pulse width={160} height={28} />
        <div className="flex" style={{ gap: 16 }}>
          <Pulse width={80} height={14} />
          <Pulse width={80} height={14} />
          <Pulse width={110} height={14} />
        </div>
      </div>

      {/* KPI Cards */}
      <div
        className="grid grid-cols-2 sm:grid-cols-4"
        style={{ gap: 12, padding: "16px 20px" }}
      >
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            style={{
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius-md)",
              padding: 14,
              background: "var(--surface-1)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <Pulse width="60%" height={12} />
            <Pulse width="40%" height={24} />
          </div>
        ))}
      </div>

      {/* Sidebar + Detail */}
      <div className="flex flex-col lg:flex-row">
        {/* Sidebar */}
        <div
          style={{
            width: "100%",
            maxWidth: 380,
            borderRight: "1px solid var(--hairline)",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {Array.from({ length: 3 }, (_, s) => (
            <div
              key={s}
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              <Pulse width={80} height={11} />
              {Array.from({ length: 2 }, (_, r) => (
                <div
                  key={r}
                  className="flex items-center"
                  style={{ gap: 8, padding: 8 }}
                >
                  <Pulse width={60} height={14} />
                  <Pulse width="100%" height={14} style={{ flex: 1 }} />
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Detail pane */}
        <div
          style={{
            flex: 1,
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <Pulse width={200} height={20} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex" style={{ gap: 12 }}>
                <Pulse width={100} height={12} />
                <Pulse width={160} height={12} />
              </div>
            ))}
          </div>
          <Pulse width="100%" height={128} />
        </div>
      </div>
    </div>
  );
}
