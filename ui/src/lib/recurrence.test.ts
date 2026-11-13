import { describe, expect, it } from "vitest";

import {
    expandAll,
    expandOccurrences,
    parsePBDate,
    parseRule,
} from "./recurrence";
import type { PortalEvent } from "../types";

function makeEvent(overrides: Partial<PortalEvent>): PortalEvent {
    return {
        id: "e1",
        title: "Test",
        description: "",
        date_start: "",
        date_end: "",
        all_day: false,
        location: "",
        category: "",
        rrule: "",
        ...overrides,
    };
}

// February 2026 (UTC-deterministic range)
const rangeStart = new Date("2026-02-01T00:00:00.000Z");
const rangeEnd = new Date("2026-03-01T00:00:00.000Z");

describe("parsePBDate", () => {
    it("parses the PocketBase datetime format", () => {
        expect(parsePBDate("2026-02-14 18:00:00.000Z")?.toISOString()).toBe(
            "2026-02-14T18:00:00.000Z",
        );
    });

    it("parses a bare date", () => {
        expect(parsePBDate("2026-02-14")?.toISOString()).toBe(
            "2026-02-14T00:00:00.000Z",
        );
    });

    it("returns null for empty values", () => {
        expect(parsePBDate("")).toBeNull();
        expect(parsePBDate(undefined)).toBeNull();
    });
});

describe("expandOccurrences", () => {
    it("includes a single event inside the range", () => {
        const event = makeEvent({ date_start: "2026-02-14 18:00:00.000Z" });
        const occurrences = expandOccurrences(event, rangeStart, rangeEnd);
        expect(occurrences).toHaveLength(1);
        expect(occurrences[0]!.start.toISOString()).toBe(
            "2026-02-14T18:00:00.000Z",
        );
        expect(occurrences[0]!.end).toBeNull();
    });

    it("excludes single events before and after the range", () => {
        expect(
            expandOccurrences(
                makeEvent({ date_start: "2026-01-05 18:00:00.000Z" }),
                rangeStart,
                rangeEnd,
            ),
        ).toHaveLength(0);
        expect(
            expandOccurrences(
                makeEvent({ date_start: "2026-03-05 18:00:00.000Z" }),
                rangeStart,
                rangeEnd,
            ),
        ).toHaveLength(0);
    });

    it("includes an event starting exactly at the range start and excludes one at the range end", () => {
        expect(
            expandOccurrences(
                makeEvent({ date_start: "2026-02-01 00:00:00.000Z" }),
                rangeStart,
                rangeEnd,
            ),
        ).toHaveLength(1);
        expect(
            expandOccurrences(
                makeEvent({ date_start: "2026-03-01 00:00:00.000Z" }),
                rangeStart,
                rangeEnd,
            ),
        ).toHaveLength(0);
    });

    it("includes a range-spanning event that starts before the range", () => {
        // starts in January, ends inside February
        const event = makeEvent({
            date_start: "2026-01-28 08:00:00.000Z",
            date_end: "2026-02-03 20:00:00.000Z",
        });
        const occurrences = expandOccurrences(event, rangeStart, rangeEnd);
        expect(occurrences).toHaveLength(1);
        expect(occurrences[0]!.start.toISOString()).toBe(
            "2026-01-28T08:00:00.000Z",
        );
        expect(occurrences[0]!.end?.toISOString()).toBe(
            "2026-02-03T20:00:00.000Z",
        );
    });

    it("shows recurring events that started long before the range", () => {
        // weekly Mondays, first occurrence 2025-06-02 (a Monday)
        const event = makeEvent({
            date_start: "2025-06-02 18:00:00.000Z",
            rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO",
        });
        const occurrences = expandOccurrences(event, rangeStart, rangeEnd);
        expect(
            occurrences.map((o) => o.start.toISOString()),
        ).toEqual([
            "2026-02-02T18:00:00.000Z",
            "2026-02-09T18:00:00.000Z",
            "2026-02-16T18:00:00.000Z",
            "2026-02-23T18:00:00.000Z",
        ]);
    });

    it("accepts rrules without the RRULE: prefix", () => {
        const event = makeEvent({
            date_start: "2025-06-02 18:00:00.000Z",
            rrule: "FREQ=WEEKLY;BYDAY=MO",
        });
        expect(
            expandOccurrences(event, rangeStart, rangeEnd),
        ).toHaveLength(4);
    });

    it("respects COUNT limits that are partly consumed before the range", () => {
        // 10 weekly Mondays from 2025-06-02 -> exhausted way before Feb 2026
        const event = makeEvent({
            date_start: "2025-06-02 18:00:00.000Z",
            rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10",
        });
        expect(expandOccurrences(event, rangeStart, rangeEnd)).toHaveLength(0);
    });

    it("applies COUNT while the series still runs into the range", () => {
        // weekly, 5 occurrences starting 2026-01-26 (Monday)
        const event = makeEvent({
            date_start: "2026-01-26 18:00:00.000Z",
            rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=5",
        });
        const occurrences = expandOccurrences(event, rangeStart, rangeEnd);
        expect(
            occurrences.map((o) => o.start.toISOString()),
        ).toEqual([
            "2026-02-02T18:00:00.000Z",
            "2026-02-09T18:00:00.000Z",
            "2026-02-16T18:00:00.000Z",
            "2026-02-23T18:00:00.000Z", // 5th occurrence; COUNT stops before Mar
        ]);
    });

    it("respects an UNTIL date before the range", () => {
        const event = makeEvent({
            date_start: "2025-06-02 18:00:00.000Z",
            rrule:
                "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260101T000000Z",
        });
        expect(expandOccurrences(event, rangeStart, rangeEnd)).toHaveLength(0);
    });

    it("expands a monthly rule from a start date months earlier", () => {
        const event = makeEvent({
            date_start: "2025-03-10 09:00:00.000Z",
            rrule: "RRULE:FREQ=MONTHLY",
        });
        const occurrences = expandOccurrences(event, rangeStart, rangeEnd);
        expect(
            occurrences.map((o) => o.start.toISOString()),
        ).toEqual(["2026-02-10T09:00:00.000Z"]);
    });

    it("keeps the duration for recurring events with a date_end", () => {
        const event = makeEvent({
            date_start: "2025-06-02 18:00:00.000Z",
            date_end: "2025-06-02 20:00:00.000Z",
            rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO",
        });
        const occurrences = expandOccurrences(event, rangeStart, rangeEnd);
        expect(occurrences).toHaveLength(4);
        expect(occurrences[0]!.start.toISOString()).toBe(
            "2026-02-02T18:00:00.000Z",
        );
        expect(occurrences[0]!.end?.toISOString()).toBe(
            "2026-02-02T20:00:00.000Z",
        );
    });
});

