import { RRule } from "rrule";

import { dayKeyOf, pad2 } from "./dates";
import { displayDate } from "./recurrence";
import { FIELD_LIMITS, toPBDateTime } from "./validation";
import { calendarOf } from "./calendars";
import type { CalendarId, PortalEvent } from "../types";

// Beirat event editor (create/edit/delete events, incl. recurring ones).
// The events collection rules allow create/update/delete for the Beirat
// only (migrations: events.*Rule = B), so this is plain collection CRUD.

export type Frequency = "none" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type RepeatEnd = "never" | "until" | "count";

// rrule weekday order (0 = Monday ... 6 = Sunday) and RFC 5545 codes
export const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

export interface EventFormValues {
    title: string;
    description: string;
    all_day: boolean;
    date_start: string; // "YYYY-MM-DD" (all-day) or "YYYY-MM-DDTHH:mm"
    date_end: string;
    location: string;
    category: string;
    calendar: CalendarId;
    freq: Frequency;
    interval: number;
    weekdays: number[]; // 0 = Monday ... 6 = Sunday
    repeatEnd: RepeatEnd;
    until: string; // "YYYY-MM-DD"
    count: number;
    // a stored rule the builder cannot represent (kept verbatim unless
    // the Beirat explicitly replaces it)
    customRule: string;
}

// The recurrence part of the form, shared by the event editor and the
// (meeting) suggestion forms (NewSuggestion + moderation editor).
export type RecurrenceValues = Pick<
    EventFormValues,
    "freq" | "interval" | "weekdays" | "repeatEnd" | "until" | "count" | "customRule" | "all_day"
>;

// Error keys of the recurrence fields (i18n keys resolved with t()).
export type RecurrenceErrors = Partial<Record<"interval" | "until" | "count" | "customRule", string>>;

const RULE_KEYS_SUPPORTED = new Set(["freq", "interval", "byweekday", "until", "count"]);

// Splits a stored rrule into the builder fields, or reports it as custom
// when it uses parts the builder does not offer (BYMONTHDAY, BYSETPOS, ...).
export function parseEditableRule(
    rule: string,
): Pick<EventFormValues, "freq" | "interval" | "weekdays" | "repeatEnd" | "until" | "count" | "customRule"> {
    const empty = {
        freq: "none" as Frequency,
        interval: 1,
        weekdays: [] as number[],
        repeatEnd: "never" as RepeatEnd,
        until: "",
        count: 10,
        customRule: "",
    };
    const text = rule.trim().replace(/^rrule:/i, "");
    if (!text) return empty;

    let options: Record<string, unknown>;
    try {
        options = RRule.parseString(text) as Record<string, unknown>;
    } catch {
        return { ...empty, customRule: text };
    }
    const keys = Object.keys(options).filter((key) => options[key] !== undefined && options[key] !== null);
    const freqName = typeof options.freq === "number" ? RRule.FREQUENCIES[options.freq] : undefined;
    if (
        keys.some((key) => !RULE_KEYS_SUPPORTED.has(key)) ||
        (freqName !== "DAILY" && freqName !== "WEEKLY" && freqName !== "MONTHLY" && freqName !== "YEARLY")
    ) {
        return { ...empty, customRule: text };
    }

    const byweekday = Array.isArray(options.byweekday)
        ? options.byweekday
        : options.byweekday !== undefined
          ? [options.byweekday]
          : [];
    const weekdays: number[] = [];
    for (const day of byweekday) {
        if (typeof day === "number") {
            weekdays.push(day);
        } else if (day && typeof day === "object" && "weekday" in day) {
            // "2MO" style (nth weekday) is not representable
            if ((day as { n?: number }).n) return { ...empty, customRule: text };
            weekdays.push((day as { weekday: number }).weekday);
        }
    }

    const until = options.until instanceof Date ? options.until : null;
    const count = typeof options.count === "number" ? options.count : null;

    return {
        freq: freqName,
        interval: typeof options.interval === "number" && options.interval > 0 ? options.interval : 1,
        weekdays: [...new Set(weekdays)].sort(),
        repeatEnd: until ? "until" : count ? "count" : "never",
        // UNTIL is stored in UTC; the date the Beirat picked is its UTC date
        until: until
            ? `${until.getUTCFullYear()}-${pad2(until.getUTCMonth() + 1)}-${pad2(until.getUTCDate())}`
            : "",
        count: count ?? 10,
        customRule: "",
    };
}

