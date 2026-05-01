/**
 * Generic chip used for counts (inbox, findings, filter counts) and tags.
 * For status presentation see StatusPill — Badge is content-agnostic.
 */

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

type Tone = "neutral" | "info" | "warning" | "danger" | "success" | "accent" | "primary";
type Size = "sm" | "md";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  size?: Size;
  pulse?: boolean;
  children?: ReactNode;
}

const TONE_STYLES: Record<Tone, CSSProperties> = {
  neutral: { background: "var(--surface-2)",       color: "var(--c-fog-100)"      },
  info:    { background: "var(--c-info-bg)",       color: "var(--c-info-fg)"      },
  warning: { background: "var(--c-warning-bg)",    color: "var(--c-warning-fg)"   },
  danger:  { background: "var(--c-error-bg)",      color: "var(--c-error-fg)"     },
  success: { background: "var(--c-success-bg)",    color: "var(--c-success-fg)"   },
  accent:  { background: "var(--c-gold-900)",      color: "var(--c-gold-300)"     },
  primary: { background: "var(--c-blue-950)",      color: "var(--c-blue-200)"     },
};

const SIZE_STYLES: Record<Size, CSSProperties> = {
  sm: { fontSize: "9px",  padding: "2px 6px",  letterSpacing: "0.06em" },
  md: { fontSize: "10px", padding: "3px 8px",  letterSpacing: "0.05em" },
};

export function Badge({
  tone = "neutral",
  size = "sm",
  pulse = false,
  className,
  style,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      {...rest}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        borderRadius: "var(--radius-xs)",
        fontWeight: 700,
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        lineHeight: 1.2,
        ...SIZE_STYLES[size],
        ...TONE_STYLES[tone],
        ...style,
      }}
    >
      {pulse && (
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: "currentColor",
            animation: "pulse 1.6s var(--ease-in-out) infinite",
          }}
        />
      )}
      {children}
    </span>
  );
}
