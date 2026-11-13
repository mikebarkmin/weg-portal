import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { pb } from "../lib/pbClient";
import { expandOccurrences, parsePBDate, parseRule } from "../lib/recurrence";
import {
    formatLongDate,
    formatTime,
    weekdayLabel,
} from "../lib/dates";
import type { Occurrence } from "../lib/recurrence";
import type { PortalEvent } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;

type DetailState =
    | { status: "loading" }
    | { status: "error" }
    | { status: "ready"; event: PortalEvent };

export default function EventDetail() {
    const { id, day } = useParams();
    const { t, i18n } = useTranslation();
    const locale = i18n.language;

    const [state, setState] = useState<DetailState>({ status: "loading" });

    useEffect(() => {
        let active = true;
        setState({ status: "loading" });
        pb.collection<PortalEvent>("events")
            .getOne(id!)
            .then((event) => {
                if (active) {
                    setState({ status: "ready", event });
                }
            })
            .catch(() => {
                if (active) {
                    setState({ status: "error" });
                }
            });
        return () => {
            active = false;
        };
    }, [id]);

    // Resolve the concrete occurrence to display: when the route carries a
    // day (coming from a calendar chip), find the occurrence covering it;
    // otherwise fall back to the base date.
    const occurrence: Occurrence | null = useMemo(() => {
        if (state.status !== "ready") {
            return null;
        }
        const event = state.event;
        const start = parsePBDate(event.date_start);
        if (!start) {
            return null;
        }
        if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
            const target = new Date(`${day}T00:00:00`);
            const found = expandOccurrences(
                event,
                target,
                new Date(target.getTime() + DAY_MS),
            )[0];
            if (found) {
                return found;
            }
        }
        const end = parsePBDate(event.date_end);
        return {
            event,
            start,
            end: end && end >= start ? end : null,
            allDay: event.all_day,
        };
    }, [state, day]);

    const ruleSummary = useMemo(
        () =>
            state.status === "ready" ? parseRule(state.event.rrule) : null,
        [state],
    );

    if (state.status === "loading") {
        return <p className="state">{t("calendar.loading")}</p>;
    }
    if (state.status === "error") {
        return (
            <>
                <Link className="back-link" to="/">
                    ‹ {t("event.back")}
                </Link>
                <p className="state state-error">{t("event.loadError")}</p>
            </>
        );
    }

    const event = state.event;
    if (!occurrence) {
        return (
            <>
                <Link className="back-link" to="/">
                    ‹ {t("event.back")}
                </Link>
                <p className="state state-error">{t("event.notFound")}</p>
            </>
        );
    }

    const recurrenceLabel = (() => {
        if (!ruleSummary) {
            return t("recurrence.none");
        }
        const { freq, interval } = ruleSummary;
        if (interval > 1) {
            const intervalKeys: Record<string, string> = {
                DAILY: "recurrence.intervalDays",
                WEEKLY: "recurrence.intervalWeeks",
                MONTHLY: "recurrence.intervalMonths",
                YEARLY: "recurrence.intervalYears",
            };
            return t(intervalKeys[freq]!, { count: interval });
        }
        return t(`recurrence.${freq.toLowerCase()}`);
    })();

    const recurrenceDetails = ruleSummary
        ? [
              ruleSummary.byWeekdays.length > 0
                  ? t("recurrence.byWeekdays", {
                        weekdays: ruleSummary.byWeekdays
                            .map((weekday) => weekdayLabel(weekday, locale))
                            .join(", "),
                    })
                  : "",
              ruleSummary.count
                  ? t("recurrence.count", { count: ruleSummary.count })
                  : "",
              ruleSummary.until
                  ? t("recurrence.until", {
                        date: formatLongDate(ruleSummary.until, locale),
                    })
                  : "",
          ]
            .filter(Boolean)
            .join(" · ")
        : "";

    return (
        <article className="event-detail">
            <Link className="back-link" to="/">
                ‹ {t("event.back")}
            </Link>
            <div className="card">
                <h1>{event.title}</h1>
                <dl>
                    <dt>{t("event.date")}</dt>
                    <dd>{formatLongDate(occurrence.start, locale)}</dd>
                    <dt>{t("event.time")}</dt>
                    <dd>
                        {event.all_day
                            ? t("event.allDay")
                            : occurrence.end
                              ? `${formatTime(occurrence.start, locale)} – ${formatTime(occurrence.end, locale)}`
                              : formatTime(occurrence.start, locale)}
                    </dd>
                    {event.location && (
                        <>
                            <dt>{t("event.location")}</dt>
                            <dd>{event.location}</dd>
                        </>
                    )}
                    {event.category && (
                        <>
                            <dt>{t("event.category")}</dt>
                            <dd>{event.category}</dd>
                        </>
                    )}
                    <dt>{t("event.recurrence")}</dt>
                    <dd>
                        {recurrenceLabel}
                        {recurrenceDetails && (
                            <span> ({recurrenceDetails})</span>
                        )}
                        {ruleSummary && (
                            <div className="hint">{t("event.seriesHint")}</div>
                        )}
                    </dd>
                    {ruleSummary && (
                        <>
                            <dt>{t("event.firstOccurrence")}</dt>
                            <dd>
                                {formatLongDate(
                                    parsePBDate(event.date_start)!,
                                    locale,
                                )}
                            </dd>
                        </>
                    )}
                    {event.description && (
                        <>
                            <dt>{t("event.description")}</dt>
                            <dd className="event-description">
                                {event.description}
                            </dd>
                        </>
                    )}
                </dl>
            </div>
        </article>
    );
}
