import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { pb } from "../lib/pbClient";
import { formatLongDate } from "../lib/dates";
import { displayDate, parsePBDate } from "../lib/recurrence";
import { STATUS_ICONS } from "../lib/issues";
import type { PortalIssue } from "../types";
import { Page, PageHeading, SidebarMenu, MenuLink } from "../components/Page";
import StatusBadge from "../components/StatusBadge";

interface MyIssue {
    id: string;
    title: string;
    status: PortalIssue["status"];
    visibility: string;
    created: string;
    decided_at: string;
    resolved_at: string;
}

interface MySuggestion {
    id: string;
    title: string;
    status: "pending" | "accepted" | "rejected";
    date_start: string;
    all_day: boolean;
    decision_note: string;
    created: string;
}

// What the logged-in owner submitted while logged in (GET
// /api/portal/my-submissions): reports with their current status (also
// private or pending ones - they are the reporter) and suggestions.
export default function MySubmissions() {
    const { t, i18n } = useTranslation();
    const locale = i18n.language;
    const [data, setData] = useState<{ issues: MyIssue[]; suggestions: MySuggestion[] } | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        pb.send<{ issues: MyIssue[]; suggestions: MySuggestion[] }>("/api/portal/my-submissions", {})
            .then(setData)
            .catch(() => setError(true));
    }, []);

    const date = (value: string) => {
        const d = parsePBDate(value);
        return d ? formatLongDate(d, locale) : "";
    };

    return (
        <Page
            sidebar={
                <>
                    <SidebarMenu title={t("mySubmissions.heading")}>
                        <MenuLink to="/issues/new" icon="ri-error-warning-line">
                            {t("nav.newIssue")}
                        </MenuLink>
                        <MenuLink to="/suggestions/new" icon="ri-calendar-event-line">
                            {t("nav.newSuggestion")}
                        </MenuLink>
                    </SidebarMenu>
                    <p className="txt-hint sidebar-text">{t("mySubmissions.intro")}</p>
                </>
            }
        >
            <PageHeading title={t("mySubmissions.heading")} />
            {error && <div className="alert danger">{t("mySubmissions.loadError")}</div>}
            {!data && !error && <p className="txt-hint">{t("calendar.loading")}</p>}
            {data && (
                <div className="flex-column gap-sm">
                    <h2 className="section-title">
                        <i className="ri-error-warning-line" aria-hidden="true" />
                        {t("mySubmissions.issues")}
                    </h2>
                    {data.issues.length === 0 ? (
                        <div className="alert">{t("mySubmissions.noIssues")}</div>
                    ) : (
                        <div className="list board-list">
                            {data.issues.map((issue) => {
                                const visibleOnBoard = issue.status !== "pending" && issue.status !== "rejected";
                                const content = (
                                    <>
                                        <span className={`status-icon status-${issue.status}`} aria-hidden="true">
                                            <i className={STATUS_ICONS[issue.status]} />
                                        </span>
                                        <span className="content">
                                            <span className="board-item-title">{issue.title}</span>
                                            <span className="meta">
                                                <StatusBadge status={issue.status} />
                                                {issue.created && (
                                                    <span className="meta-item">
                                                        <i className="ri-time-line" aria-hidden="true" />
                                                        {t("mySubmissions.submittedOn", { date: date(issue.created) })}
                                                    </span>
                                                )}
                                                {issue.visibility === "private" && (
                                                    <span className="meta-item">
                                                        <i className="ri-lock-line" aria-hidden="true" />
                                                        {t("mySubmissions.private")}
                                                    </span>
                                                )}
                                            </span>
                                        </span>
                                    </>
                                );
                                // only accepted community issues have a board page an owner can open
                                return visibleOnBoard && issue.visibility === "community" ? (
                                    <Link key={issue.id} className="list-item next board-item" to={`/issues/${issue.id}`}>
                                        {content}
                                    </Link>
                                ) : (
                                    <div key={issue.id} className="list-item board-item">
                                        {content}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <h2 className="section-title m-t-sm">
                        <i className="ri-calendar-event-line" aria-hidden="true" />
                        {t("mySubmissions.suggestions")}
                    </h2>
                    {data.suggestions.length === 0 ? (
                        <div className="alert">{t("mySubmissions.noSuggestions")}</div>
                    ) : (
                        <div className="list">
                            {data.suggestions.map((s) => {
                                const start = displayDate(s.date_start, s.all_day);
                                return (
                                    <div key={s.id} className="list-item">
                                        <span className="content">
                                            <strong>{s.title}</strong>
                                            <span className="meta">
                                                <span className={`label sm ${s.status === "accepted" ? "success" : s.status === "rejected" ? "danger" : ""}`}>
                                                    {t(`mySubmissions.suggestionStatus.${s.status}`)}
                                                </span>
                                                {start && (
                                                    <span className="meta-item">
                                                        <i className="ri-calendar-2-line" aria-hidden="true" />
                                                        {formatLongDate(start, locale)}
                                                    </span>
                                                )}
                                            </span>
                                            {s.decision_note && (
                                                <span className="txt-hint txt-sm">
                                                    {t("participate.beiratNote")}: {s.decision_note}
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    <p className="txt-hint txt-sm m-0">{t("mySubmissions.anonymousHint")}</p>
                </div>
            )}
        </Page>
    );
}
