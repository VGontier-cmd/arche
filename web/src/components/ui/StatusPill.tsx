/**
 * StatusPill — token-driven status presentation.
 * Reads STATUS_TONE / STATUS_LABEL / STATUS_ICON via statusMeta() from tokens.ts.
 * Live tones (running / wait) get the tone glow; done/fail are flat. When
 * the run has shipped and we know the MR/PR URL, the pill turns into an anchor.
 */

import { ARROW_OUT_ICON, statusMeta, toneVars } from "./tokens";

interface StatusPillProps {
  status: string;
  mrUrl?: string | null;
  /** Visual size — "sm" matches the historical 10px badge; "md" used in the run hero. */
  size?: "sm" | "md";
  className?: string;
}

export function StatusPill({ status, mrUrl, size = "sm", className }: StatusPillProps) {
  const meta = statusMeta(status);
  const vars = toneVars(meta.tone);
  const isLinked = mrUrl && (status === "success" || status === "pushed");

  const sz =
    size === "md"
      ? { fs: 11, py: 3, px: 10, iconSz: 13, gap: 6 }
      : { fs: 9,  py: 2, px: 8,  iconSz: 11, gap: 5 };

  const baseStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: `${sz.gap}px`,
    padding: `${sz.py}px ${sz.px}px`,
    background: vars.bg,
    color: vars.fg,
    borderRadius: "var(--radius-xs)",
    fontSize: `${sz.fs}px`,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    whiteSpace: "nowrap",
    boxShadow: meta.live ? vars.glow : undefined,
    transition:
      "filter var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)",
  };

  const inner = (
    <>
      {meta.live && (
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "currentColor",
            animation: "pulse 1.6s var(--ease-in-out) infinite",
            flexShrink: 0,
          }}
        />
      )}
      <meta.Icon size={sz.iconSz} strokeWidth={2.5} aria-hidden="true" />
      {meta.label}
      {isLinked && <ARROW_OUT_ICON size={sz.iconSz - 2} strokeWidth={2.5} aria-hidden="true" />}
    </>
  );

  if (isLinked) {
    return (
      <a
        href={mrUrl ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        style={{ ...baseStyle, cursor: "pointer", textDecoration: "none" }}
        title={`Open MR/PR: ${mrUrl}`}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(1.25)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.filter = ""; }}
      >
        {inner}
      </a>
    );
  }

  return (
    <span className={className} style={baseStyle}>
      {inner}
    </span>
  );
}
