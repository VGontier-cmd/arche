import { useEffect } from "react";
import { Modal } from "./Modal";

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
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onConfirm]);

  return (
    <Modal isOpen={isOpen} onClose={onCancel} labelledBy="confirm-modal-title">
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
    </Modal>
  );
}
