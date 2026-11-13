// Small date helpers. All formatting goes through Intl so dates and
// times are localized (de default, en available).

export function pad2(value: number): string {
    return String(value).padStart(2, "0");
}

// Local calendar day key "YYYY-MM-DD" (in the viewer's timezone).
export function dayKeyOf(date: Date): string {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// PocketBase boundary literal in the canonical store format. The wall
// clock given here is interpreted as-is (PocketBase parses the trailing
// Z as UTC), which matches how DateField values are stored.
export function pbDateLiteral(
    year: number,
    month: number, // 1-based
    day: number,
    hours = 0,
    minutes = 0,
): string {
    return `${year}-${pad2(month)}-${pad2(day)} ${pad2(hours)}:${pad2(minutes)}:00.000Z`;
}

export function formatMonthTitle(date: Date, locale: string): string {
    return new Intl.DateTimeFormat(locale, {
        month: "long",
        year: "numeric",
    }).format(date);
}

// Weekday labels, Monday first, localized (7 entries).
export function weekdayLabels(locale: string): string[] {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
    // 2024-01-01 is a Monday.
    const labels: string[] = [];
    for (let i = 0; i < 7; i++) {
        labels.push(fmt.format(new Date(Date.UTC(2024, 0, 1 + i))));
    }
    return labels;
}

// Localized weekday label for a single date (0 = Monday ... 6 = Sunday,
// as used by rrule's byweekday).
export function weekdayLabel(weekdayIndex: number, locale: string): string {
    return weekdayLabels(locale)[((weekdayIndex % 7) + 7) % 7];
}

export function formatLongDate(date: Date, locale: string): string {
    return new Intl.DateTimeFormat(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
    }).format(date);
}

export function formatShortDate(date: Date, locale: string): string {
    return new Intl.DateTimeFormat(locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
    }).format(date);
}

export function formatTime(date: Date, locale: string): string {
    return new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);
}
