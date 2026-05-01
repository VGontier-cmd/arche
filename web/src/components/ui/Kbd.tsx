/**
 * Keyboard hint chip — used inline for ⏎ / Esc / single-char hotkeys.
 * Shares typography with the rest of the dashboard (mono).
 */

import type { ReactNode } from "react";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 18,
        height: 18,
        padding: "0 5px",
        background: "var(--surface-2)",
        border: "1px solid var(--hairline-strong)",
        borderBottomWidth: "2px",
        borderRadius: 3,
        color: "var(--c-fog-100)",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </kbd>
  );
}
