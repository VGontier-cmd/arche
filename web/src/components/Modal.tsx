import { useEffect, useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";

export function Modal({
  isOpen,
  onClose,
  children,
  labelledBy,
  size = "md",
}: {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  labelledBy?: string;
  size?: "sm" | "md" | "lg";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, isOpen);
  useBodyScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxWidth = size === "sm" ? 400 : size === "lg" ? 720 : 520;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.7)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        // A faint blueprint blur over the dashboard behind the modal —
        // makes the page recede so the modal owns the eye.
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface-1)",
          border: "1px solid var(--hairline-strong)",
          borderRadius: "var(--radius-lg)",
          padding: 22,
          width: "100%",
          maxWidth,
          maxHeight: "calc(100vh - 40px)",
          overflow: "auto",
          boxShadow: "var(--glow-blue), 0 30px 60px rgba(0, 0, 0, 0.4)",
          overscrollBehavior: "contain",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Heading helper — ensures every modal title uses the display face register. */
export function ModalTitle({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <h3
      id={id}
      style={{
        fontFamily: "var(--font-display)",
        fontSize: "var(--text-heading-lg)",
        fontWeight: 700,
        letterSpacing: "-0.005em",
        color: "var(--c-bone)",
        marginBottom: 6,
      }}
    >
      {children}
    </h3>
  );
}

/** Body-text helper for modal descriptions. */
export function ModalBody({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: "var(--text-body-sm)",
        color: "var(--c-fog-300)",
        marginBottom: 18,
        lineHeight: 1.5,
      }}
    >
      {children}
    </p>
  );
}

/** Footer button row helper — ensures consistent gap + alignment. */
export function ModalActions({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        justifyContent: align === "right" ? "flex-end" : "flex-start",
        flexWrap: "wrap",
        marginTop: 16,
        paddingTop: 14,
        borderTop: "1px solid var(--hairline)",
      }}
    >
      {children}
    </div>
  );
}
