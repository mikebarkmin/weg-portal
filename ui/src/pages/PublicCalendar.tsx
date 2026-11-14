import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { pb } from "../lib/pbClient";
import { buildIcalUrl } from "../lib/ical";
import {
    dayKeyOf,
    formatMonthTitle,
    formatShortDate,
    formatTime,
    pbDateLiteral,
    weekdayLabels,
} from "../lib/dates";
import { expandAll, parseRule, type Occurrence } from "../lib/recurrence";
import { useAuth, useOwnerAccount } from "../lib/auth";
import { CALENDARS, calendarOf, visibleCalendars } from "../lib/calendars";
import type { CalendarId } from "../types";
import PersonalFeed from "../components/PersonalFeed";
import { Page, PageHeading, SidebarMenu } from "../components/Page";
import CalendarBadge from "../components/CalendarBadge";
import type { PortalEvent } from "../types";

interface MonthState {
    events: PortalEvent[];
    loading: boolean;
    error: boolean;
}

const CELL_COUNT = 42; // 6 weeks -> stable grid height
const FREQUENT_DAYS = 10; // a series on this many days of the month is "frequent"

// CSS grid position of a date: Monday-first column.
function mondayFirstWeekday(date: Date): number {
    return (date.getDay() + 6) % 7;
}

function occurrenceDayLink(occurrence: Occurrence): string {
    return `/events/${occurrence.event.id}/${dayKeyOf(occurrence.start)}`;
}

