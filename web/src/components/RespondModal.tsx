import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

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
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useFocusTrap(containerRef, isOpen);

  useEffect(() => {
    if (isOpen) {
      setText("");
      // Focus textarea after trap sets up
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    const message = text.trim();
    if (!message) return;
    onSubmit(message);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center">
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="respond-modal-title"
        className="bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] p-5 w-[90vw] sm:min-w-[400px] sm:w-auto max-w-[500px]"
      >
        <h3 id="respond-modal-title" className="mb-3 font-semibold">{title}</h3>
        <textarea
          ref={textareaRef}
          className="w-full min-h-[80px] bg-[var(--color-base-100)] border border-[var(--border-color)] rounded-[var(--rounded-box)] text-[var(--color-base-content)] p-2 font-[inherit] text-xs resize-y"
          placeholder="Type your feedback..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex gap-2 mt-3">
          <button className="btn-primary" onClick={handleSubmit}>
            Send
          </button>
          <button className="btn-default" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
