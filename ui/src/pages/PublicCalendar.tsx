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
import { expandAll, type Occurrence } from "../lib/recurrence";
import type { PortalEvent } from "../types";

interface MonthState {
    events: PortalEvent[];
    loading: boolean;
    error: boolean;
}

const CELL_COUNT = 42; // 6 weeks -> stable grid height

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
    }, [range.startLiteral, range.endLiteral]);

    const byDay = useMemo(
        () => expandAll(state.events, range.start, range.end),
        [state.events, range.start, range.end],
    );

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

    const monthList = useMemo(() => {
        const days: string[] = [];
        const cursor = new Date(range.start);
        while (cursor < range.end) {
            days.push(dayKeyOf(cursor));
            cursor.setDate(cursor.getDate() + 1);
        }
        return days
            .map((key) => ({ key, occurrences: byDay.get(key) ?? [] }))
            .filter((day) => day.occurrences.length > 0);
    }, [byDay, range.start, range.end]);

    const shiftMonth = (delta: number) => {
        setMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
    };

    const goToday = () => {
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
        <>
            <div className="cal-toolbar">
                <h1 className="cal-title">{formatMonthTitle(month, locale)}</h1>
                <div className="cal-actions">
                    <button
                        type="button"
                        className="btn btn-outline"
                        aria-label={t("calendar.previousMonth")}
                        onClick={() => shiftMonth(-1)}
                    >
                        ‹
                    </button>
                    <button
                        type="button"
                        className="btn btn-outline"
                        onClick={goToday}
                    >
                        {t("calendar.currentMonth")}
                    </button>
                    <button
                        type="button"
                        className="btn btn-outline"
                        aria-label={t("calendar.nextMonth")}
                        onClick={() => shiftMonth(1)}
                    >
                        ›
                    </button>
                    <a className="btn" href={buildIcalUrl()}>
                        {t("calendar.subscribe")}
                    </a>
                </div>
            </div>
            <p className="hint" aria-live="polite">
                {state.loading
                    ? t("calendar.loading")
                    : state.error
                      ? t("calendar.error")
                      : t("calendar.subscribeHint")}
            </p>

            <div className="cal-grid">
                {weekdays.map((label, i) => (
                    <div key={i} className="cal-weekday">
                        {label}
                    </div>
                ))}
                {cells.map((date) => {
                    const key = dayKeyOf(date);
                    const occurrences = byDay.get(key) ?? [];
                    const visible = occurrences.slice(0, 2);
                    const hidden = occurrences.length - visible.length;
                    return (
                        <div
                            key={key}
                            className={[
                                "cal-cell",
                                date.getMonth() !== month.getMonth()
                                    ? "other"
                                    : "",
                                key === todayKey ? "today" : "",
                            ]
                                .join(" ")
                                .trim()}
                        >
                            <span className="cal-cell-num">
                                {date.getDate()}
                            </span>
                            {visible.map((occurrence, i) => (
                                <Link
                                    key={i}
                                    className="cal-chip"
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
                        </div>
                    );
                })}
            </div>

            <section className="month-events" aria-label={t("calendar.monthEvents")}>
                <h2>{t("calendar.monthEvents")}</h2>
                {monthList.map(({ key, occurrences }) => (
                    <div key={key} className="event-day">
                        <h3 className="event-day-title">
                            {formatShortDate(occurrences[0]!.start, locale)}
                        </h3>
                        {occurrences.map((occurrence, i) => (
                            <div key={i} className="event-item">
                                <span className="event-time">
                                    {occurrenceLabel(occurrence)}
                                </span>
                                <Link
                                    className="event-title"
                                    to={occurrenceDayLink(occurrence)}
                                >
                                    {occurrence.event.title}
                                </Link>
                                {occurrence.event.category && (
                                    <span className="event-category">
                                        {occurrence.event.category}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                ))}
                {!state.loading &&
                    !state.error &&
                    monthList.length === 0 && <p>{t("calendar.noEvents")}</p>}
            </section>
        </>
    );
}
