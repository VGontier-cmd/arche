import type { ReactNode } from "react";
import { Button } from "./ui/Button";

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  /** Either a Lucide icon node, or a legacy string (rendered as text). */
  icon: ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center"
      style={{ padding: "48px 16px" }}
    >
      <div
        aria-hidden="true"
        style={{
          marginBottom: 12,
          color: "var(--c-steel-300)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {typeof icon === "string" ? (
          <span style={{ fontSize: 28 }}>{icon}</span>
        ) : (
          icon
        )}
      </div>
      <h3
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-heading-lg)",
          fontWeight: 700,
          letterSpacing: "-0.005em",
          color: "var(--c-bone)",
          marginBottom: 6,
        }}
      >
        {title}
      </h3>
      <p
        style={{
          fontSize: "var(--text-body-sm)",
          color: "var(--c-fog-300)",
          marginBottom: 16,
          maxWidth: 320,
          lineHeight: 1.5,
        }}
      >
        {description}
      </p>
      {actionLabel && onAction && (
        <Button variant="primary" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
