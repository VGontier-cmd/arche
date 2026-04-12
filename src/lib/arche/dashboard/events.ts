import { EventEmitter } from "node:events";

export const dashboardEvents = new EventEmitter();
dashboardEvents.setMaxListeners(50);

export function notifyDashboardChanged() {
  dashboardEvents.emit("changed");
}
