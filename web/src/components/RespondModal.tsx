import { useEffect, useRef, useState } from "react";
import { Modal, ModalTitle, ModalActions } from "./Modal";
import { Button } from "./ui/Button";
import { Textarea } from "./ui/Input";
import { Kbd } from "./ui/Kbd";

export function RespondModal({
  isOpen,
  title,
  onSubmit,
  onClose,
}: {
  isOpen: boolean;
  title: string;
  onSubmit: (message: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setText("");
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [isOpen]);

  const handleSubmit = () => {
    const message = text.trim();
    if (!message) return;
    onSubmit(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} labelledBy="respond-modal-title">
      <ModalTitle id="respond-modal-title">{title}</ModalTitle>
      <Textarea
        ref={textareaRef}
        name="respond-message"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type your feedback…"
        rows={4}
        spellCheck={false}
      />
      <p
        style={{
          fontSize: 10,
          color: "var(--c-fog-300)",
          marginTop: 6,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        Send with <Kbd>⌘</Kbd> <Kbd>↵</Kbd>
      </p>
      <ModalActions>
        <Button variant="primary" onClick={handleSubmit} disabled={!text.trim()}>
          Send
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </ModalActions>
    </Modal>
  );
}
