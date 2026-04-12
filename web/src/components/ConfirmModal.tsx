import { useEffect, useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

export function ConfirmModal({
  isOpen,
  title,
  body,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useFocusTrap(containerRef, isOpen);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center">
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-body"
        className="bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] p-5 w-[90vw] sm:min-w-[400px] sm:w-auto max-w-[500px]"
      >
        <h3 id="confirm-modal-title" className="mb-2 font-semibold">
          {title}
        </h3>
        <p id="confirm-modal-body" className="text-xs text-[var(--fg2)] mb-4">
          {body}
        </p>
        <div className="flex gap-2">
          <button className="btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button className="btn-default" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
