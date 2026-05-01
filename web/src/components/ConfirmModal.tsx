import { useEffect } from "react";
import { Modal, ModalTitle, ModalBody, ModalActions } from "./Modal";
import { Button } from "./ui/Button";

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
    <Modal isOpen={isOpen} onClose={onCancel} labelledBy="confirm-modal-title" size="sm">
      <ModalTitle id="confirm-modal-title">{title}</ModalTitle>
      <ModalBody>{body}</ModalBody>
      <ModalActions>
        <Button variant="danger" onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </ModalActions>
    </Modal>
  );
}
