// The portal time zone (PORTAL_TIMEZONE on the server, delivered by
// GET /api/portal/config - see lib/portalConfig.ts). Recurring timed
// events repeat at the same LOCAL wall time in this zone, independent of
// the viewer's own zone, exactly like the iCal export (TZID) does.

let portalTimeZone = "Europe/Berlin";

export function getPortalTimeZone(): string {
    return portalTimeZone;
}

// Applies the configured zone (ignored unless the runtime knows it).
export function setPortalTimeZone(name: unknown): boolean {
    if (typeof name !== "string" || !name.trim()) return false;
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: name });
    } catch {
        return false;
    }
    portalTimeZone = name;
    formatters.clear();
    return true;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
    let fmt = formatters.get(timeZone);
    if (!fmt) {
        fmt = new Intl.DateTimeFormat("en-US", {
            timeZone,
            hourCycle: "h23",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
        formatters.set(timeZone, fmt);
    }
    return fmt;
}

// The wall-clock time of `instant` in `timeZone`, returned as a Date whose
// UTC fields carry those digits ("floating" time - rrule expands on UTC
// fields, so a series expanded on these digits keeps its local time).
export function toZonedDigits(instant: Date, timeZone = portalTimeZone): Date {
    const parts: Record<string, number> = {};
    for (const part of formatterFor(timeZone).formatToParts(instant)) {
        if (part.type !== "literal") parts[part.type] = Number(part.value);
    }
    return new Date(
        Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!, instant.getUTCMilliseconds()),
    );
}

// Inverse of toZonedDigits: the instant at which `timeZone` shows the wall
// time carried in the UTC fields of `digits`. Wall times inside a spring-
// forward gap resolve to the instant one offset later (e.g. 02:30 -> 03:30);
// the repeated autumn hour resolves to its second (standard-time) instance.
export function fromZonedDigits(digits: Date, timeZone = portalTimeZone): Date {
    const offsetAt = (instant: number) =>
        toZonedDigits(new Date(instant), timeZone).getTime() - instant;
    const guess = digits.getTime();
    const first = guess - offsetAt(guess);
    const second = guess - offsetAt(first);
    return new Date(second);
}
