import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClientResponseError } from "pocketbase";

import { pb } from "../lib/pbClient";
import { serverMessage } from "../lib/pbErrors";
import { formatLongDate, formatTime } from "../lib/dates";
import { parsePBDate } from "../lib/recurrence";
import type { IssueEvent } from "../types";
import FormField from "./FormField";

// Status history (written by the server) and internal notes of an issue.
// Visible to the Beirat, Hausmeister and Hausverwaltung only (collection
// rules); notes are never shown to owners or mailed to the reporter.
export default function IssueHistory({
    issueId,
    refreshKey,
    canWrite,
}: {
    issueId: string;
    refreshKey: unknown;
    canWrite: boolean;
}) {
    const { t, i18n } = useTranslation();
    const locale = i18n.language;
    const [entries, setEntries] = useState<IssueEvent[] | null>(null);
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(() => {
        pb.collection<IssueEvent>("issue_events")
            .getFullList({ filter: pb.filter("issue = {:issue}", { issue: issueId }), sort: "created", expand: "actor" })
            .then(setEntries)
            .catch(() => setEntries([]));
    }, [issueId]);

    useEffect(() => {
        load();
    }, [load, refreshKey]);

    const submit = async (e: { preventDefault(): void }) => {
        e.preventDefault();
        if (!note.trim()) return;
        setBusy(true);
        setError(null);
        try {
            await pb.collection("issue_events").create({
                issue: issueId,
                type: "note",
                actor: pb.authStore.record?.id,
                note: note.trim(),
            });
            setNote("");
            load();
        } catch (err) {
            setError(t("history.saveError") + (err instanceof ClientResponseError ? ` (${serverMessage(err)})` : ""));
        } finally {
            setBusy(false);
        }
    };

    const describe = (entry: IssueEvent) => {
        if (entry.type === "note") return null;
        if (!entry.from_status) return t("history.submitted");
        return t("history.statusChange", {
            from: t(`issueStatus.${entry.from_status}`),
            to: t(`issueStatus.${entry.to_status}`),
        });
    };

    return (
        <section className="post issue-history">
            <h2 className="section-title">
                <i className="ri-history-line" aria-hidden="true" />
                {t("history.heading")}
                <span className="label sm">{t("history.internal")}</span>
            </h2>
            {entries === null ? (
                <p className="txt-hint m-0">{t("calendar.loading")}</p>
            ) : entries.length === 0 ? (
                <p className="txt-hint m-0">{t("history.empty")}</p>
            ) : (
                <ol className="timeline">
                    {entries.map((entry) => {
                        const when = parsePBDate(entry.created);
                        return (
                            <li key={entry.id} className={`timeline-item timeline-${entry.type}`}>
                                <span className="timeline-icon" aria-hidden="true">
                                    <i className={entry.type === "note" ? "ri-chat-3-line" : "ri-flag-line"} />
                                </span>
                                <span className="timeline-body">
                                    <span className="meta">
                                        <span className="meta-item txt-bold">
                                            {entry.expand?.actor?.name || (entry.actor ? t("history.someone") : t("history.system"))}
                                        </span>
                                        {when && (
                                            <span className="meta-item">
                                                {formatLongDate(when, locale)}, {formatTime(when, locale)}
                                            </span>
                                        )}
                                    </span>
                                    {entry.type === "note" ? (
                                        <span className="prewrap">{entry.note}</span>
                                    ) : (
                                        <span>{describe(entry)}</span>
                                    )}
                                </span>
                            </li>
                        );
                    })}
                </ol>
            )}

            {canWrite && (
                <form onSubmit={submit} noValidate>
                    <div className="grid sm">
                        <FormField id={`note-${issueId}`} label={t("history.addNote")} hint={t("history.noteHint")} error={error}>
                            <textarea id={`note-${issueId}`} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
                        </FormField>
                        <div className="col-12">
                            <footer className="form-footer">
                                <button type="submit" className={`btn sm ${busy ? "loading" : ""}`} disabled={busy || !note.trim()}>
                                    <i className="ri-chat-3-line" aria-hidden="true" />
                                    <span className="txt">{t("history.saveNote")}</span>
                                </button>
                            </footer>
                        </div>
                    </div>
                </form>
            )}
        </section>
    );
}
