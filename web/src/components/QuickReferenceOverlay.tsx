import { useEffect, useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { Kbd } from "./ui/Kbd";
import { Button } from "./ui/Button";

interface Shortcut { key: string; desc: string; }
interface WorkflowStep { step: string; label: string; desc: string; }

const shortcuts: Shortcut[] = [
  { key: "j",   desc: "Next run" },
  { key: "k",   desc: "Previous run" },
  { key: "a",   desc: "Approve (plan or publish)" },
  { key: "c",   desc: "Cancel run" },
  { key: "x",   desc: "Reject publish" },
  { key: "h",   desc: "Respond to human input" },
  { key: "t",   desc: "Retry failed run" },
  { key: "n",   desc: "Trigger new run" },
  { key: "r",   desc: "Refresh dashboard" },
  { key: "/",   desc: "Focus search" },
  { key: "?",   desc: "Toggle this help" },
  { key: "Esc", desc: "Close modal / overlay" },
];

const workflow: WorkflowStep[] = [
  { step: "1", label: "Jira ticket", desc: "Ticket assigned with matching label triggers a run" },
  { step: "2", label: "Planner",     desc: "AI reads the ticket and produces a plan" },
  { step: "3", label: "Approval",    desc: "You review and approve the plan" },
  { step: "4", label: "Executor",    desc: "AI implements changes in a Docker sandbox" },
  { step: "5", label: "Reviewer",    desc: "AI reviews the diff and validation output" },
  { step: "6", label: "Publish",     desc: "You approve, then changes are pushed and MR created" },
];

export function QuickReferenceOverlay({ onClose }: { onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, true);
  useBodyScrollLock(true);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.7)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quickref-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface-1)",
          border: "1px solid var(--hairline-strong)",
          borderRadius: "var(--radius-lg)",
          padding: 24,
          width: "100%",
          maxWidth: 720,
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "var(--glow-blue), 0 30px 60px rgba(0, 0, 0, 0.4)",
          overscrollBehavior: "contain",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 20,
          }}
        >
          <h3
            id="quickref-title"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "var(--text-display-md)",
              fontWeight: 700,
              letterSpacing: "-0.015em",
              color: "var(--c-bone)",
            }}
          >
            Quick Reference
          </h3>
          <Button size="xs" variant="ghost" onClick={onClose} aria-label="Close help">
            Close
          </Button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr)",
            gap: 24,
          }}
          className="lg:grid-cols-2"
        >
          {/* Keyboard shortcuts */}
          <section>
            <SectionTitle>Keyboard Shortcuts</SectionTitle>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                columnGap: 14,
                rowGap: 8,
                fontSize: "var(--text-body-sm)",
              }}
            >
              {shortcuts.map((s) => (
                <span
                  key={s.key}
                  style={{ display: "contents" }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center" }}>
                    <Kbd>{s.key}</Kbd>
                  </span>
                  <span style={{ color: "var(--c-fog-100)" }}>{s.desc}</span>
                </span>
              ))}
            </div>
          </section>

          {/* Workflow */}
          <section>
            <SectionTitle>Workflow</SectionTitle>
            <ol
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                fontSize: "var(--text-body-sm)",
                margin: 0,
                padding: 0,
                listStyle: "none",
              }}
            >
              {workflow.map((w) => (
                <li
                  key={w.step}
                  style={{ display: "flex", alignItems: "flex-start", gap: 10 }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      flexShrink: 0,
                      width: 22,
                      height: 22,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: "2px 2px 6px 6px",
                      background: "var(--c-blue-950)",
                      color: "var(--c-blue-200)",
                      fontFamily: "var(--font-display)",
                      fontWeight: 700,
                      fontSize: 12,
                    }}
                  >
                    {w.step}
                  </span>
                  <span>
                    <span
                      style={{
                        fontFamily: "var(--font-display)",
                        fontWeight: 700,
                        color: "var(--c-bone)",
                      }}
                    >
                      {w.label}
                    </span>
                    <span style={{ color: "var(--c-fog-300)" }}>
                      {" "}— {w.desc}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4
      style={{
        fontSize: "var(--text-label-md)",
        fontWeight: 700,
        color: "var(--c-fog-300)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        marginBottom: 10,
      }}
    >
      {children}
    </h4>
  );
}
