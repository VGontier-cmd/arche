import { useEffect, useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

export function Modal({
  isOpen,
  onClose,
  children,
  labelledBy,
}: {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  labelledBy?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, isOpen);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center">
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] p-5 w-[90vw] sm:min-w-[400px] sm:w-auto max-w-[500px]"
      >
        {children}
      </div>
    </div>
  );
}
