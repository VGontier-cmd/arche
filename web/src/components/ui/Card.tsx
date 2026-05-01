/**
 * Card primitive — replaces the dozens of inline
 *   bg-[var(--color-base-200)] border border-[var(--border-color)] rounded
 * snippets with a single tone-aware surface.
 */

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

type Tone = "default" | "raised" | "sunken";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: Tone;
  /** Add a top-edge accent line in the given semantic color (e.g. "success", "info"). */
  accent?: "primary" | "accent" | "success" | "warning" | "error" | "info";
  /** Wrap the children with this padding token. */
  padding?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  glow?: "blue" | "gold" | "success" | "error" | "none";
  children?: ReactNode;
}

const TONE_STYLES: Record<Tone, CSSProperties> = {
  default: {
    background: "var(--surface-1)",
    border: "1px solid var(--hairline)",
    borderRadius: "var(--radius-md)",
  },
  raised: {
    background: "var(--surface-2)",
    border: "1px solid var(--hairline-strong)",
    borderRadius: "var(--radius-md)",
  },
  sunken: {
    background: "var(--surface-0)",
    border: "1px solid var(--hairline)",
    borderRadius: "var(--radius-md)",
  },
};

const ACCENT_COLOR: Record<NonNullable<CardProps["accent"]>, string> = {
  primary: "var(--c-blue-400)",
  accent:  "var(--c-gold-300)",
  success: "var(--c-success-fg)",
  warning: "var(--c-warning-fg)",
  error:   "var(--c-error-fg)",
  info:    "var(--c-info-fg)",
};

const GLOW: Record<NonNullable<CardProps["glow"]>, string> = {
  blue:    "var(--glow-blue)",
  gold:    "var(--glow-gold)",
  success: "var(--glow-success)",
  error:   "var(--glow-error)",
  none:    "",
};

export function Card({
  tone = "default",
  accent,
  padding = 4,
  glow,
  className,
  style,
  children,
  ...rest
}: CardProps) {
  const padPx = padding * 4; // 4-base spacing scale
  const padTop = accent ? Math.max(padPx, 12) : padPx;

  return (
    <div
      {...rest}
      className={className}
      style={{
        position: "relative",
        padding: `${padTop}px ${padPx}px ${padPx}px ${padPx}px`,
        ...TONE_STYLES[tone],
        boxShadow: glow ? GLOW[glow] : undefined,
        ...style,
      }}
    >
      {accent && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: ACCENT_COLOR[accent],
            borderRadius: "var(--radius-md) var(--radius-md) 0 0",
          }}
        />
      )}
      {children}
    </div>
  );
}
