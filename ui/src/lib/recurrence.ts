import { RRule } from "rrule";
import type { PortalEvent } from "../types";
import { dayKeyOf } from "./dates";
import { fromZonedDigits, toZonedDigits } from "./timezone";

export interface Occurrence {
    event: PortalEvent;
    start: Date;
    end: Date | null; // null when the occurrence has no date_end
    allDay: boolean;
}

export interface RuleSummary {
    freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
    interval: number;
    byWeekdays: number[]; // 0 = Monday ... 6 = Sunday (rrule convention)
    until: Date | null;
    count: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Parses a PocketBase date value ("YYYY-MM-DD HH:mm:ss.SSSZ" or
// "YYYY-MM-DD") into a Date.
export function parsePBDate(value: string | null | undefined): Date | null {
    if (!value) {
        return null;
    }
    const normalized = value.includes("T")
        ? value
        : value.replace(" ", "T");
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeRuleText(rule: string): string {
    return rule.trim().replace(/^rrule:/i, "");
}

// Human-usable summary of an RFC 5545 recurrence rule (used to render
// the "Wiederholung" line and localize it in the components).
export function parseRule(
    rule: string | null | undefined,
): RuleSummary | null {
    if (!rule || !rule.trim()) {
        return null;
    }
    let options: Record<string, unknown>;
    try {
        options = RRule.parseString(normalizeRuleText(rule)) as Record<
            string,
            unknown
        >;
    } catch {
        return null;
    }
    const freqIndex = options.freq;
    if (typeof freqIndex !== "number") {
        return null;
    }
    const freqName = RRule.FREQUENCIES[freqIndex]?.toUpperCase();
    if (
        freqName !== "DAILY" &&
        freqName !== "WEEKLY" &&
        freqName !== "MONTHLY" &&
        freqName !== "YEARLY"
    ) {
        return null;
    }
    const byWeekdays = Array.isArray(options.byweekday)
        ? options.byweekday.map((day) =>
              typeof day === "number" ? day : (day as { weekday: number }).weekday,
          )
        : [];
    const interval =
        typeof options.interval === "number" && options.interval > 0
            ? options.interval
            : 1;
    let until: Date | null = null;
    if (options.until instanceof Date) {
        until = options.until;
    } else if (typeof options.until === "string") {
        const parsed = new Date(options.until);
        until = Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const count = typeof options.count === "number" ? options.count : null;
    return { freq: freqName, interval, byWeekdays, until, count };
}

// All-day events are stored as a calendar DATE: "YYYY-MM-DD 00:00:00.000Z"
// (UTC midnight of that date). Older clients sent local midnight converted
// to UTC (e.g. 23:00Z of the previous day in Germany), so the stored value
// is rounded to the NEAREST UTC midnight - both forms map to the same date.
export function allDayUTCDate(date: Date): Date {
    return new Date(Math.round(date.getTime() / DAY_MS) * DAY_MS);
}

// UTC-midnight date -> local midnight of the same calendar date.
function utcDateToLocal(date: Date): Date {
    return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

// A stored event date as the Date to DISPLAY: timed values are instants,
// all-day values become local midnight of their calendar date.
export function displayDate(value: string | null | undefined, allDay: boolean): Date | null {
    const date = parsePBDate(value);
    if (!date || !allDay) {
        return date;
    }
    return utcDateToLocal(allDayUTCDate(date));
}

// Local wall-clock time -> the same wall-clock digits in UTC.
function localToUTCDigits(date: Date): Date {
    return new Date(
        Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()),
    );
}

// Expands a single event into its occurrences within
// [rangeStart, rangeEndExclusive). Recurring events are expanded even
// when their first occurrence (date_start) long predates the range.
//
// All-day occurrences are returned at LOCAL midnight of their calendar
// date (end = local midnight of the last covered day), independent of
// the viewer's UTC offset.
//
// Recurring TIMED events repeat at the same wall-clock time in the portal
// time zone (lib/timezone.ts): "every Tuesday 18:30" stays 18:30 across
// DST changes, matching the iCal export (DTSTART;TZID=...).
export function expandOccurrences(
    event: PortalEvent,
    rangeStart: Date,
    rangeEndExclusive: Date,
): Occurrence[] {
    if (!event.all_day && event.rrule && event.rrule.trim()) {
        const start = parsePBDate(event.date_start);
        const end = parsePBDate(event.date_end);
        return expandInstants(
            event,
            start ? toZonedDigits(start) : null,
            end ? toZonedDigits(end) : null,
            toZonedDigits(rangeStart),
            toZonedDigits(rangeEndExclusive),
            // UNTIL is a real UTC instant: compare it in the same digits
            (until) => toZonedDigits(until),
        ).map((occurrence) => ({
            ...occurrence,
            start: fromZonedDigits(occurrence.start),
            end: occurrence.end ? fromZonedDigits(occurrence.end) : null,
        }));
    }
    if (!event.all_day) {
        return expandInstants(event, parsePBDate(event.date_start), parsePBDate(event.date_end), rangeStart, rangeEndExclusive);
    }
    const start = parsePBDate(event.date_start);
    const end = parsePBDate(event.date_end);
    // expand on UTC dates against the range expressed in the same digits,
    // then map every occurrence back to local midnight
    return expandInstants(
        event,
        start ? allDayUTCDate(start) : null,
        end ? allDayUTCDate(end) : null,
        localToUTCDigits(rangeStart),
        localToUTCDigits(rangeEndExclusive),
    ).map((occurrence) => ({
        ...occurrence,
        start: utcDateToLocal(occurrence.start),
        end: occurrence.end ? utcDateToLocal(occurrence.end) : null,
    }));
}

function expandInstants(
    event: PortalEvent,
    start: Date | null,
    end: Date | null,
    rangeStart: Date,
    rangeEndExclusive: Date,
    mapUntil?: (until: Date) => Date,
): Occurrence[] {
    if (!start || start >= rangeEndExclusive) {
        return [];
    }

    if (!event.rrule || !event.rrule.trim()) {
        // single event: include when it overlaps the range
        const occEnd = end && end >= start ? end : start;
        if (occEnd < rangeStart) {
            return [];
        }
        return [
            {
                event,
                start,
                end: end && end >= start ? end : null,
                allDay: event.all_day,
            },
        ];
    }

    let rule: RRule;
    try {
        const options = RRule.parseString(normalizeRuleText(event.rrule)!);
        if (mapUntil && options.until) {
            options.until = mapUntil(options.until);
        }
        rule = new RRule({ ...options, dtstart: start });
    } catch {
        // malformed rule - treat the event as a single event instead of
        // crashing the calendar
        return [
            {
                event,
                start,
                end: end && end >= start ? end : null,
                allDay: event.all_day,
            },
        ];
    }
    const duration =
        end && end > start ? end.getTime() - start.getTime() : 0;
    // look back by the duration so occurrences that start before the
    // range but still overlap it are found
    const searchStart =
        duration > 0 ? new Date(rangeStart.getTime() - duration) : rangeStart;
    const occurrences: Occurrence[] = [];
    const dates = rule.between(
        searchStart,
        new Date(rangeEndExclusive.getTime() - 1),
        true,
    );
    for (const date of dates) {
        const occEnd =
            duration > 0 ? new Date(date.getTime() + duration) : null;
        if (occEnd ? occEnd < rangeStart : date < rangeStart) {
            continue;
        }
        occurrences.push({
            event,
            start: date,
            end: occEnd,
            allDay: event.all_day,
        });
    }
    return occurrences;
}

// Expands all events and indexes the occurrences by local calendar day.
// Occurrences spanning multiple days appear on every covered day
// (clipped to the range), so the month grid marks a 3-day event on all
// three days.
export function expandAll(
    events: PortalEvent[],
    rangeStart: Date,
    rangeEndExclusive: Date,
): Map<string, Occurrence[]> {
    const byDay = new Map<string, Occurrence[]>();
    for (const event of events) {
        for (const occurrence of expandOccurrences(
            event,
            rangeStart,
            rangeEndExclusive,
        )) {
            const occEnd = occurrence.end ?? occurrence.start;
            let day = new Date(
                Math.max(occurrence.start.getTime(), rangeStart.getTime()),
            );
            // cap runaway spans defensively
            let guard = 0;
            while (day.getTime() <= occEnd.getTime() && guard < 400) {
                const key = dayKeyOf(day);
                const list = byDay.get(key);
                if (list) {
                    list.push(occurrence);
                } else {
                    byDay.set(key, [occurrence]);
                }
                day = new Date(day.getTime() + DAY_MS);
                guard++;
            }
        }
    }
    for (const list of byDay.values()) {
        list.sort((a, b) => a.start.getTime() - b.start.getTime());
    }
    return byDay;
}
