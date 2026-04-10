import type { ReactNode } from "react";

export type ProjectSummary = {
  key: string;
  total: number;
  inbox: number;
  active: number;
  failed: number;
  done: number;
};

export type DashboardLayout = {
  header: ReactNode;
  metricsRow: ReactNode;
  hostMetricsRow: ReactNode | null;
  left: ReactNode;
  detailLabel: string;
  detail: ReactNode;
  timeline: ReactNode;
  footer: ReactNode;
  modalTitle: string | null;
  modalBody: ReactNode | null;
};
