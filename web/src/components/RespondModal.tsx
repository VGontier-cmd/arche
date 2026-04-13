import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";

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
      <h3 id="respond-modal-title" className="mb-3 font-semibold">{title}</h3>
      <textarea
        ref={textareaRef}
        className="w-full min-h-[80px] bg-[var(--color-base-100)] border border-[var(--border-color)] rounded-[var(--rounded-box)] text-[var(--color-base-content)] p-2 font-[inherit] text-xs resize-y"
        placeholder="Type your feedback… (⌘↵ to send)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="flex gap-2 mt-3">
        <button className="btn-primary" onClick={handleSubmit} disabled={!text.trim()}>
          Send
        </button>
        <button className="btn-default" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
