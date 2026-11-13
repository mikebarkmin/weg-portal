// Shared client-side view of the PocketBase `events` collection
// (field names as returned by the API).
export interface PortalEvent {
    id: string;
    title: string;
    description: string;
    date_start: string;
    date_end: string;
    all_day: boolean;
    location: string;
    category: string;
    rrule: string;
}

// Calendar categories used for coloring chips (no styling yet, scaffold).
export const EVENT_CATEGORIES = [
    "meeting",
    "maintenance",
    "community",
    "other",
] as const;

// Shared client-side view of the PocketBase `suggestions` collection
// (fields as returned by the API; `email` is only readable by the Beirat,
// the create response never echoes it).
export interface PortalSuggestion {
    id: string;
    title: string;
    description: string;
    date_start: string;
    date_end: string;
    all_day: boolean;
    location: string;
    category: string;
    email: string;
    status: "pending" | "accepted" | "rejected";
    decision_note: string;
}

// Shared client-side view of the pending `issues` records shown in the
// moderation queue. Exact coordinates are only unhidden for
// beirat/hausmeister/hausverwaltung (enrich hook, M2).
export interface PortalIssue {
    id: string;
    title: string;
    description: string;
    category: string;
    lat: number;
    lng: number;
    status: "pending" | "open" | "in_progress" | "resolved" | "rejected";
    visibility: IssueVisibilityValue;
}

export type IssueVisibilityValue = "community" | "private" | "";

// Shared client-side view of the `users` records as the Beirat sees
// them (list rule: own record or Beirat).
export interface PortalUser {
    id: string;
    name: string;
    email: string;
    role: string;
    approved: boolean;
    verified: boolean;
}
