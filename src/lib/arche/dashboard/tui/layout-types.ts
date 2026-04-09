export type ProjectSummary = {
  key: string;
  total: number;
  inbox: number;
  active: number;
  failed: number;
  done: number;
};

export type DashboardLayout = {
  header: string;
  left: string;
  detailLabel: string;
  detail: string;
  timeline: string;
  footer: string;
  modalTitle: string | null;
  modalBody: string | null;
};
