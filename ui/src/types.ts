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
