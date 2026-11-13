import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { pb } from "../lib/pbClient";
import { canShow, useAuth } from "../lib/auth";
import { BackLink, Page, PageHeading, SidebarInfo, SidebarMenu } from "../components/Page";
import CalendarBadge from "../components/CalendarBadge";
import { calendarOf } from "../lib/calendars";
import { displayDate, expandOccurrences, parseRule } from "../lib/recurrence";
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
    const auth = useAuth();

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
        const start = displayDate(event.date_start, event.all_day);
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
        const end = displayDate(event.date_end, event.all_day);
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

    const backSidebar = (
        <SidebarMenu>
            <BackLink to="/kalender">{t("event.back")}</BackLink>
        </SidebarMenu>
    );

    if (state.status === "loading") {
        return (
            <Page sidebar={backSidebar}>
                <p className="txt-hint">{t("calendar.loading")}</p>
            </Page>
        );
    }
    if (state.status === "error") {
        return (
            <Page sidebar={backSidebar}>
                <div className="alert danger">{t("event.loadError")}</div>
            </Page>
        );
    }

    const event = state.event;
    if (!occurrence) {
        return (
            <Page sidebar={backSidebar}>
                <div className="alert danger">{t("event.notFound")}</div>
            </Page>
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

    const timeLabel = event.all_day
        ? t("event.allDay")
        : occurrence.end
          ? `${formatTime(occurrence.start, locale)} – ${formatTime(occurrence.end, locale)}`
          : formatTime(occurrence.start, locale);

    return (
        <Page
            sidebar={
                <>
                    <SidebarMenu>
                        <BackLink to="/kalender">{t("event.back")}</BackLink>
                    </SidebarMenu>
                    <SidebarInfo label={t("calendars.label")}>
                        <span>
                            <CalendarBadge calendar={calendarOf(event)} />
                        </span>
                    </SidebarInfo>
                    {event.category && (
                        <SidebarInfo label={t("event.category")}>
                            <span className="label">{event.category}</span>
                        </SidebarInfo>
                    )}
                    {ruleSummary && (
                        <SidebarInfo label={t("event.firstOccurrence")}>
                            <span>{formatLongDate(displayDate(event.date_start, event.all_day)!, locale)}</span>
                        </SidebarInfo>
                    )}
                    {canShow(auth.role) && (
                        <SidebarMenu title={t("event.actions")} secondary>
                            <Link className="menu-item" to={`/events/${event.id}/edit`}>
                                <i className="ri-edit-line" aria-hidden="true" />
                                <span className="txt">{t("eventEditor.edit")}</span>
                            </Link>
                        </SidebarMenu>
                    )}
                </>
            }
        >
            <PageHeading title={event.title} />
            <article className="post event-post">
                <ul className="fact-list">
                    <li>
                        <i className="ri-calendar-2-line" aria-hidden="true" />
                        <span>{formatLongDate(occurrence.start, locale)}</span>
                    </li>
                    <li>
                        <i className="ri-time-line" aria-hidden="true" />
                        <span>{timeLabel}</span>
                    </li>
                    {event.location && (
                        <li>
                            <i className="ri-map-pin-line" aria-hidden="true" />
                            <span>{event.location}</span>
                        </li>
                    )}
                    {ruleSummary && (
                        <li>
                            <i className="ri-repeat-line" aria-hidden="true" />
                            <span>
                                {recurrenceLabel}
                                {recurrenceDetails && <> ({recurrenceDetails})</>}
                                <span className="txt-hint txt-sm block-txt">{t("event.seriesHint")}</span>
                            </span>
                        </li>
                    )}
                </ul>
                {event.description && (
                    <>
                        <hr />
                        <div className="content prewrap">{event.description}</div>
                    </>
                )}
            </article>
        </Page>
    );
}
