/**
 * Thin shim. The real component is StatusPill (token-driven). This file keeps
 * the historical import paths working until every call site is migrated.
 */

import { StatusPill } from "./ui/StatusPill";
import { statusLabel as _statusLabel } from "./ui/tokens";

export function StatusBadge({ status, mrUrl }: { status: string; mrUrl?: string | null }) {
  return <StatusPill status={status} mrUrl={mrUrl} size="sm" />;
}

export const statusLabel = _statusLabel;
