import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClientResponseError } from "pocketbase";

import { pb } from "../lib/pbClient";
import { errorStatus, serverMessage } from "../lib/pbErrors";
import { formatLongDate, formatTime } from "../lib/dates";
import { parsePBDate } from "../lib/recurrence";
import {
    buildIssueAccept,
    buildIssueReject,
    buildSuggestionDecision,
    decisionNoteSchema,
    type IssueVisibility,
    type SuggestionStatus,
} from "../lib/validation";
import type { PortalIssue, PortalSuggestion } from "../types";

type Tab = "suggestions" | "issues";

interface QueueState {
    suggestions: PortalSuggestion[];
    issues: PortalIssue[];
    loading: boolean;
    error: boolean;
}

// Beirat moderation queue: pending suggestions and pending issues in
// two tabs. The server rules restrict both collections to the Beirat
// anyway - the page is additionally hidden in the nav for non-Beirat
// (see Layout) and the route is guarded (see App).
export default function ModerationQueue() {
    const { t } = useTranslation();
    const [tab, setTab] = useState<Tab>("suggestions");
    const [state, setState] = useState<QueueState>({
        suggestions: [],
        issues: [],
        loading: true,
        error: false,
    });

    const load = useCallback(() => {
        let active = true;
        setState((prev) => ({ ...prev, loading: true, error: false }));
        Promise.all([
            pb.collection<PortalSuggestion>("suggestions").getFullList({
                // NOTE: this PocketBase fork has no created/updated
                // system columns - sorting by them fails with 400
                filter: "status = 'pending'",
                sort: "date_start",
            }),
            pb.collection<PortalIssue>("issues").getFullList({
                filter: "status = 'pending'",
            }),
        ])
            .then(([suggestions, issues]) => {
                if (active) {
                    setState({ suggestions, issues, loading: false, error: false });
                }
            })
            .catch(() => {
                if (active) {
                    setState((prev) => ({ ...prev, loading: false, error: true }));
                }
            });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => load(), [load]);

    const onSuggestionDecided = (id: string) => {
        setState((prev) => ({
            ...prev,
            suggestions: prev.suggestions.filter((item) => item.id !== id),
        }));
    };

    const onIssueDecided = (id: string) => {
        setState((prev) => ({
            ...prev,
            issues: prev.issues.filter((item) => item.id !== id),
        }));
    };

    return (
        <>
            <h1>{t("moderation.heading")}</h1>
            <div className="tabs" role="tablist">
                <button
                    type="button"
                    role="tab"
                    className="btn btn-outline"
                    aria-selected={tab === "suggestions"}
                    onClick={() => setTab("suggestions")}
                >
                    {t("moderation.tab.suggestions")} ({state.suggestions.length})
                </button>
                <button
                    type="button"
                    role="tab"
                    className="btn btn-outline"
                    aria-selected={tab === "issues"}
                    onClick={() => setTab("issues")}
                >
                    {t("moderation.tab.issues")} ({state.issues.length})
                </button>
            </div>

            {state.loading && <p className="state">{t("moderation.loading")}</p>}
            {state.error && (
                <p className="state state-error">
                    {t("moderation.error.load")}
                </p>
            )}

            {!state.loading && !state.error && tab === "suggestions" && (
                <section className="queue">
                    {state.suggestions.length === 0 ? (
                        <p className="state">{t("moderation.empty.suggestions")}</p>
                    ) : (
                        state.suggestions.map((item) => (
                            <SuggestionCard
                                key={item.id}
                                suggestion={item}
                                onDecided={onSuggestionDecided}
                            />
                        ))
                    )}
                </section>
            )}

            {!state.loading && !state.error && tab === "issues" && (
                <section className="queue">
                    {state.issues.length === 0 ? (
                        <p className="state">{t("moderation.empty.issues")}</p>
                    ) : (
                        state.issues.map((item) => (
                            <IssueCard
                                key={item.id}
                                issue={item}
                                onDecided={onIssueDecided}
                            />
                        ))
                    )}
                </section>
            )}
        </>
    );
}

// Shared failure mapping for the decision requests. Invalid transitions
// (and the same-status rejection, e.g. after a double click) arrive as
// 400 with an explanatory message from the workflow hooks.
function decisionErrorKey(error: unknown): { key: string; detail: string } {
    if (error instanceof ClientResponseError && errorStatus(error) === 400) {
        return { key: "moderation.error.transition", detail: serverMessage(error) };
    }
    return { key: "moderation.error.generic", detail: "" };
}

function DecisionError({ error }: { error: { key: string; detail: string } | null }) {
    const { t } = useTranslation();
    if (!error) return null;
    return (
        <div className="form-error">
            {t(error.key)}
            {error.detail ? ` (${error.detail})` : ""}
        </div>
    );
}

function SuggestionCard({
    suggestion,
    onDecided,
}: {
    suggestion: PortalSuggestion;
    onDecided: (id: string) => void;
}) {
    const { t, i18n } = useTranslation();
    const locale = i18n.language;

    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<{ key: string; detail: string } | null>(null);

    const start = parsePBDate(suggestion.date_start);
    const end = parsePBDate(suggestion.date_end);

    const decide = async (status: SuggestionStatus) => {
        // the optional note is mailed to the submitter on accept/reject
        const parsed = decisionNoteSchema.safeParse(note.trim());
        if (!parsed.success) {
            setError({ key: "moderation.error.noteTooLong", detail: "" });
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await pb
                .collection("suggestions")
                .update(suggestion.id, buildSuggestionDecision(status, note));
            onDecided(suggestion.id);
        } catch (err) {
            setError(decisionErrorKey(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <article className="card queue-card">
            <h2 className="queue-title">{suggestion.title}</h2>
            {suggestion.description && (
                <p className="prewrap">{suggestion.description}</p>
            )}
            <dl className="queue-meta">
                <dt>{t("moderation.submitter")}</dt>
                <dd>{suggestion.email}</dd>
                <dt>{t("moderation.date")}</dt>
                <dd>
                    {start
                        ? formatLongDate(start, locale) +
                          (suggestion.all_day
                              ? ""
                              : `, ${formatTime(start, locale)}`) +
                          (end && !suggestion.all_day
                              ? ` – ${formatTime(end, locale)}`
                              : "")
                        : ""}
                </dd>
                {suggestion.location && (
                    <>
                        <dt>{t("moderation.location")}</dt>
                        <dd>{suggestion.location}</dd>
                    </>
                )}
                {suggestion.category && (
                    <>
                        <dt>{t("moderation.category")}</dt>
                        <dd>{suggestion.category}</dd>
                    </>
                )}
            </dl>
            <div className="field">
                <label htmlFor={`note-${suggestion.id}`}>
                    {t("moderation.decisionNote")}
                </label>
                <textarea
                    id={`note-${suggestion.id}`}
                    rows={2}
                    maxLength={2000}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                />
            </div>
            <DecisionError error={error} />
            <div className="btn-row">
                <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => decide("accepted")}
                >
                    {t("moderation.accept")}
                </button>
                <button
                    type="button"
                    className="btn btn-outline"
                    disabled={busy}
                    onClick={() => decide("rejected")}
                >
                    {t("moderation.reject")}
                </button>
            </div>
        </article>
    );
}

function IssueCard({
    issue,
    onDecided,
}: {
    issue: PortalIssue;
    onDecided: (id: string) => void;
}) {
    const { t } = useTranslation();

    const [visibility, setVisibility] = useState<IssueVisibility | "">("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<{ key: string; detail: string } | null>(null);

    // accepting requires the visibility (community | private) chosen in
    // the SAME request as the status change; rejecting does not need one
    const accept = async () => {
        if (visibility !== "community" && visibility !== "private") {
            setError({ key: "moderation.error.visibilityRequired", detail: "" });
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await pb
                .collection("issues")
                .update(issue.id, buildIssueAccept(visibility));
            onDecided(issue.id);
        } catch (err) {
            setError(decisionErrorKey(err));
        } finally {
            setBusy(false);
        }
    };

    const reject = async () => {
        setBusy(true);
        setError(null);
        try {
            await pb.collection("issues").update(issue.id, buildIssueReject());
            onDecided(issue.id);
        } catch (err) {
            setError(decisionErrorKey(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <article className="card queue-card">
            <h2 className="queue-title">{issue.title}</h2>
            {issue.description && <p className="prewrap">{issue.description}</p>}
            {issue.category && (
                <dl className="queue-meta">
                    <dt>{t("moderation.category")}</dt>
                    <dd>{issue.category}</dd>
                </dl>
            )}
            <fieldset className="field">
                <legend>{t("moderation.visibility.label")}</legend>
                <label className="radio">
                    <input
                        type="radio"
                        name={`visibility-${issue.id}`}
                        value="community"
                        checked={visibility === "community"}
                        onChange={() => setVisibility("community")}
                    />
                    {t("moderation.visibility.community")}
                </label>
                <label className="radio">
                    <input
                        type="radio"
                        name={`visibility-${issue.id}`}
                        value="private"
                        checked={visibility === "private"}
                        onChange={() => setVisibility("private")}
                    />
                    {t("moderation.visibility.private")}
                </label>
                <p className="hint">{t("moderation.visibility.hint")}</p>
            </fieldset>
            <DecisionError error={error} />
            <div className="btn-row">
                <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={accept}
                >
                    {t("moderation.accept")}
                </button>
                <button
                    type="button"
                    className="btn btn-outline"
                    disabled={busy}
                    onClick={reject}
                >
                    {t("moderation.reject")}
                </button>
            </div>
        </article>
    );
}
