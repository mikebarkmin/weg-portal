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

// Shared client-side view of the PocketBase `issues` records as shown on
// the issue board and detail page (M9). Exact coordinates are only
// unhidden for beirat/hausmeister/hausverwaltung (enrich hook, M2) -
// residents' records have no lat_exact/lng_exact and the rounded
// lat/lng are used instead. `photos` holds the protected file names
// (viewable only with a file token, plan.md "Files"). NOTE: the
// collection has NO autodate fields (M1) - decided_at/resolved_at (set
// by the workflow hook) are the only timestamps.
export interface PortalIssue {
    id: string;
    title: string;
    description: string;
    category: string;
    lat: number;
    lng: number;
    status: "pending" | "open" | "in_progress" | "resolved" | "rejected";
    visibility: IssueVisibilityValue;
    photos: string[];
    decided_at: string;
    resolved_at: string;
    lat_exact?: number;
    lng_exact?: number;
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

// Shared client-side view of the PocketBase `notes` collection
// (internal Beirat notes, M10). `body` holds the RAW markdown as
// stored in the editor field; rendering + sanitization happen
// client-side only (lib/markdown.ts). `author` is set from the auth
// record on create (the server rule requires author = self) and is
// never part of an update payload.
export interface PortalNote {
    id: string;
    title: string;
    body: string;
    author: string;
    pinned: boolean;
    expand?: {
        author?: {
            id: string;
            name: string;
        };
    };
}
