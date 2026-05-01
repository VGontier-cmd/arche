import { useCallback, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { DashboardSnapshot } from "../types";

type Issue = { key: string; message: string };

function detectIssues(snapshot: DashboardSnapshot): Issue[] {
  const issues: Issue[] = [];
  if (!snapshot.services.dockerRunning) {
    issues.push({ key: "docker", message: "Docker is not running" });
  }
  if (!snapshot.credentialEnv.openRouter) {
    issues.push({
      key: "openrouter",
      message: "AI API key not configured (USER_OPENROUTER_API_KEY)",
    });
  }
  if (snapshot.summary.workerCount === 0) {
    issues.push({ key: "no-workers", message: "No workers registered" });
  } else if (snapshot.summary.onlineWorkerCount === 0) {
    issues.push({ key: "workers-offline", message: "All workers are offline" });
  }
  if (snapshot.repositoryCount === 0) {
    issues.push({ key: "no-repos", message: "No repositories configured" });
  }
  return issues;
}

export function DoctorBanner({ snapshot }: { snapshot: DashboardSnapshot }) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      const stored = sessionStorage.getItem("arche-doctor-dismissed");
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });

  const dismiss = useCallback((key: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(key);
      try {
        sessionStorage.setItem("arche-doctor-dismissed", JSON.stringify([...next]));
      } catch {
        /* */
      }
      return next;
    });
  }, []);

  const issues = detectIssues(snapshot).filter((i) => !dismissed.has(i.key));
  if (issues.length === 0) return null;

  return (
    <div
      style={{ padding: "8px 20px 0" }}
      role="region"
      aria-label="System health warnings"
    >
      {issues.map((issue) => (
        <div
          key={issue.key}
          role="alert"
          className="flex items-center justify-between"
          style={{
            gap: 12,
            background: "var(--c-warning-bg)",
            border: "1px solid var(--c-gold-700)",
            borderLeftWidth: 3,
            borderLeftColor: "var(--c-gold-300)",
            borderRadius: "var(--radius-sm)",
            padding: "8px 12px",
            marginBottom: 6,
            fontSize: "var(--text-body-sm)",
            color: "var(--c-gold-300)",
          }}
        >
          <span
            className="flex items-center"
            style={{ gap: 8, minWidth: 0 }}
          >
            <AlertTriangle
              size={14}
              strokeWidth={2}
              aria-hidden="true"
              style={{ flexShrink: 0 }}
            />
            <span className="truncate">{issue.message}</span>
          </span>
          <button
            onClick={() => dismiss(issue.key)}
            aria-label={`Dismiss warning: ${issue.message}`}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--c-gold-300)",
              opacity: 0.7,
              cursor: "pointer",
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              padding: 4,
              borderRadius: "var(--radius-xs)",
              transition: "opacity var(--dur-fast) var(--ease-out)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = "1";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = "0.7";
            }}
          >
            <X size={12} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
