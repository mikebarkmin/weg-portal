import { describe, expect, it } from "vitest";

import { calendarOf, visibleCalendars } from "./calendars";
import { isOwnerAccount } from "./auth";
import { buildEventPayload, emptyEventForm, eventToForm } from "./eventForm";

describe("calendars", () => {
    it("maps missing or unknown calendars to public", () => {
        expect(calendarOf({})).toBe("public");
        expect(calendarOf({ calendar: "x" })).toBe("public");
        expect(calendarOf({ calendar: "beirat" })).toBe("beirat");
    });

    it("mirrors the events rules per role", () => {
        expect(visibleCalendars("", false)).toEqual(["public"]);
        expect(visibleCalendars("resident", false)).toEqual(["public"]);
        expect(visibleCalendars("resident", true)).toEqual(["public", "owners"]);
        expect(visibleCalendars("hausmeister", true)).toEqual(["public", "owners"]);
        expect(visibleCalendars("beirat", true)).toEqual(["public", "owners", "beirat"]);
        expect(visibleCalendars("admin", false)).toEqual(["public", "owners", "beirat"]);
    });
});

describe("isOwnerAccount", () => {
    it("requires an approved and verified account; beirat and admin always count", () => {
        expect(isOwnerAccount(null)).toBe(false);
        expect(isOwnerAccount({ role: "resident", approved: true, verified: false })).toBe(false);
        expect(isOwnerAccount({ role: "resident", approved: false, verified: true })).toBe(false);
        expect(isOwnerAccount({ role: "resident", approved: true, verified: true })).toBe(true);
        expect(isOwnerAccount({ role: "beirat" })).toBe(true);
        expect(isOwnerAccount({ role: "admin" })).toBe(true);
    });
});

describe("event form calendar", () => {
    it("defaults to public and round-trips the chosen calendar", () => {
        expect(emptyEventForm().calendar).toBe("public");
        const payload = buildEventPayload({
            ...emptyEventForm(),
            title: "Sitzung",
            date_start: "2026-12-03T19:30",
            calendar: "beirat",
        });
        expect(payload.calendar).toBe("beirat");
        expect(eventToForm({ id: "e1", ...payload }).calendar).toBe("beirat");
    });
});
