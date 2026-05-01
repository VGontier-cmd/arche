/**
 * Arche logo primitive.
 * The mark is the Unicode arch glyph ∩ (U+2229) — a classical Roman arch
 * silhouette with two pillars and a rounded vault. Rendered in the mono
 * family because ∩ is a math/operator codepoint that comes out crisp in
 * monospaced fonts and not all display faces ship it. The wordmark
 * remains plain "ARCHE" in the display face.
 */

type LogoVariant = "mark" | "monogram" | "wordmark" | "lockup";
type LogoTone = "color" | "mono" | "inverted";

interface LogoProps {
  variant?: LogoVariant;
  /** Pixel height of the visible glyph. Defaults: mark 28, monogram 28, wordmark 22, lockup 24. */
  size?: number;
  tone?: LogoTone;
  className?: string;
  ariaLabel?: string;
}

export function Logo({
  variant = "lockup",
  size,
  tone = "color",
  className,
  ariaLabel = "Arche",
}: LogoProps) {
  const baseColor =
    tone === "mono"
      ? "currentColor"
      : tone === "inverted"
      ? "var(--c-obsidian)"
      : "var(--c-blue-400)";
  const wordColor =
    tone === "mono" ? "currentColor" : "var(--c-bone)";

  if (variant === "mark") {
    const h = size ?? 28;
    return (
      <span
        className={className}
        role="img"
        aria-label={ariaLabel}
        translate="no"
        style={{
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          fontSize: `${Math.round(h * 1.35)}px`,
          lineHeight: 1,
          color: baseColor,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ∩
      </span>
    );
  }

  if (variant === "monogram") {
    const box = size ?? 28;
    return (
      <span
        className={className}
        role="img"
        aria-label={ariaLabel}
        translate="no"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: box,
          height: box,
          background: "transparent",
          color:
            tone === "mono" ? "currentColor" : "var(--c-blue-200)",
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          fontSize: `${Math.round(box * 1.1)}px`,
          lineHeight: 1,
        }}
      >
        ∩
      </span>
    );
  }

  if (variant === "wordmark") {
    const h = size ?? 22;
    return (
      <span
        className={className}
        role="img"
        aria-label={ariaLabel}
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: `${h}px`,
          lineHeight: 1,
          letterSpacing: "-0.025em",
          color: wordColor,
          display: "inline-flex",
        }}
      >
        ARCHE
      </span>
    );
  }

  // lockup — single uniform "ARCHE" wordmark in display face.
  const h = size ?? 24;
  return (
    <span
      className={className}
      role="img"
      aria-label={ariaLabel}
      translate="no"
      style={{
        fontFamily: "var(--font-display)",
        fontWeight: 700,
        fontSize: `${h}px`,
        lineHeight: 1,
        letterSpacing: "-0.025em",
        color: wordColor,
      }}
    >
      ARCHE
    </span>
  );
}
