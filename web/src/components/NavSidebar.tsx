import {
  Activity,
  BarChart3,
  Clock,
  FolderGit2,
  HelpCircle,
  Plus,
  Settings as SettingsIcon,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import type { AppView, DashboardSummary } from "../types";
import { Logo } from "./ui/Logo";

interface NavItem {
  view: AppView;
  label: string;
  Icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { view: "runs",         label: "Runs",     Icon: Activity },
  { view: "repositories", label: "Repos",    Icon: FolderGit2 },
  { view: "rules",        label: "Rules",    Icon: SlidersHorizontal },
  { view: "schedules",    label: "Cron",     Icon: Clock },
  { view: "metrics",      label: "Metrics",  Icon: BarChart3 },
  { view: "settings",     label: "Settings", Icon: SettingsIcon },
];

export function NavSidebar({
  activeView,
  onChangeView,
  onTriggerRun,
  onHelp,
  summary,
}: {
  activeView: AppView;
  onChangeView: (view: AppView) => void;
  onTriggerRun: () => void;
  onHelp?: () => void;
  summary: DashboardSummary | null;
}) {
  return (
    <div
      className="shrink-0 flex flex-col items-center"
      style={{
        width: 60,
        background: "var(--surface-1)",
        borderRight: "1px solid var(--hairline)",
        paddingTop: 12,
        paddingBottom: 12,
        gap: 4,
      }}
    >
      {/* Brand anchor — the monogram at the top of the rail */}
      <div
        aria-hidden="true"
        style={{
          height: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 8,
        }}
      >
        <Logo variant="monogram" size={28} ariaLabel="Arche" />
      </div>

      {/* Hairline separator under the brand */}
      <span
        aria-hidden="true"
        style={{
          width: 24,
          height: 1,
          background: "var(--hairline)",
          marginBottom: 6,
        }}
      />

      {NAV_ITEMS.map((item) => {
        const isActive = activeView === item.view;
        const badge =
          item.view === "runs" && summary ? summary.inboxCount : null;
        const href = `#/${item.view}`;
        return (
          <a
            key={item.view}
            href={href}
            onClick={(e) => {
              // Let modifier-clicks (Cmd/Ctrl/Shift, middle-click) flow to
              // the browser so they open a new tab as expected. Bare clicks
              // run our optimistic state update and let the hashchange
              // handler reconcile.
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              onChangeView(item.view);
            }}
            aria-label={
              badge !== null && badge > 0
                ? `${item.label} (${badge} pending)`
                : item.label
            }
            aria-current={isActive ? "page" : undefined}
            className="relative flex flex-col items-center justify-center"
            style={{
              width: 44,
              height: 44,
              gap: 2,
              borderRadius: "var(--radius-sm)",
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              textDecoration: "none",
              background: isActive ? "var(--surface-2)" : "transparent",
              color: isActive
                ? "var(--c-blue-200)"
                : "var(--c-fog-300)",
              boxShadow: isActive ? "var(--glow-blue)" : undefined,
              border: "none",
              cursor: "pointer",
              transition:
                "background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)",
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = "var(--surface-2)";
                e.currentTarget.style.color = "var(--c-fog-100)";
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--c-fog-300)";
              }
            }}
          >
            {/* Active spine on the left edge */}
            {isActive && (
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: -10,
                  top: 8,
                  bottom: 8,
                  width: 2,
                  background: "var(--c-blue-400)",
                  borderRadius: "0 2px 2px 0",
                }}
              />
            )}
            <item.Icon size={16} strokeWidth={1.75} aria-hidden="true" />
            <span aria-hidden="true">{item.label}</span>
            {badge !== null && badge > 0 && (
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: 2,
                  right: 2,
                  minWidth: 14,
                  height: 14,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "var(--radius-pill)",
                  background: "var(--c-gold-300)",
                  color: "var(--c-obsidian)",
                  fontSize: 8,
                  fontWeight: 700,
                  padding: "0 4px",
                  letterSpacing: 0,
                }}
              >
                {badge}
              </span>
            )}
          </a>
        );
      })}

      <div className="flex-1" />

      {onHelp && (
        <button
          onClick={onHelp}
          aria-label="Help & keyboard shortcuts"
          className="flex items-center justify-center"
          style={{
            width: 44,
            height: 36,
            borderRadius: "var(--radius-sm)",
            background: "transparent",
            color: "var(--c-fog-300)",
            border: "none",
            cursor: "pointer",
            transition:
              "background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--surface-2)";
            e.currentTarget.style.color = "var(--c-fog-100)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--c-fog-300)";
          }}
        >
          <HelpCircle size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}

      <button
        onClick={onTriggerRun}
        aria-label="Trigger new run"
        className="flex items-center justify-center"
        style={{
          width: 44,
          height: 44,
          borderRadius: "var(--radius-sm)",
          background: "var(--c-blue-700)",
          color: "var(--c-bone)",
          border: "1px solid var(--c-blue-500)",
          cursor: "pointer",
          transition:
            "background var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--c-blue-500)";
          e.currentTarget.style.boxShadow = "var(--glow-blue)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--c-blue-700)";
          e.currentTarget.style.boxShadow = "";
        }}
      >
        <Plus size={20} strokeWidth={2.5} aria-hidden="true" />
      </button>
    </div>
  );
}
