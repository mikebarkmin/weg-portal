import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { pb } from "../lib/pbClient";
import { canShow, useAuth, useOwnerAccount } from "../lib/auth";
import { renderMarkdown } from "../lib/markdown";
import { dayKeyOf, formatShortDate, formatTime } from "../lib/dates";
import { expandOccurrences, parsePBDate, type Occurrence } from "../lib/recurrence";
import { calendarOf } from "../lib/calendars";
import type { PortalAnnouncement, PortalContact, PortalEvent } from "../types";
import { MenuLink, Page, PageHeading, SidebarMenu } from "../components/Page";
import CalendarBadge from "../components/CalendarBadge";
import ContactCard from "../components/ContactCard";

const UPCOMING_DAYS = 60;
const UPCOMING_MAX = 6;

// Start page: what an owner (or tenant) needs at a glance - current
// announcements, the next dates and the emergency numbers.
export default function Home() {
    const { t, i18n } = useTranslation();
    const locale = i18n.language;
    const auth = useAuth();
    const isOwner = useOwnerAccount();

    const [announcements, setAnnouncements] = useState<PortalAnnouncement[] | null>(null);
    const [events, setEvents] = useState<PortalEvent[] | null>(null);
    const [emergency, setEmergency] = useState<PortalContact[]>([]);

    useEffect(() => {
        let active = true;
        const now = new Date();
        const until = new Date(now.getTime() + UPCOMING_DAYS * 86400000);
        const iso = (d: Date) => d.toISOString().replace("T", " ");

        pb.collection<PortalAnnouncement>("announcements")
            .getList(1, 3, {
                sort: "-pinned,-created",
                // the Beirat also sees expired ones in the list endpoint
                filter: pb.filter("expires_at = '' || expires_at > {:now}", { now: iso(now) }),
            })
            .then((res) => active && setAnnouncements(res.items))
            .catch(() => active && setAnnouncements([]));

        pb.collection<PortalEvent>("events")
            .getFullList({
                filter: pb.filter(
                    "(date_start <= {:until} && (date_end >= {:now} || date_start >= {:now})) || rrule != ''",
                    { now: iso(new Date(now.getTime() - 86400000)), until: iso(until) },
                ),
                sort: "date_start",
            })
            .then((list) => active && setEvents(list))
            .catch(() => active && setEvents([]));

        pb.collection<PortalContact>("contacts")
            .getFullList({ filter: "category = 'notdienst'", sort: "sort,name" })
            .then((list) => active && setEmergency(list))
            .catch(() => undefined);

        return () => {
            active = false;
        };
    }, [auth.isAuthenticated, auth.role]);

    const upcoming = useMemo(() => {
        if (!events) return null;
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date(start.getTime() + UPCOMING_DAYS * 86400000);
        const all: Occurrence[] = [];
        for (const event of events) {
            all.push(...expandOccurrences(event, start, end));
        }
        const now = Date.now();
        // a series appears once (its next occurrence), so a daily event
        // cannot push everything else off the list
        const seen = new Set<string>();
        return all
            .filter((o) => (o.end ?? o.start).getTime() >= now || o.allDay)
            .sort((a, b) => a.start.getTime() - b.start.getTime())
            .filter((o) => {
                if (seen.has(o.event.id)) return false;
                seen.add(o.event.id);
                return true;
            })
            .slice(0, UPCOMING_MAX);
    }, [events]);

    return (
        <Page
            sidebar={
                <>
                    <SidebarMenu title={t("home.quickLinks")}>
                        <MenuLink to="/issues/new" icon="ri-error-warning-line">
                            {t("nav.newIssue")}
                        </MenuLink>
                        <MenuLink to="/suggestions/new" icon="ri-calendar-event-line">
                            {t("nav.newSuggestion")}
                        </MenuLink>
                        {isOwner && (
                            <MenuLink to="/mitreden" icon="ri-chat-poll-line">
                                {t("nav.participate")}
                            </MenuLink>
                        )}
                        <MenuLink to="/dokumente" icon="ri-folder-3-line">
                            {t("nav.documents")}
                        </MenuLink>
                        <MenuLink to="/kontakte" icon="ri-contacts-book-line">
                            {t("nav.contacts")}
                        </MenuLink>
                    </SidebarMenu>
                    {!auth.isAuthenticated && <p className="txt-hint sidebar-text">{t("home.ownerHint")}</p>}
                </>
            }
        >
            <PageHeading title={t("home.heading")} />

            <div className="flex-column gap-sm">
                <section className="home-section">
                    <header className="page-heading">
                        <h2 className="title">{t("announcements.heading")}</h2>
                        <div className="flex-fill" />
                        <Link className="btn sm secondary transparent" to="/aktuelles">
                            <span className="txt">{t("home.allAnnouncements")}</span>
                            <i className="ri-arrow-right-line" aria-hidden="true" />
                        </Link>
                    </header>
                    {announcements === null ? (
                        <p className="txt-hint">{t("calendar.loading")}</p>
                    ) : announcements.length === 0 ? (
                        <div className="alert">{t("announcements.empty")}</div>
                    ) : (
                        <div className="flex-column gap-sm">
                            {announcements.map((a) => (
                                <Link key={a.id} className="post announcement-teaser" to={`/aktuelles#${a.id}`}>
                                    <span className="announcement-teaser-head">
                                        {a.pinned && <i className="ri-pushpin-fill txt-warning" aria-hidden="true" />}
                                        <strong className="post-title">{a.title}</strong>
                                        {a.visibility === "owners" && (
                                            <span className="label sm success">{t("visibility.owners")}</span>
                                        )}
                                    </span>
                                    <span
                                        className="markdown-preview announcement-excerpt"
                                        dangerouslySetInnerHTML={{ __html: renderMarkdown(a.body) }}
                                    />
                                    <span className="meta">
                                        <span className="meta-item">
                                            <i className="ri-time-line" aria-hidden="true" />
                                            {formatShortDate(parsePBDate(a.created)!, locale)}
                                        </span>
                                    </span>
                                </Link>
                            ))}
                        </div>
                    )}
                </section>

                <section className="home-section">
                    <header className="page-heading">
                        <h2 className="title">{t("home.upcoming")}</h2>
                        <div className="flex-fill" />
                        <Link className="btn sm secondary transparent" to="/kalender">
                            <span className="txt">{t("home.toCalendar")}</span>
                            <i className="ri-arrow-right-line" aria-hidden="true" />
                        </Link>
                    </header>
                    {upcoming === null ? (
                        <p className="txt-hint">{t("calendar.loading")}</p>
                    ) : upcoming.length === 0 ? (
                        <div className="alert">{t("home.noUpcoming")}</div>
                    ) : (
                        <div className="list event-list">
                            {upcoming.map((o, i) => (
                                <Link
                                    key={i}
                                    className="list-item next event-row"
                                    to={`/events/${o.event.id}/${dayKeyOf(o.start)}`}
                                >
                                    <span className={`event-date calendar-${calendarOf(o.event)}`}>
                                        <span className="event-date-day">{o.start.getDate()}</span>
                                        <span className="event-date-weekday">
                                            {formatShortDate(o.start, locale).split(",")[0]}
                                        </span>
                                    </span>
                                    <span className="content">
                                        <span className="event-title">{o.event.title}</span>
                                        <span className="meta">
                                            <span className="meta-item">
                                                <i className="ri-time-line" aria-hidden="true" />
                                                {o.allDay ? t("event.allDay") : formatTime(o.start, locale)}
                                            </span>
                                            {o.event.location && (
                                                <span className="meta-item">
                                                    <i className="ri-map-pin-line" aria-hidden="true" />
                                                    {o.event.location}
                                                </span>
                                            )}
                                            {o.event.rrule && (
                                                <span className="meta-item">
                                                    <i className="ri-repeat-line" aria-hidden="true" />
                                                    {t("home.recurring")}
                                                </span>
                                            )}
                                            {calendarOf(o.event) !== "public" && <CalendarBadge calendar={calendarOf(o.event)} />}
                                        </span>
                                    </span>
                                </Link>
                            ))}
                        </div>
                    )}
                </section>

                {emergency.length > 0 && (
                    <section className="home-section">
                        <header className="page-heading">
                            <h2 className="title">{t("contacts.category.notdienst")}</h2>
                            <div className="flex-fill" />
                            <Link className="btn sm secondary transparent" to="/kontakte">
                                <span className="txt">{t("home.allContacts")}</span>
                                <i className="ri-arrow-right-line" aria-hidden="true" />
                            </Link>
                        </header>
                        <div className="contact-grid">
                            {emergency.map((c) => (
                                <ContactCard key={c.id} contact={c} />
                            ))}
                        </div>
                    </section>
                )}

                {canShow(auth.role) && (
                    <div className="alert info flex gap-sm flex-wrap">
                        <span className="flex-fill">{t("home.beiratHint")}</span>
                        <Link className="btn sm" to="/aktuelles?new=1">
                            <i className="ri-add-line" aria-hidden="true" />
                            <span className="txt">{t("announcements.new")}</span>
                        </Link>
                    </div>
                )}
            </div>
        </Page>
    );
}