export default function PublicCalendar() {
    const { t, i18n } = useTranslation();
    const locale = i18n.language;
    const auth = useAuth();
    const isOwner = useOwnerAccount();
    const [showPast, setShowPast] = useState(false);
    const calendars = visibleCalendars(auth.role, isOwner);
    const [hidden, setHidden] = useState<CalendarId[]>([]);
    const toggleCalendar = (id: CalendarId) =>
        setHidden((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));

    const [month, setMonth] = useState(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1);
    });
    const [state, setState] = useState<MonthState>({
        events: [],
        loading: true,
        error: false,
    });

    // Range boundaries in local wall-clock terms; formatted as PocketBase
    // date literals (the trailing Z is parsed by PB as UTC, which fits the
    // day granularity of a month grid).
    const range = useMemo(() => {
        const year = month.getFullYear();
        const m = month.getMonth() + 1;
        return {
            startLiteral: pbDateLiteral(year, m, 1),
            endLiteral: pbDateLiteral(
                m === 12 ? year + 1 : year,
                m === 12 ? 1 : m + 1,
                1,
            ),
            start: new Date(year, month.getMonth(), 1),
            end: new Date(
                m === 12 ? year + 1 : year,
                m === 12 ? 1 : m + 1,
            ), // exclusive
        };
    }, [month]);

    useEffect(() => {
        let active = true;
        setState((prev) => ({ ...prev, loading: true, error: false }));
        // Non-recurring events are filtered by the visible range; ALL
        // events with a non-empty rrule are fetched (a range query would
        // miss series that started before the range) and expanded
        // client-side.
        const filter =
            `(date_start <= '${range.endLiteral}' && ` +
            `(date_end >= '${range.startLiteral}' || date_start >= '${range.startLiteral}'))` +
            ` || rrule != ''`;
        pb.collection<PortalEvent>("events")
            .getFullList({ filter, sort: "date_start" })
            .then((events) => {
                if (active) {
                    setState({ events, loading: false, error: false });
                }
            })
            .catch(() => {
                if (active) {
                    setState((prev) => ({
                        ...prev,
                        loading: false,
                        error: true,
                    }));
                }
            });
        return () => {
            active = false;
        };
    }, [range.startLiteral, range.endLiteral, auth.isAuthenticated, auth.role]);

    const shownEvents = useMemo(
        () => state.events.filter((event) => !hidden.includes(calendarOf(event))),
        [state.events, hidden],
    );

    const byDay = useMemo(
        () => expandAll(shownEvents, range.start, range.end),
        [shownEvents, range.start, range.end],
    );

    // Series that fill most of the month (a daily reminder, a weekday
    // rule) would put the same chip into every cell and hide the one-off
    // dates; they are listed once above the grid instead.
    const frequent = useMemo(() => {
        const days = new Map<string, number>();
        const events = new Map<string, PortalEvent>();
        for (const occurrences of byDay.values()) {
            const seen = new Set<string>();
            for (const o of occurrences) {
                if (!o.event.rrule || seen.has(o.event.id)) continue;
                seen.add(o.event.id);
                days.set(o.event.id, (days.get(o.event.id) ?? 0) + 1);
                events.set(o.event.id, o.event);
            }
        }
        const ids = new Set([...days].filter(([, n]) => n >= FREQUENT_DAYS).map(([id]) => id));
        return { ids, events: [...ids].map((id) => events.get(id)!) };
    }, [byDay]);

    // grid cells: 6 weeks starting on the Monday before the 1st
    const cells = useMemo(() => {
        const first = new Date(month.getFullYear(), month.getMonth(), 1);
        const gridStart = new Date(first);
        gridStart.setDate(1 - mondayFirstWeekday(first));
        const result: Date[] = [];
        for (let i = 0; i < CELL_COUNT; i++) {
            result.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
        }
        return result;
    }, [month]);

    const weekdays = weekdayLabels(locale);
    const todayKey = dayKeyOf(new Date());

    // The list below the grid: in the current month it starts today
    // (earlier days can be shown on request); a recurring series appears
    // only once - on its first day in the list - with its rule summary,
    // instead of flooding the list with every repetition.
    const isCurrentMonth = useMemo(() => {
        const now = new Date();
        return now.getFullYear() === month.getFullYear() && now.getMonth() === month.getMonth();
    }, [month]);

    const monthList = useMemo(() => {
        const days: string[] = [];
        const cursor = new Date(range.start);
        while (cursor < range.end) {
            days.push(dayKeyOf(cursor));
            cursor.setDate(cursor.getDate() + 1);
        }
        const fromKey = isCurrentMonth && !showPast ? todayKey : "";
        const seenSeries = new Set<string>();
        let hiddenPast = 0;
        const list: { key: string; date: Date; occurrences: Occurrence[] }[] = [];
        for (const key of days) {
            const all = byDay.get(key) ?? [];
            if (key < fromKey) {
                hiddenPast += all.length > 0 ? 1 : 0;
                continue;
            }
            const occurrences = all.filter((occurrence) => {
                const event = occurrence.event;
                if (!event.rrule) {
                    // multi-day single events are listed on their first visible day only
                    const id = `single:${event.id}`;
                    if (seenSeries.has(id)) return false;
                    seenSeries.add(id);
                    return true;
                }
                if (seenSeries.has(event.id)) return false;
                seenSeries.add(event.id);
                return true;
            });
            if (occurrences.length > 0) {
                const [y, m, d] = key.split("-").map(Number);
                list.push({ key, date: new Date(y!, m! - 1, d!), occurrences });
            }
        }
        return { list, hiddenPast };
    }, [byDay, range.start, range.end, isCurrentMonth, showPast, todayKey]);

    const ruleText = (event: PortalEvent): string => {
        const summary = parseRule(event.rrule);
        if (!summary) return "";
        if (summary.interval > 1) {
            const keys: Record<string, string> = {
                DAILY: "recurrence.intervalDays",
                WEEKLY: "recurrence.intervalWeeks",
                MONTHLY: "recurrence.intervalMonths",
                YEARLY: "recurrence.intervalYears",
            };
            return t(keys[summary.freq]!, { count: summary.interval });
        }
        return t(`recurrence.${summary.freq.toLowerCase()}`);
    };

    const shiftMonth = (delta: number) => {
        setShowPast(false);
        setMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
    };

    const goToday = () => {
        setShowPast(false);
        const now = new Date();
        setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    };

    const occurrenceLabel = (occurrence: Occurrence): string => {
        if (occurrence.allDay) {
            return t("event.allDay");
        }
        const start = formatTime(occurrence.start, locale);
        return occurrence.end
            ? `${start}\u2009–\u2009${formatTime(occurrence.end, locale)}`
            : start;
    };

    return (
        <Page
            sidebar={
                <>
                    {calendars.length > 1 && (
                        <SidebarMenu title={t("calendars.label")}>
                            {CALENDARS.filter((c) => calendars.includes(c.id)).map((c) => (
                                <button
                                    key={c.id}
                                    type="button"
                                    className={`menu-item calendar-toggle calendar-${c.id} ${hidden.includes(c.id) ? "off" : "active"}`}
                                    aria-pressed={!hidden.includes(c.id)}
                                    onClick={() => toggleCalendar(c.id)}
                                >
                                    <span className="calendar-swatch" aria-hidden="true" />
                                    <span className="txt">{t(`calendars.${c.id}`)}</span>
                                </button>
                            ))}
                        </SidebarMenu>
                    )}
                    <SidebarMenu title={t("calendar.subscribeTitle")} secondary>
                        {auth.isAuthenticated ? (
                            <PersonalFeed />
                        ) : (
                            <>
                                <a className="menu-item" href={buildIcalUrl()}>
                                    <i className="ri-rss-line" aria-hidden="true" />
                                    <span className="txt">{t("calendar.subscribe")}</span>
                                </a>
                                <p className="txt-hint txt-sm m-0">{t("calendar.subscribeHint")}</p>
                            </>
                        )}
                    </SidebarMenu>
                </>
            }
        >
            <PageHeading title={formatMonthTitle(month, locale)}>
                <button
                    type="button"
                    className="btn sm circle secondary"
                    aria-label={t("calendar.previousMonth")}
                    onClick={() => shiftMonth(-1)}
                >
                    <i className="ri-arrow-left-s-line" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    className="btn sm secondary"
                    disabled={isCurrentMonth}
                    onClick={goToday}
                >
                    {t("calendar.currentMonth")}
                </button>
                <button
                    type="button"
                    className="btn sm circle secondary"
                    aria-label={t("calendar.nextMonth")}
                    onClick={() => shiftMonth(1)}
                >
                    <i className="ri-arrow-right-s-line" aria-hidden="true" />
                </button>
            </PageHeading>

            {state.loading && (
                <p className="txt-hint" aria-live="polite">{t("calendar.loading")}</p>
            )}
            {state.error && <div className="alert danger m-b-sm">{t("calendar.error")}</div>}

            {frequent.events.length > 0 && (
                <div className="cal-frequent">
                    <i className="ri-repeat-line" aria-hidden="true" />
                    <span className="txt-hint">{t("calendar.frequent")}</span>
                    {frequent.events.map((event) => (
                        <Link
                            key={event.id}
                            className={`cal-chip calendar-${calendarOf(event)}`}
                            to={`/events/${event.id}`}
                        >
                            {event.title}
                            <span className="txt-hint"> · {ruleText(event)}</span>
                        </Link>
                    ))}
                </div>
            )}

            <div className="cal-grid">
                {weekdays.map((label, i) => (
                    <div key={i} className="cal-weekday">
                        {label}
                    </div>
                ))}
                {cells.map((date) => {
                    const key = dayKeyOf(date);
                    const occurrences = (byDay.get(key) ?? []).filter((o) => !frequent.ids.has(o.event.id));
                    const visible = occurrences.slice(0, 2);
                    const hidden = occurrences.length - visible.length;
                    return (
                        <div
                            key={key}
                            className={[
                                "cal-cell",
                                date.getMonth() !== month.getMonth() ? "other" : "",
                                key === todayKey ? "today" : "",
                            ]
                                .join(" ")
                                .trim()}
                        >
                            <span className="cal-cell-num">{date.getDate()}</span>
                            {visible.map((occurrence, i) => (
                                <Link
                                    key={i}
                                    className={`cal-chip calendar-${calendarOf(occurrence.event)}`}
                                    to={occurrenceDayLink(occurrence)}
                                    title={occurrence.event.title}
                                >
                                    {occurrence.event.title}
                                </Link>
                            ))}
                            {hidden > 0 && (
                                <span className="cal-chip-more">
                                    {t("calendar.more", { count: hidden })}
                                </span>
                            )}
                            {/* phones: dots instead of cut-off titles */}
                            {occurrences.length > 0 && (
                                <span
                                    className="cal-dots"
                                    aria-label={t("calendar.eventCount", { count: occurrences.length })}
                                >
                                    {occurrences.slice(0, 3).map((o, i) => (
                                        <span key={i} className={`cal-dot calendar-${calendarOf(o.event)}`} />
                                    ))}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>

            <section className="month-events" aria-label={t("calendar.monthEvents")}>
                <header className="page-heading">
                    <h2 className="title">{t("calendar.monthEvents")}</h2>
                    {monthList.hiddenPast > 0 && (
                        <>
                            <div className="flex-fill" />
                            <button
                                type="button"
                                className="btn sm secondary transparent"
                                onClick={() => setShowPast(true)}
                            >
                                <i className="ri-history-line" aria-hidden="true" />
                                <span className="txt">
                                    {t("calendar.showPast", { count: monthList.hiddenPast })}
                                </span>
                            </button>
                        </>
                    )}
                </header>
                {monthList.list.length > 0 && (
                    <div className="list event-list">
                        {monthList.list.map(({ key, date, occurrences }) =>
                            occurrences.map((occurrence, i) => (
                                <Link
                                    key={`${key}-${i}`}
                                    className="list-item next event-row"
                                    to={occurrenceDayLink(occurrence)}
                                >
                                    <span className={`event-date calendar-${calendarOf(occurrence.event)} ${key === todayKey ? "today" : ""}`}>
                                        <span className="event-date-day">{date.getDate()}</span>
                                        <span className="event-date-weekday">
                                            {key === todayKey
                                                ? t("calendar.today")
                                                : formatShortDate(date, locale).split(",")[0]}
                                        </span>
                                    </span>
                                    <span className="content">
                                        <span className="event-title">{occurrence.event.title}</span>
                                        <span className="meta">
                                            <span className="meta-item">
                                                <i className="ri-time-line" aria-hidden="true" />
                                                {occurrenceLabel(occurrence)}
                                            </span>
                                            {occurrence.event.rrule && (
                                                <span className="meta-item">
                                                    <i className="ri-repeat-line" aria-hidden="true" />
                                                    {ruleText(occurrence.event)}
                                                </span>
                                            )}
                                            {occurrence.event.location && (
                                                <span className="meta-item">
                                                    <i className="ri-map-pin-line" aria-hidden="true" />
                                                    {occurrence.event.location}
                                                </span>
                                            )}
                                            {calendarOf(occurrence.event) !== "public" && (
                                                <CalendarBadge calendar={calendarOf(occurrence.event)} />
                                            )}
                                            {occurrence.event.category && (
                                                <span className="label sm">{occurrence.event.category}</span>
                                            )}
                                        </span>
                                    </span>
                                </Link>
                            )),
                        )}
                    </div>
                )}
                {!state.loading && !state.error && monthList.list.length === 0 && (
                    <div className="alert">
                        {monthList.hiddenPast > 0
                            ? t("calendar.noUpcomingEvents")
                            : t("calendar.noEvents")}
                    </div>
                )}
            </section>
        </Page>
    );
}
