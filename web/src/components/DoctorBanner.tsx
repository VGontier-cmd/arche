import { useCallback, useState } from "react";
import type { DashboardSnapshot } from "../types";

type Issue = { key: string; message: string };

function detectIssues(snapshot: DashboardSnapshot): Issue[] {
  const issues: Issue[] = [];
  if (!snapshot.services.dockerRunning) {
    issues.push({ key: "docker", message: "Docker is not running" });
  }
  if (!snapshot.credentialEnv.openRouter) {
    issues.push({ key: "openrouter", message: "AI API key not configured (USER_OPENROUTER_API_KEY)" });
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
      try { sessionStorage.setItem("arche-doctor-dismissed", JSON.stringify([...next])); } catch { /* */ }
      return next;
    });
  }, []);

  const issues = detectIssues(snapshot).filter((i) => !dismissed.has(i.key));
  if (issues.length === 0) return null;

  return (
    <div className="px-5 pt-2">
      {issues.map((issue) => (
        <div
          key={issue.key}
          className="flex items-center justify-between gap-3 bg-[#d2992215] border border-[#d2992240] rounded-[var(--rounded-box)] px-3 py-2 mb-1.5 text-xs text-[#d29922]"
        >
          <span>{"\u26A0"} {issue.message}</span>
          <button
            onClick={() => dismiss(issue.key)}
            className="text-[var(--fg3)] hover:text-[var(--fg2)] text-[10px] shrink-0"
          >
            dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
