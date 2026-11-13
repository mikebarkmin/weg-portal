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
    // which of the three calendars the event belongs to (migration
    // 1795000105); older API responses may lack it -> public
    calendar?: CalendarId;
}

export type CalendarId = "public" | "owners" | "beirat";
export type Visibility = "public" | "owners";

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
    created?: string;
    calendar?: CalendarId | "";
}

// Shared client-side view of the PocketBase `issues` records as shown on
// the issue board and detail page (M9). Exact coordinates are only
// unhidden for beirat/hausmeister/hausverwaltung (enrich hook, M2) -
// residents' records have no lat_exact/lng_exact and the rounded
// lat/lng are used instead. `photos` holds the protected file names
// (viewable only with a file token, plan.md "Files").
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
    // autodate, set by the server on create (migration 1795000104;
    // empty for records created before it)
    created?: string;
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

export interface PortalAnnouncement {
    id: string;
    title: string;
    body: string; // markdown
    visibility: Visibility;
    pinned: boolean;
    expires_at: string;
    author: string;
    created: string;
    updated: string;
    expand?: { author?: { id: string; name: string } };
}

export type ContactCategory = "beirat" | "verwaltung" | "hausmeister" | "notdienst" | "sonstiges";

export interface PortalContact {
    id: string;
    name: string;
    function: string;
    category: ContactCategory;
    phone: string;
    email: string;
    note: string;
    sort: number;
    visibility: Visibility;
}

export type DocumentCategory =
    | "hausordnung"
    | "protokoll"
    | "beschluss"
    | "wirtschaftsplan"
    | "abrechnung"
    | "vertrag"
    | "sonstiges";

export interface PortalDocument {
    id: string;
    title: string;
    description: string;
    category: DocumentCategory;
    file: string;
    visibility: Visibility;
    document_date: string;
    created: string;
}

export interface IssueEvent {
    id: string;
    issue: string;
    actor: string;
    type: "status" | "note";
    from_status: string;
    to_status: string;
    note: string;
    created: string;
    expand?: { actor?: { id: string; name: string } };
}

export interface AgendaItem {
    id: string;
    title: string;
    description: string;
    author: string;
    status: "pending" | "accepted" | "rejected";
    decision_note: string;
    decided_at: string;
    created: string;
    expand?: { author?: { id: string; name: string } };
}

export interface Poll {
    id: string;
    question: string;
    description: string;
    options: string[];
    closes_at: string;
    created_by: string;
    created: string;
}

export interface PollVote {
    id: string;
    poll: string;
    user: string;
    option: number;
}
