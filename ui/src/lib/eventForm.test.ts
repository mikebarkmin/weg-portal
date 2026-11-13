import { describe, expect, it } from "vitest";

import {
    buildEventPayload,
    buildRRule,
    emptyEventForm,
    eventToForm,
    parseEditableRule,
    validateEventForm,
    type EventFormValues,
} from "./eventForm";
import { expandAll } from "./recurrence";
import type { PortalEvent } from "../types";

function form(overrides: Partial<EventFormValues>): EventFormValues {
    return { ...emptyEventForm(), title: "Treffen", date_start: "2026-12-01T19:00", ...overrides };
}

describe("buildRRule", () => {
    it("is empty without recurrence", () => {
        expect(buildRRule(form({}))).toBe("");
    });

    it("builds weekly rules with interval, weekdays and count", () => {
        expect(
            buildRRule(form({ freq: "WEEKLY", interval: 2, weekdays: [2, 0], repeatEnd: "count", count: 5 })),
        ).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=5");
    });

    it("uses a DATE until for all-day series and an end-of-day UTC until otherwise", () => {
        expect(buildRRule(form({ freq: "MONTHLY", repeatEnd: "until", until: "2027-06-30", all_day: true }))).toBe(
            "FREQ=MONTHLY;UNTIL=20270630",
        );
        expect(buildRRule(form({ freq: "DAILY", repeatEnd: "until", until: "2027-06-30" }))).toBe(
            "FREQ=DAILY;UNTIL=20270630T235959Z",
        );
    });

    it("keeps a custom rule verbatim", () => {
        expect(buildRRule(form({ freq: "WEEKLY", customRule: "FREQ=MONTHLY;BYDAY=1MO" }))).toBe(
            "FREQ=MONTHLY;BYDAY=1MO",
        );
    });
});

describe("parseEditableRule", () => {
    it("round-trips builder rules", () => {
        for (const rule of [
            "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=5",
            "FREQ=DAILY;UNTIL=20270630T235959Z",
            "FREQ=YEARLY",
        ]) {
            const parsed = parseEditableRule(rule);
            expect(parsed.customRule).toBe("");
            expect(buildRRule(form({ ...parsed }))).toBe(rule);
        }
    });

    it("reports rules the builder cannot represent as custom", () => {
        expect(parseEditableRule("FREQ=MONTHLY;BYDAY=1MO").customRule).toBe("FREQ=MONTHLY;BYDAY=1MO");
        expect(parseEditableRule("FREQ=MONTHLY;BYMONTHDAY=15").customRule).toBe("FREQ=MONTHLY;BYMONTHDAY=15");
    });
});

describe("validateEventForm", () => {
    it("accepts a minimal event", () => {
        expect(validateEventForm(form({}))).toEqual({});
    });

    it("requires title and start, and an end after the start", () => {
        const errors = validateEventForm(form({ title: " ", date_start: "", date_end: "2026-12-01T18:00" }));
        expect(errors.title).toBe("validation.required");
        expect(errors.date_start).toBe("validation.required");

        expect(validateEventForm(form({ date_end: "2026-12-01T18:00" })).date_end).toBe("validation.dateEndBeforeStart");
    });

    it("checks the recurrence fields", () => {
        expect(validateEventForm(form({ freq: "DAILY", interval: 0 })).interval).toBeDefined();
        expect(validateEventForm(form({ freq: "DAILY", repeatEnd: "until", until: "" })).until).toBe("validation.required");
        expect(validateEventForm(form({ freq: "DAILY", repeatEnd: "until", until: "2026-11-01" })).until).toBe(
            "eventEditor.error.untilBeforeStart",
        );
        expect(validateEventForm(form({ customRule: "FREQ=NONSENSE" })).customRule).toBeDefined();
    });
});

describe("buildEventPayload / eventToForm", () => {
    it("stores all-day dates as UTC midnight and round-trips them", () => {
        const payload = buildEventPayload(
            form({ all_day: true, date_start: "2026-12-24", date_end: "2026-12-26", freq: "YEARLY" }),
        );
        expect(payload.date_start).toBe("2026-12-24T00:00:00.000Z");
        expect(payload.date_end).toBe("2026-12-26T00:00:00.000Z");
        expect(payload.rrule).toBe("FREQ=YEARLY");

        const event: PortalEvent = {
            id: "e1",
            ...payload,
            date_start: "2026-12-24 00:00:00.000Z",
            date_end: "2026-12-26 00:00:00.000Z",
        };
        const back = eventToForm(event);
        expect(back.date_start).toBe("2026-12-24");
        expect(back.date_end).toBe("2026-12-26");
        expect(back.freq).toBe("YEARLY");
    });

    it("round-trips timed values in local time", () => {
        const payload = buildEventPayload(form({ date_start: "2026-12-01T19:00", date_end: "2026-12-01T21:30" }));
        const back = eventToForm({ id: "e1", ...payload });
        expect(back.date_start).toBe("2026-12-01T19:00");
        expect(back.date_end).toBe("2026-12-01T21:30");
    });

    it("produces series the calendar expands as intended", () => {
        const payload = buildEventPayload(
            form({ date_start: "2026-12-01T19:00", freq: "WEEKLY", weekdays: [1, 3], repeatEnd: "count", count: 4 }),
        );
        const byDay = expandAll([{ id: "e1", ...payload }], new Date(2026, 11, 1), new Date(2027, 0, 1));
        // 1 Dec 2026 is a Tuesday: Tue/Thu x 4
        expect([...byDay.keys()]).toEqual(["2026-12-01", "2026-12-03", "2026-12-08", "2026-12-10"]);
    });
});
