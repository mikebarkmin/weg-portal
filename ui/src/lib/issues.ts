import type { PortalIssue } from "../types";

// Issues that still need attention (the board's default filter).
export const ACTIVE_ISSUE_STATUSES: ReadonlySet<PortalIssue["status"]> = new Set([
    "pending",
    "open",
    "in_progress",
]);

// Remix icon per status (board rows, detail sidebar).
export const STATUS_ICONS: Record<PortalIssue["status"], string> = {
    pending: "ri-time-line",
    open: "ri-checkbox-blank-circle-line",
    in_progress: "ri-tools-line",
    resolved: "ri-checkbox-circle-line",
    rejected: "ri-close-circle-line",
};
