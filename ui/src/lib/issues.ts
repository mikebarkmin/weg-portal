import type { PortalIssue } from "../types";

// Roles that receive the exact coordinates (lat_exact/lng_exact are
// unhidden for them by the enrich hook, hooks/issueEnrich.go). The role is
// checked EXPLICITLY: even if the API ever shipped exact fields to a
// resident, no rendering path would place a marker on them (defense in
// depth on top of the enrich hook).
export const SEES_EXACT_COORDS: ReadonlySet<string> = new Set([
    "beirat",
    "hausmeister",
    "hausverwaltung",
]);

// Whether the reporter marked a map point at all (it is optional; an
// unmarked issue keeps lat/lng at 0, far outside every community box).
export function hasLocation(issue: PortalIssue): boolean {
    return (
        Number.isFinite(issue.lat) &&
        Number.isFinite(issue.lng) &&
        !(issue.lat === 0 && issue.lng === 0)
    );
}

// The exact position, or null when the viewer may not / does not get it.
export function exactPositionOf(issue: PortalIssue, role: string): [number, number] | null {
    if (
        hasLocation(issue) &&
        SEES_EXACT_COORDS.has(role) &&
        typeof issue.lat_exact === "number" &&
        typeof issue.lng_exact === "number" &&
        Number.isFinite(issue.lat_exact) &&
        Number.isFinite(issue.lng_exact)
    ) {
        return [issue.lat_exact, issue.lng_exact];
    }
    return null;
}

// Where the issue is drawn: exact for staff, rounded otherwise; null
// when the issue has no location.
export function positionOf(issue: PortalIssue, role: string): [number, number] | null {
    if (!hasLocation(issue)) return null;
    return exactPositionOf(issue, role) ?? [issue.lat, issue.lng];
}

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
