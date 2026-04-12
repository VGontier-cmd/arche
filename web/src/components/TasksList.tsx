import type { DashboardTask } from "../types";
import { formatCost } from "../lib/format";
import { StatusBadge } from "./StatusBadge";

export function TasksList({ tasks }: { tasks: DashboardTask[] }) {
  if (tasks.length === 0) return null;

  return (
    <div className="mb-5">
      <h3 className="text-[11px] font-semibold text-[var(--fg2)] uppercase tracking-wide mb-2">
        Tasks
      </h3>
      <div className="flex flex-col gap-1">
        {tasks.map((task) => {
          const cost = task.estimatedCostUsd
            ? formatCost(task.estimatedCostUsd)
            : "";
          return (
            <div
              key={task.id}
              className="flex items-center gap-2 px-2.5 py-1.5 bg-[var(--color-base-200)] rounded-[var(--rounded-box)] text-xs"
            >
              <StatusBadge status={task.status} />
              <span className="text-[#bc8cff] font-semibold min-w-[70px]">
                {task.role}
              </span>
              <span className="text-[var(--fg2)]">
                {task.modelName || "-"}
              </span>
              {cost && (
                <span className="text-[#39d2c0] font-semibold ml-auto">
                  {cost}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