describe("expandAll", () => {
    it("indexes single-day occurrences by local day key", () => {
        const events = [
            makeEvent({ id: "a", date_start: "2026-02-14 18:00:00.000Z" }),
        ];
        const byDay = expandAll(events, rangeStart, rangeEnd);
        expect([...byDay.keys()]).toEqual(["2026-02-14"]);
    });

    it("adds a multi-day event to every covered day (clipped to the range)", () => {
        const events = [
            makeEvent({
                id: "a",
                date_start: "2026-01-30 08:00:00.000Z",
                date_end: "2026-02-03 20:00:00.000Z",
            }),
        ];
        const byDay = expandAll(events, rangeStart, rangeEnd);
        expect([...byDay.keys()]).toEqual([
            "2026-02-01",
            "2026-02-02",
            "2026-02-03",
        ]);
    });

    it("groups recurring expansions under their occurrence days", () => {
        const events = [
            makeEvent({
                id: "a",
                date_start: "2025-06-02 18:00:00.000Z",
                rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO",
            }),
        ];
        const byDay = expandAll(events, rangeStart, rangeEnd);
        expect([...byDay.keys()]).toEqual([
            "2026-02-02",
            "2026-02-09",
            "2026-02-16",
            "2026-02-23",
        ]);
    });

    it("returns an empty map without events", () => {
        expect(expandAll([], rangeStart, rangeEnd).size).toBe(0);
    });
});

describe("parseRule", () => {
    it("returns null for empty rules", () => {
        expect(parseRule("")).toBeNull();
        expect(parseRule(null)).toBeNull();
        expect(parseRule(undefined)).toBeNull();
    });

    it("returns null for malformed rules", () => {
        expect(parseRule("NOTARULE")).toBeNull();
    });

    it("summarizes a plain weekly rule", () => {
        expect(parseRule("RRULE:FREQ=WEEKLY")).toEqual({
            freq: "WEEKLY",
            interval: 1,
            byWeekdays: [],
            until: null,
            count: null,
        });
    });

    it("summarizes BYDAY, INTERVAL, COUNT and UNTIL", () => {
        expect(parseRule("RRULE:FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=2")).toEqual({
            freq: "WEEKLY",
            interval: 2,
            byWeekdays: [0, 2],
            until: null,
            count: null,
        });
        expect(parseRule("FREQ=YEARLY;COUNT=5")).toEqual({
            freq: "YEARLY",
            interval: 1,
            byWeekdays: [],
            until: null,
            count: 5,
        });
        const monthly = parseRule("FREQ=MONTHLY;UNTIL=20260601T000000Z");
        expect(monthly?.until?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
        expect(parseRule("FREQ=DAILY")?.freq).toBe("DAILY");
    });
});
