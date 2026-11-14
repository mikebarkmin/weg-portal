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
    archived: "ri-archive-line",
    rejected: "ri-close-circle-line",
};

// Suggested report categories (offered via <datalist>, free text stays
// possible): consistent spellings make the board search and the Beirat's
// overview more useful. Labels come from issue.categories.<key>.
export const ISSUE_CATEGORY_KEYS = [
    "lighting",
    "doors",
    "waste",
    "garden",
    "elevator",
    "heatingWater",
    "cleanliness",
    "damage",
    "parking",
    "other",
] as const;
