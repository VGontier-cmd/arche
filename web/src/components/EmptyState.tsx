export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: string;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="text-3xl mb-3 opacity-40">{icon}</div>
      <h3 className="text-sm font-semibold text-[var(--color-base-content)] mb-1">
        {title}
      </h3>
      <p className="text-xs text-[var(--fg2)] mb-4 max-w-[280px]">
        {description}
      </p>
      {actionLabel && onAction && (
        <button className="btn-primary" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
