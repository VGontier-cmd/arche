/**
 * Arche button primitive. Replaces the `.btn-default / .btn-primary /
 * .btn-danger` raw CSS classes with a typed React component driven by
 * the design tokens. Lives at /web/src/components/ui/Button.tsx.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent";
type Size = "xs" | "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

const SIZE_STYLES: Record<Size, { padX: number; padY: number; fs: string; gap: number; iconSz: number }> = {
  xs: { padX: 8,  padY: 3, fs: "10px", gap: 4, iconSz: 11 },
  sm: { padX: 10, padY: 4, fs: "11px", gap: 5, iconSz: 12 },
  md: { padX: 14, padY: 6, fs: "12px", gap: 6, iconSz: 13 },
};

function variantStyles(v: Variant): React.CSSProperties {
  switch (v) {
    case "primary":
      return {
        background: "var(--c-blue-700)",
        borderColor: "var(--c-blue-500)",
        color: "var(--c-bone)",
        fontWeight: 600,
      };
    case "secondary":
      return {
        background: "var(--surface-1)",
        borderColor: "var(--hairline)",
        color: "var(--c-fog-100)",
      };
    case "ghost":
      return {
        background: "transparent",
        borderColor: "transparent",
        color: "var(--c-fog-100)",
      };
    case "danger":
      return {
        background: "var(--c-error-bg)",
        borderColor: "var(--c-error-fg)",
        color: "var(--c-error-fg)",
      };
    case "accent":
      return {
        background: "var(--c-gold-900)",
        borderColor: "var(--c-gold-300)",
        color: "var(--c-gold-300)",
        fontWeight: 600,
      };
  }
}

function hoverGlow(v: Variant): string | undefined {
  switch (v) {
    case "primary": return "var(--glow-blue)";
    case "danger":  return "var(--glow-error)";
    case "accent":  return "var(--glow-gold)";
    default:        return undefined;
  }
}

export function Button({
  variant = "secondary",
  size = "md",
  isLoading = false,
  leftIcon,
  rightIcon,
  fullWidth = false,
  className,
  children,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const sz = SIZE_STYLES[size];
  const v = variantStyles(variant);
  const glow = hoverGlow(variant);
  const isDisabled = disabled || isLoading;

  return (
    <button
      {...rest}
      disabled={isDisabled}
      data-variant={variant}
      data-size={size}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: `${sz.gap}px`,
        padding: `${sz.padY}px ${sz.padX}px`,
        fontFamily: "inherit",
        fontSize: sz.fs,
        lineHeight: 1.2,
        borderRadius: "var(--radius-sm)",
        border: "1px solid",
        cursor: isDisabled ? "not-allowed" : "pointer",
        transition:
          "background var(--dur-fast) var(--ease-out), " +
          "border-color var(--dur-fast) var(--ease-out), " +
          "box-shadow var(--dur-fast) var(--ease-out), " +
          "color var(--dur-fast) var(--ease-out)",
        whiteSpace: "nowrap",
        width: fullWidth ? "100%" : undefined,
        opacity: isDisabled ? 0.4 : 1,
        pointerEvents: isDisabled ? "none" : "auto",
        userSelect: "none",
        ...v,
        ...style,
      }}
      onMouseEnter={(e) => {
        if (isDisabled) return;
        const t = e.currentTarget;
        if (variant === "ghost") {
          t.style.background = "var(--surface-2)";
        } else if (variant === "secondary") {
          t.style.background = "var(--surface-2)";
          t.style.borderColor = "var(--hairline-strong)";
        } else if (variant === "primary") {
          t.style.background = "var(--c-blue-500)";
        } else if (variant === "danger") {
          t.style.background = "#3a1418";
        } else if (variant === "accent") {
          t.style.background = "#3a2a10";
        }
        if (glow) t.style.boxShadow = glow;
        rest.onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        const t = e.currentTarget;
        Object.assign(t.style, v);
        t.style.boxShadow = "";
        rest.onMouseLeave?.(e);
      }}
    >
      {isLoading ? (
        <span
          aria-hidden="true"
          style={{
            width: sz.iconSz,
            height: sz.iconSz,
            border: "1.5px solid currentColor",
            borderTopColor: "transparent",
            borderRadius: "50%",
            animation: "spin 0.7s linear infinite",
            opacity: 0.7,
          }}
        />
      ) : (
        leftIcon
      )}
      {children}
      {!isLoading && rightIcon}
    </button>
  );
}
