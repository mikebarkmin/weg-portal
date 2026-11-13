import type { CalendarId } from "../types";

// The three calendars (migration 1795000105). Colors are BugStage tokens.
export const CALENDARS: { id: CalendarId; colorVar: string; icon: string }[] = [
    { id: "public", colorVar: "--infoColor", icon: "ri-global-line" },
    { id: "owners", colorVar: "--successColor", icon: "ri-home-heart-line" },
    { id: "beirat", colorVar: "--warningColor", icon: "ri-shield-user-line" },
];

export function calendarOf(event: { calendar?: string }): CalendarId {
    return event.calendar === "owners" || event.calendar === "beirat" ? event.calendar : "public";
}

// Which calendars a role/account may see (mirrors the events rules; the
// server stays authoritative).
export function visibleCalendars(role: string, isOwnerAccount: boolean): CalendarId[] {
    if (role === "beirat") return ["public", "owners", "beirat"];
    if (isOwnerAccount) return ["public", "owners"];
    return ["public"];
}
