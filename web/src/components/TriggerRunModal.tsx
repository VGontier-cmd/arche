import { useEffect, useRef, useState } from "react";
import { Modal, ModalTitle, ModalActions } from "./Modal";
import { Button } from "./ui/Button";
import { Input, Checkbox } from "./ui/Input";

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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTicketKey("");
      setForce(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const key = ticketKey.trim();
    if (!key) return;
    onSubmit(key, force);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} labelledBy="trigger-run-title" size="sm">
      <ModalTitle id="trigger-run-title">Trigger Manual Run</ModalTitle>
      <form onSubmit={handleSubmit}>
        <Input
          ref={inputRef}
          name="ticket-key"
          label="Jira Ticket Key"
          value={ticketKey}
          onChange={(e) => setTicketKey(e.target.value)}
          placeholder="PROJ-123…"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="characters"
          inputMode="text"
        />
        <div style={{ marginTop: 14 }}>
          <Checkbox
            name="force"
            label="Force"
            description="Bypass eligibility checks (assignee, status, label)."
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
          />
        </div>
        <ModalActions>
          <Button type="submit" variant="primary" disabled={!ticketKey.trim()}>
            Trigger Run
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}
