import type { DashboardTask } from "../types";
import { formatCost } from "../lib/format";
import { StatusPill } from "./ui/StatusPill";
import { SectionHeading } from "./ui/SectionHeading";

export function TasksList({ tasks }: { tasks: DashboardTask[] }) {
  if (tasks.length === 0) return null;

  return (
    <section style={{ marginBottom: 20 }} aria-labelledby="tasks-heading">
      <SectionHeading id="tasks-heading">Tasks</SectionHeading>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {tasks.map((task) => {
          const cost = task.estimatedCostUsd ? formatCost(task.estimatedCostUsd) : "";
          return (
            <div
              key={task.id}
              className="flex items-center"
              style={{
                gap: 10,
                padding: "8px 12px",
                background: "var(--surface-1)",
                border: "1px solid var(--hairline)",
                borderRadius: "var(--radius-md)",
                fontSize: "var(--text-body-sm)",
              }}
            >
              <StatusPill status={task.status} />
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                  letterSpacing: "-0.005em",
                  color: "var(--c-blue-200)",
                  minWidth: 70,
                  textTransform: "capitalize",
                }}
              >
                {task.role}
              </span>
              <span
                style={{
                  color: "var(--c-fog-300)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {task.modelName || "—"}
              </span>
              {cost && (
                <span
                  className="tabular"
                  style={{
                    color: "var(--c-gold-300)",
                    fontFamily: "var(--font-display)",
                    fontWeight: 600,
                    marginLeft: "auto",
                  }}
                >
                  {cost}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
