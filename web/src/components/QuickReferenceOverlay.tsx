import { useEffect, useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

const shortcuts = [
  { key: "j / \u2193", desc: "Next run" },
  { key: "k / \u2191", desc: "Previous run" },
  { key: "a", desc: "Approve (plan or publish)" },
  { key: "c", desc: "Cancel run" },
  { key: "x", desc: "Reject publish" },
  { key: "h", desc: "Respond to human input" },
  { key: "t", desc: "Retry failed run" },
  { key: "n", desc: "Trigger new run" },
  { key: "/", desc: "Focus search" },
  { key: "?", desc: "Toggle this help" },
  { key: "Esc", desc: "Close modal / overlay" },
];

const workflow = [
  { step: "1", label: "Jira ticket", desc: "Ticket assigned with matching label triggers a run" },
  { step: "2", label: "Planner", desc: "AI reads the ticket and produces a plan" },
  { step: "3", label: "Approval", desc: "You review and approve the plan" },
  { step: "4", label: "Executor", desc: "AI implements changes in a Docker sandbox" },
  { step: "5", label: "Reviewer", desc: "AI reviews the diff and validation output" },
  { step: "6", label: "Publish", desc: "You approve, then changes are pushed and MR created" },
];

export function QuickReferenceOverlay({ onClose }: { onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, true);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center" onClick={onClose}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        className="bg-[var(--color-base-200)] border border-[var(--border-color)] rounded-[var(--rounded-box)] p-5 w-[90vw] max-w-[520px] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm">Quick Reference</h3>
          <button onClick={onClose} className="text-[var(--fg3)] hover:text-[var(--fg2)] text-xs">close</button>
        </div>

        <h4 className="text-[11px] font-semibold text-[var(--fg2)] uppercase tracking-wide mb-2">Keyboard Shortcuts</h4>
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs mb-5">
          {shortcuts.map((s) => (
            <div key={s.key} className="contents">
              <span className="text-[#58a6ff] font-mono text-[11px]">{s.key}</span>
              <span className="text-[var(--fg2)]">{s.desc}</span>
            </div>
          ))}
        </div>

        <h4 className="text-[11px] font-semibold text-[var(--fg2)] uppercase tracking-wide mb-2">Workflow</h4>
        <div className="flex flex-col gap-1.5 text-xs">
          {workflow.map((w) => (
            <div key={w.step} className="flex items-start gap-2">
              <span className="bg-[var(--color-base-300)] text-[#58a6ff] rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold shrink-0">{w.step}</span>
              <div>
                <span className="text-[var(--color-base-content)] font-semibold">{w.label}</span>
                <span className="text-[var(--fg2)]"> — {w.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
