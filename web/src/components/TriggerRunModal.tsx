import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

export function TriggerRunModal({
  isOpen,
  onSubmit,
  onClose,
}: {
  isOpen: boolean;
  onSubmit: (ticketKey: string, force: boolean) => void;
  onClose: () => void;
}) {
  const [ticketKey, setTicketKey] = useState("");
  const [force, setForce] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useFocusTrap(containerRef, isOpen);

  useEffect(() => {
    if (isOpen) {
      setTicketKey("");
      setForce(false);
      requestAnimationFrame(() => inputRef.current?.focus());
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const key = ticketKey.trim();
    if (!key) return;
    onSubmit(key, force);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center">
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="trigger-run-title"
        className="bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] p-5 w-[90vw] sm:min-w-[400px] sm:w-auto max-w-[440px]"
      >
        <h3 id="trigger-run-title" className="mb-3 font-semibold">Trigger Manual Run</h3>
        <form onSubmit={handleSubmit}>
          <label className="block text-xs text-[var(--fg2)] mb-1">Jira Ticket Key</label>
          <input
            ref={inputRef}
            type="text"
            value={ticketKey}
            onChange={(e) => setTicketKey(e.target.value)}
            placeholder="PROJ-123"
            className="w-full bg-[var(--color-base-100)] border border-[var(--border-color)] rounded-[var(--rounded-box)] text-[var(--color-base-content)] px-2.5 py-1.5 text-xs font-[inherit] placeholder:text-[var(--fg3)] outline-none focus:border-[#58a6ff] mb-3"
          />
          <label className="flex items-center gap-2 text-xs text-[var(--fg2)] mb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              className="accent-[#58a6ff]"
            />
            Force (bypass eligibility checks)
          </label>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary">Trigger Run</button>
            <button type="button" className="btn-default" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
