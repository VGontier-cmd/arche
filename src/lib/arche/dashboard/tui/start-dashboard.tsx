import { render } from "ink";
import React from "react";

import { DashboardApp } from "./dashboard-app";

export async function startDashboard() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("arche dashboard requires an interactive terminal");
  }

  const { waitUntilExit } = render(<DashboardApp />);
  await waitUntilExit();
}