// The RFC 5545 RRULE value for the builder fields ("" = no recurrence).
// UNTIL is inclusive: the end of the chosen day (all-day series use a DATE
// value, matching DTSTART;VALUE=DATE in the iCal export).
export function buildRRule(values: RecurrenceValues): string {
    if (values.customRule.trim()) {
        return values.customRule.trim();
    }
    if (values.freq === "none") {
        return "";
    }
    const parts = [`FREQ=${values.freq}`];
    if (values.interval > 1) {
        parts.push(`INTERVAL=${values.interval}`);
    }
    if (values.freq === "WEEKLY" && values.weekdays.length > 0) {
        parts.push(`BYDAY=${[...values.weekdays].sort().map((day) => WEEKDAY_CODES[day]).join(",")}`);
    }
    if (values.repeatEnd === "until" && values.until) {
        const compact = values.until.replaceAll("-", "");
        parts.push(values.all_day ? `UNTIL=${compact}` : `UNTIL=${compact}T235959Z`);
    } else if (values.repeatEnd === "count" && values.count > 0) {
        parts.push(`COUNT=${values.count}`);
    }
    return parts.join(";");
}

// A stored date as the value of the date / datetime-local input.
export function toInputValue(stored: string, allDay: boolean): string {
    const date = displayDate(stored, allDay);
    if (!date) return "";
    if (allDay) return dayKeyOf(date);
    return `${dayKeyOf(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function emptyEventForm(): EventFormValues {
    return {
        title: "",
        description: "",
        all_day: false,
        date_start: "",
        date_end: "",
        location: "",
        category: "",
        calendar: "public",
        ...parseEditableRule(""),
    };
}

export function eventToForm(event: PortalEvent): EventFormValues {
    return {
        title: event.title,
        description: event.description,
        all_day: event.all_day,
        date_start: toInputValue(event.date_start, event.all_day),
        date_end: toInputValue(event.date_end, event.all_day),
        location: event.location,
        category: event.category,
        calendar: calendarOf(event),
        ...parseEditableRule(event.rrule ?? ""),
    };
}

function inputTime(value: string, allDay: boolean): number {
    const normalized = allDay ? `${value.slice(0, 10)}T00:00` : value;
    return new Date(normalized).getTime();
}

// Recurrence-field validation, shared by the event editor and the
// suggestion forms. `dateStart` is the form's date/datetime-local start
// value (an UNTIL before the start is rejected). Error messages are
// i18n keys (resolved with t() in the page).
export function validateRecurrence(values: RecurrenceValues, dateStart: string): RecurrenceErrors {
    const errors: RecurrenceErrors = {};
    const start = dateStart ? inputTime(dateStart, values.all_day) : NaN;
    if (!values.customRule && values.freq !== "none") {
        if (!Number.isInteger(values.interval) || values.interval < 1 || values.interval > 99) {
            errors.interval = "eventEditor.error.interval";
        }
        if (values.repeatEnd === "until") {
            if (!values.until) errors.until = "validation.required";
            else if (!Number.isNaN(start) && inputTime(values.until, true) < inputTime(dateStart.slice(0, 10), true)) {
                errors.until = "eventEditor.error.untilBeforeStart";
            }
        }
        if (values.repeatEnd === "count" && (!Number.isInteger(values.count) || values.count < 1 || values.count > 999)) {
            errors.count = "eventEditor.error.count";
        }
    }
    if (values.customRule) {
        // the parser is lenient: unknown values come back as undefined
        let valid = false;
        try {
            const options = RRule.parseString(values.customRule.replace(/^rrule:/i, ""));
            valid = typeof options.freq === "number";
        } catch {
            valid = false;
        }
        if (!valid) {
            errors.customRule = "eventEditor.error.customRule";
        }
    }
    return errors;
}

// Error messages are i18n keys (resolved with t() in the page).
export function validateEventForm(values: EventFormValues): Partial<Record<keyof EventFormValues, string>> {
    const errors: Partial<Record<keyof EventFormValues, string>> = {};
    const title = values.title.trim();
    if (!title) errors.title = "validation.required";
    else if (title.length > FIELD_LIMITS.title) errors.title = "validation.tooLong";
    if (values.description.length > FIELD_LIMITS.description) errors.description = "validation.tooLong";
    if (values.location.length > FIELD_LIMITS.location) errors.location = "validation.tooLong";
    if (values.category.length > FIELD_LIMITS.category) errors.category = "validation.tooLong";

    const start = values.date_start ? inputTime(values.date_start, values.all_day) : NaN;
    if (!values.date_start) errors.date_start = "validation.required";
    else if (Number.isNaN(start)) errors.date_start = "validation.invalidDate";

    if (values.date_end) {
        const end = inputTime(values.date_end, values.all_day);
        if (Number.isNaN(end)) errors.date_end = "validation.invalidDate";
        else if (!Number.isNaN(start) && end < start) errors.date_end = "validation.dateEndBeforeStart";
    }

    Object.assign(errors, validateRecurrence(values, values.date_start));
    return errors;
}

// The record body for create/update.
export function buildEventPayload(values: EventFormValues) {
    return {
        title: values.title.trim(),
        description: values.description.trim(),
        all_day: values.all_day,
        date_start: toPBDateTime(values.date_start, values.all_day),
        date_end: values.date_end ? toPBDateTime(values.date_end, values.all_day) : "",
        location: values.location.trim(),
        category: values.category.trim(),
        calendar: values.calendar,
        rrule: buildRRule(values),
    };
}
