import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ClientResponseError } from "pocketbase";

import { pb } from "../lib/pbClient";
import { errorStatus, serverMessage } from "../lib/pbErrors";
import { dayKeyOf, formatLongDate, formatTime } from "../lib/dates";
import { parseRule, displayDate, parsePBDate } from "../lib/recurrence";
import ProtectedPhotos from "../components/ProtectedPhotos";
import IssueLocationView from "../components/IssueLocationView";
import IssueReporter from "../components/IssueReporter";
import { MenuButton, Page, PageHeading, SidebarMenu } from "../components/Page";
import FormField, { SwitchField } from "../components/FormField";
import {
    buildIssueAccept,
    buildIssueReject,
    buildSuggestionDecision,
    decisionNoteSchema,
    toPBDateTime,
    type IssueVisibility,
    type SuggestionStatus,
} from "../lib/validation";
import {
    isIdentifyingLocation,
    shareIssueLocation,
    useIssueAreas,
    useIssueLocation,
} from "../lib/issueAreas";
import type { AgendaItem, CalendarId, PortalIssue, PortalSuggestion } from "../types";
import { CALENDARS } from "../lib/calendars";
import { toInputValue, buildRRule, parseEditableRule, validateRecurrence, type RecurrenceErrors, type RecurrenceValues } from "../lib/eventForm";
import RecurrenceFields from "../components/RecurrenceFields";

type Tab = "suggestions" | "issues" | "agenda";

interface QueueState {
    suggestions: PortalSuggestion[];
    issues: PortalIssue[];
    agenda: AgendaItem[];
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
        agenda: [],
        loading: true,
        error: false,
    });

    const load = useCallback(() => {
        let active = true;
        setState((prev) => ({ ...prev, loading: true, error: false }));
        Promise.all([
            pb.collection<PortalSuggestion>("suggestions").getFullList({
                filter: "status = 'pending'",
                sort: "date_start",
            }),
            // oldest report first: it has been waiting the longest
            pb.collection<PortalIssue>("issues").getFullList({
                filter: "status = 'pending'",
                sort: "created",
            }),
            pb.collection<AgendaItem>("agenda_items").getFullList({
                filter: "status = 'pending'",
                sort: "created",
                expand: "author",
            }),
        ])
            .then(([suggestions, issues, agenda]) => {
                if (active) {
                    setState({ suggestions, issues, agenda, loading: false, error: false });
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

    const onAgendaDecided = (id: string) => {
        setState((prev) => ({ ...prev, agenda: prev.agenda.filter((item) => item.id !== id) }));
    };

    const onSuggestionUpdated = (updated: PortalSuggestion) => {
        setState((prev) => ({
            ...prev,
            suggestions: prev.suggestions.map((item) => (item.id === updated.id ? updated : item)),
        }));
    };

    const onIssueUpdated = (updated: PortalIssue) => {
        setState((prev) => ({
            ...prev,
            issues: prev.issues.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
        }));
    };

    const onIssueDecided = (id: string) => {
        setState((prev) => ({
            ...prev,
            issues: prev.issues.filter((item) => item.id !== id),
        }));
    };

    return (
        <Page
            sidebar={
                <>
                    <SidebarMenu title={t("moderation.heading")}>
                        <MenuButton
                            icon="ri-calendar-event-line"
                            active={tab === "suggestions"}
                            count={state.suggestions.length}
                            onClick={() => setTab("suggestions")}
                        >
                            {t("moderation.tab.suggestions")}
                        </MenuButton>
                        <MenuButton
                            icon="ri-error-warning-line"
                            active={tab === "issues"}
                            count={state.issues.length}
                            onClick={() => setTab("issues")}
                        >
                            {t("moderation.tab.issues")}
                        </MenuButton>
                        <MenuButton
                            icon="ri-list-ordered"
                            active={tab === "agenda"}
                            count={state.agenda.length}
                            onClick={() => setTab("agenda")}
                        >
                            {t("moderation.tab.agenda")}
                        </MenuButton>
                    </SidebarMenu>
                    <p className="txt-hint sidebar-text">{t("moderation.intro")}</p>
                </>
            }
        >
            <PageHeading
                title={t(`moderation.tab.${tab}`)}
            />

            {state.loading && <p className="txt-hint">{t("moderation.loading")}</p>}
            {state.error && <div className="alert danger">{t("moderation.error.load")}</div>}

            {!state.loading && !state.error && tab === "suggestions" && (
                <section className="flex-column gap-sm">
                    {state.suggestions.length === 0 ? (
                        <div className="alert">{t("moderation.empty.suggestions")}</div>
                    ) : (
                        state.suggestions.map((item) => (
                            <SuggestionCard key={item.id} suggestion={item} onDecided={onSuggestionDecided} onUpdated={onSuggestionUpdated} />
                        ))
                    )}
                </section>
            )}

            {!state.loading && !state.error && tab === "agenda" && (
                <section className="flex-column gap-sm">
                    {state.agenda.length === 0 ? (
                        <div className="alert">{t("moderation.empty.agenda")}</div>
                    ) : (
                        state.agenda.map((item) => (
                            <AgendaCard key={item.id} item={item} onDecided={onAgendaDecided} />
                        ))
                    )}
                </section>
            )}

            {!state.loading && !state.error && tab === "issues" && (
                <section className="flex-column gap-sm">
                    {state.issues.length === 0 ? (
                        <div className="alert">{t("moderation.empty.issues")}</div>
                    ) : (
                        state.issues.map((item) => (
                            <IssueCard key={item.id} issue={item} onDecided={onIssueDecided} onUpdated={onIssueUpdated} />
                        ))
                    )}
                </section>
            )}
        </Page>
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
        <div className="alert danger">
            {t(error.key)}
            {error.detail ? ` (${error.detail})` : ""}
        </div>
    );
}

function SuggestionCard({
    suggestion,
    onDecided,
    onUpdated,
}: {
    suggestion: PortalSuggestion;
    onDecided: (id: string) => void;
    onUpdated: (updated: PortalSuggestion) => void;
}) {
    const { t, i18n } = useTranslation();
    const locale = i18n.language;

    const [editing, setEditing] = useState(false);
    const [calendar, setCalendar] = useState<CalendarId>("public");
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<{ key: string; detail: string } | null>(null);

    const start = displayDate(suggestion.date_start, suggestion.all_day);
    const end = displayDate(suggestion.date_end, suggestion.all_day);
    const submitted = parsePBDate(suggestion.created);
    const endOnOtherDay = start && end && dayKeyOf(end) !== dayKeyOf(start);

    // compact repetition label of a suggested series (like EventDetail)
    const ruleSummary = parseRule(suggestion.rrule);
    const repeatLabel = (() => {
        if (!ruleSummary) return "";
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

    const dateLabel = (() => {
        if (!start) return "";
        if (suggestion.all_day) {
            return formatLongDate(start, locale) +
                (end && endOnOtherDay ? ` – ${formatLongDate(end, locale)}` : "") +
                ` (${t("event.allDay")})`;
        }
        const from = `${formatLongDate(start, locale)}, ${formatTime(start, locale)}`;
        if (!end) return from;
        return endOnOtherDay
            ? `${from} – ${formatLongDate(end, locale)}, ${formatTime(end, locale)}`
            : `${from} – ${formatTime(end, locale)}`;
    })();

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
                .update(suggestion.id, {
                    ...buildSuggestionDecision(status, note),
                    // the accepted event goes into the chosen calendar
                    ...(status === "accepted" ? { calendar } : {}),
                });
            onDecided(suggestion.id);
        } catch (err) {
            setError(decisionErrorKey(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <article className="post queue-card">
            <header className="queue-card-header">
                <div className="queue-card-title-row">
                    <h2 className="post-title">{suggestion.title}</h2>
                    {!editing && (
                        <button type="button" className="btn sm secondary transparent" onClick={() => setEditing(true)}>
                            <i className="ri-edit-line" aria-hidden="true" />
                            <span className="txt">{t("moderation.edit")}</span>
                        </button>
                    )}
                </div>
                {submitted && (
                    <span className="meta">
                        <span className="meta-item">
                            <i className="ri-time-line" aria-hidden="true" />
                            {t("moderation.submitted")} {formatLongDate(submitted, locale)}
                        </span>
                    </span>
                )}
            </header>
            {editing && (
                <SuggestionEditor
                    suggestion={suggestion}
                    onSaved={(updated) => {
                        setEditing(false);
                        onUpdated(updated);
                    }}
                    onCancel={() => setEditing(false)}
                />
            )}
            {!editing && suggestion.description && <div className="content prewrap">{suggestion.description}</div>}
            {!editing && <ul className="fact-list">
                <li>
                    <i className="ri-calendar-2-line" aria-hidden="true" />
                    <span>{dateLabel}</span>
                </li>
                {suggestion.location && (
                    <li>
                        <i className="ri-map-pin-line" aria-hidden="true" />
                        <span>{suggestion.location}</span>
                    </li>
                )}
                {suggestion.category && (
                    <li>
                        <i className="ri-price-tag-3-line" aria-hidden="true" />
                        <span>{suggestion.category}</span>
                    </li>
                )}
                {repeatLabel && (
                    <li>
                        <i className="ri-repeat-line" aria-hidden="true" />
                        <span>{repeatLabel}</span>
                    </li>
                )}
                <li>
                    <i className="ri-mail-line" aria-hidden="true" />
                    <a href={`mailto:${suggestion.email}`}>{suggestion.email}</a>
                </li>
            </ul>}
            <hr />
            <fieldset className="visibility-choice">
                <legend className="field-group-label">{t("moderation.targetCalendar")}</legend>
                <div className="visibility-options calendar-options">
                    {CALENDARS.map((c) => (
                        <label key={c.id} className={`choice-card calendar-choice calendar-${c.id} ${calendar === c.id ? "active" : ""}`}>
                            <input
                                type="radio"
                                name={`calendar-${suggestion.id}`}
                                checked={calendar === c.id}
                                onChange={() => setCalendar(c.id)}
                            />
                            <i className={c.icon} aria-hidden="true" />
                            <span className="choice-card-txt">
                                <strong>{t(`calendars.${c.id}`)}</strong>
                                <span className="txt-hint txt-sm">{t(`calendars.${c.id}Hint`)}</span>
                            </span>
                        </label>
                    ))}
                </div>
            </fieldset>
            <div className="grid sm">
                <FormField
                    id={`note-${suggestion.id}`}
                    label={t("moderation.decisionNote")}
                    hint={t("moderation.decisionNoteHint")}
                >
                    <textarea
                        id={`note-${suggestion.id}`}
                        rows={2}
                        maxLength={2000}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                    />
                </FormField>
            </div>
            <DecisionError error={error} />
            <footer className="form-footer">
                <button type="button" className="btn secondary" disabled={busy} onClick={() => decide("rejected")}>
                    <i className="ri-close-line" aria-hidden="true" />
                    <span className="txt">{t("moderation.reject")}</span>
                </button>
                <button type="button" className={`btn ${busy ? "loading" : ""}`} disabled={busy} onClick={() => decide("accepted")}>
                    <i className="ri-check-line" aria-hidden="true" />
                    <span className="txt">{t("moderation.accept")}</span>
                </button>
            </footer>
        </article>
    );
}

function IssueCard({
    issue,
    onDecided,
    onUpdated,
}: {
    issue: PortalIssue;
    onDecided: (id: string) => void;
    onUpdated: (updated: PortalIssue) => void;
}) {
    const { t, i18n } = useTranslation();
    const locale = i18n.language;
    const submitted = parsePBDate(issue.created);
    const [editing, setEditing] = useState(false);

    const [visibility, setVisibility] = useState<IssueVisibility | "">("");

    // the location (Beirat sees every one) and whether to share it with
    // Hausmeister/Hausverwaltung - decided together with the accept
    const areas = useIssueAreas();
    const { location } = useIssueLocation(issue.id);
    const [shareLocation, setShareLocation] = useState(true);
    const identifying = isIdentifyingLocation(location ?? null);
    // a floor or a pin narrows down to single flats: suggest "private"
    useEffect(() => {
        if (identifying) {
            setVisibility((current) => (current === "" ? "private" : current));
        }
    }, [identifying]);
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
            if (location) {
                // a new location is never shared until the Beirat says so
                await shareIssueLocation(issue.id, shareLocation);
            }
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
        <article className="post queue-card">
            <header className="queue-card-header">
                <div className="queue-card-title-row">
                    <h2 className="post-title">
                        <Link to={`/issues/${issue.id}`}>{issue.title}</Link>
                    </h2>
                    {!editing && (
                        <button type="button" className="btn sm secondary transparent" onClick={() => setEditing(true)}>
                            <i className="ri-edit-line" aria-hidden="true" />
                            <span className="txt">{t("moderation.edit")}</span>
                        </button>
                    )}
                </div>
                <span className="meta">
                    {submitted && (
                        <span className="meta-item">
                            <i className="ri-time-line" aria-hidden="true" />
                            {t("moderation.submitted")} {formatLongDate(submitted, locale)}
                        </span>
                    )}
                    {issue.category && (
                        <span className="meta-item">
                            <i className="ri-price-tag-3-line" aria-hidden="true" />
                            {issue.category}
                        </span>
                    )}
                </span>
            </header>
            {editing ? (
                <IssueEditor
                    issue={issue}
                    onSaved={(updated) => {
                        setEditing(false);
                        onUpdated(updated);
                    }}
                    onCancel={() => setEditing(false)}
                />
            ) : (
                issue.description && <div className="content prewrap">{issue.description}</div>
            )}
            <ul className="fact-list">
                <li>
                    <i className="ri-user-line" aria-hidden="true" />
                    <IssueReporter issueId={issue.id} />
                </li>
            </ul>
            <IssueLocationView location={location} areas={areas} />
            {issue.photos.length > 0 && (
                <ProtectedPhotos recordId={issue.id} photos={issue.photos} thumb="100x100" />
            )}
            <hr />
            <fieldset className="visibility-choice">
                <legend className="field-group-label required">{t("moderation.visibility.label")}</legend>
                <div className="visibility-options">
                    {(["community", "private"] as const).map((option) => (
                        <label key={option} className={`choice-card ${visibility === option ? "active" : ""}`}>
                            <input
                                type="radio"
                                name={`visibility-${issue.id}`}
                                value={option}
                                checked={visibility === option}
                                onChange={() => setVisibility(option)}
                            />
                            <i className={option === "private" ? "ri-lock-line" : "ri-group-line"} aria-hidden="true" />
                            <span className="choice-card-txt">
                                <strong>{t(`moderation.visibility.${option}`)}</strong>
                                <span className="txt-hint txt-sm">{t(`issueVisibility.${option}.hint`)}</span>
                            </span>
                        </label>
                    ))}
                </div>
                {identifying && <div className="field-help">{t("moderation.visibility.locationHint")}</div>}
            </fieldset>
            {location && (
                <div className="grid sm">
                    <SwitchField
                        id={`share-location-${issue.id}`}
                        label={t("moderation.shareLocation.label")}
                        hint={t("moderation.shareLocation.hint")}
                        checked={shareLocation}
                        onChange={(e) => setShareLocation(e.target.checked)}
                    />
                </div>
            )}
            <DecisionError error={error} />
            <footer className="form-footer">
                <button type="button" className="btn secondary" disabled={busy} onClick={reject}>
                    <i className="ri-close-line" aria-hidden="true" />
                    <span className="txt">{t("moderation.reject")}</span>
                </button>
                <button type="button" className={`btn ${busy ? "loading" : ""}`} disabled={busy} onClick={accept}>
                    <i className="ri-check-line" aria-hidden="true" />
                    <span className="txt">{t("moderation.accept")}</span>
                </button>
            </footer>
        </article>
    );
}

// ---------------------------------------------------------------------------
// edit before deciding (plain field updates without a status: allowed by
// the beirat update rule and the workflow hooks)
// ---------------------------------------------------------------------------

function EditorFooter({ busy, onCancel }: { busy: boolean; onCancel: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="col-12">
            <footer className="form-footer">
                <button type="button" className="btn sm secondary" disabled={busy} onClick={onCancel}>
                    {t("eventEditor.cancel")}
                </button>
                <button type="submit" className={`btn sm ${busy ? "loading" : ""}`} disabled={busy}>
                    <span className="txt">{t("eventEditor.save")}</span>
                </button>
            </footer>
        </div>
    );
}

function SuggestionEditor({
    suggestion,
    onSaved,
    onCancel,
}: {
    suggestion: PortalSuggestion;
    onSaved: (updated: PortalSuggestion) => void;
    onCancel: () => void;
}) {
    const { t } = useTranslation();
    const [values, setValues] = useState({
        title: suggestion.title,
        description: suggestion.description,
        all_day: suggestion.all_day,
        date_start: toInputValue(suggestion.date_start, suggestion.all_day),
        date_end: toInputValue(suggestion.date_end, suggestion.all_day),
        location: suggestion.location,
        category: suggestion.category,
    });
    // the repetition travels with the suggestion into the created event
    const [recurrence, setRecurrence] = useState<RecurrenceValues>(() => ({
        all_day: suggestion.all_day,
        ...parseEditableRule(suggestion.rrule ?? ""),
    }));
    const [recErrors, setRecErrors] = useState<RecurrenceErrors>({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const id = (field: string) => `edit-${field}-${suggestion.id}`;
    const type = values.all_day ? "date" : "datetime-local";

    const submit = async (e: { preventDefault(): void }) => {
        e.preventDefault();
        if (!values.title.trim() || !values.date_start) {
            setError(t("validation.required"));
            return;
        }
        const found = validateRecurrence({ ...recurrence, all_day: values.all_day }, values.date_start);
        setRecErrors(found);
        if (Object.keys(found).length > 0) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const updated = await pb.collection<PortalSuggestion>("suggestions").update(suggestion.id, {
                title: values.title.trim(),
                description: values.description.trim(),
                all_day: values.all_day,
                date_start: toPBDateTime(values.date_start, values.all_day),
                date_end: values.date_end ? toPBDateTime(values.date_end, values.all_day) : "",
                location: values.location.trim(),
                category: values.category.trim(),
                rrule: buildRRule({ ...recurrence, all_day: values.all_day }),
            });
            onSaved(updated);
        } catch (err) {
            setError(t("moderation.error.generic") + (err instanceof ClientResponseError ? ` (${serverMessage(err)})` : ""));
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit} noValidate>
            <div className="grid sm">
                <FormField id={id("title")} label={t("suggestion.title")} required>
                    <input id={id("title")} type="text" maxLength={200} value={values.title} onChange={(e) => setValues({ ...values, title: e.target.value })} />
                </FormField>
                <FormField id={id("description")} label={t("suggestion.description")}>
                    <textarea id={id("description")} rows={3} maxLength={5000} value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} />
                </FormField>
                <SwitchField
                    id={id("all-day")}
                    label={t("suggestion.allDay")}
                    checked={values.all_day}
                    onChange={(e) =>
                        setValues({
                            ...values,
                            all_day: e.target.checked,
                            date_start: e.target.checked ? values.date_start.slice(0, 10) : values.date_start,
                            date_end: e.target.checked ? values.date_end.slice(0, 10) : values.date_end,
                        })
                    }
                />
                <FormField id={id("start")} className="col-12 col-md-6" label={t("suggestion.dateStart")} required>
                    <input id={id("start")} type={type} value={values.date_start} onChange={(e) => setValues({ ...values, date_start: e.target.value })} />
                </FormField>
                <FormField id={id("end")} className="col-12 col-md-6" label={t("suggestion.dateEnd")}>
                    <input id={id("end")} type={type} value={values.date_end} onChange={(e) => setValues({ ...values, date_end: e.target.value })} />
                </FormField>
                <FormField id={id("location")} className="col-12 col-md-6" label={t("suggestion.location")}>
                    <input id={id("location")} type="text" maxLength={200} value={values.location} onChange={(e) => setValues({ ...values, location: e.target.value })} />
                </FormField>
                <FormField id={id("category")} className="col-12 col-md-6" label={t("suggestion.category")}>
                    <input id={id("category")} type="text" maxLength={100} value={values.category} onChange={(e) => setValues({ ...values, category: e.target.value })} />
                </FormField>
                <RecurrenceFields
                    idPrefix={id("recurrence")}
                    values={{ ...recurrence, all_day: values.all_day }}
                    onChange={(patch) => setRecurrence((prev) => ({ ...prev, ...patch }))}
                    errors={recErrors}
                />
                {error && (
                    <div className="col-12">
                        <div className="alert danger">{error}</div>
                    </div>
                )}
                <EditorFooter busy={busy} onCancel={onCancel} />
            </div>
        </form>
    );
}

function IssueEditor({
    issue,
    onSaved,
    onCancel,
}: {
    issue: PortalIssue;
    onSaved: (updated: PortalIssue) => void;
    onCancel: () => void;
}) {
    const { t } = useTranslation();
    const [title, setTitle] = useState(issue.title);
    const [description, setDescription] = useState(issue.description);
    const [category, setCategory] = useState(issue.category);
    // photos the Beirat removes before publishing (e.g. they show people,
    // name plates or licence plates)
    const [removedPhotos, setRemovedPhotos] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: { preventDefault(): void }) => {
        e.preventDefault();
        if (!title.trim()) {
            setError(t("validation.required"));
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const updated = await pb.collection<PortalIssue>("issues").update(issue.id, {
                title: title.trim(),
                description: description.trim(),
                category: category.trim(),
                // PocketBase "field-" modifier: delete these files
                ...(removedPhotos.length > 0 ? { "photos-": removedPhotos } : {}),
            });
            onSaved(updated);
        } catch (err) {
            setError(t("moderation.error.generic") + (err instanceof ClientResponseError ? ` (${serverMessage(err)})` : ""));
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit} noValidate>
            <div className="grid sm">
                <FormField id={`edit-title-${issue.id}`} label={t("issue.title")} required>
                    <input id={`edit-title-${issue.id}`} type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
                </FormField>
                <FormField id={`edit-description-${issue.id}`} label={t("issue.description")}>
                    <textarea id={`edit-description-${issue.id}`} rows={3} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
                </FormField>
                <FormField id={`edit-category-${issue.id}`} label={t("issue.category")}>
                    <input id={`edit-category-${issue.id}`} type="text" maxLength={100} value={category} onChange={(e) => setCategory(e.target.value)} />
                </FormField>
                <div className="col-12">
                    <div className="field-help">{t("moderation.editHint")}</div>
                </div>
                {issue.photos.map((photo, index) => (
                    <SwitchField
                        key={photo}
                        id={`edit-remove-photo-${issue.id}-${index}`}
                        label={t("moderation.removePhoto", { index: index + 1 })}
                        checked={removedPhotos.includes(photo)}
                        onChange={(e) =>
                            setRemovedPhotos((prev) =>
                                e.target.checked ? [...prev, photo] : prev.filter((name) => name !== photo),
                            )
                        }
                    />
                ))}
                {error && (
                    <div className="col-12">
                        <div className="alert danger">{error}</div>
                    </div>
                )}
                <EditorFooter busy={busy} onCancel={onCancel} />
            </div>
        </form>
    );
}

// ---------------------------------------------------------------------------
// topics for the owners' meeting
// ---------------------------------------------------------------------------

function AgendaCard({ item, onDecided }: { item: AgendaItem; onDecided: (id: string) => void }) {
    const { t, i18n } = useTranslation();
    const locale = i18n.language;
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<{ key: string; detail: string } | null>(null);
    const submitted = parsePBDate(item.created);

    const decide = async (status: "accepted" | "rejected") => {
        setBusy(true);
        setError(null);
        try {
            await pb.collection("agenda_items").update(item.id, {
                status,
                ...(note.trim() ? { decision_note: note.trim() } : {}),
            });
            onDecided(item.id);
        } catch (err) {
            setError(decisionErrorKey(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <article className="post queue-card">
            <header className="queue-card-header">
                <h2 className="post-title">{item.title}</h2>
                <span className="meta">
                    {item.expand?.author?.name && (
                        <span className="meta-item">
                            <i className="ri-user-line" aria-hidden="true" />
                            {item.expand.author.name}
                        </span>
                    )}
                    {submitted && (
                        <span className="meta-item">
                            <i className="ri-time-line" aria-hidden="true" />
                            {t("moderation.submitted")} {formatLongDate(submitted, locale)}
                        </span>
                    )}
                </span>
            </header>
            {item.description && <div className="content prewrap">{item.description}</div>}
            <hr />
            <div className="grid sm">
                <FormField id={`agenda-note-${item.id}`} label={t("moderation.decisionNote")} hint={t("moderation.agendaNoteHint")}>
                    <textarea id={`agenda-note-${item.id}`} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
                </FormField>
            </div>
            <DecisionError error={error} />
            <footer className="form-footer">
                <button type="button" className="btn secondary" disabled={busy} onClick={() => void decide("rejected")}>
                    <i className="ri-close-line" aria-hidden="true" />
                    <span className="txt">{t("moderation.reject")}</span>
                </button>
                <button type="button" className={`btn ${busy ? "loading" : ""}`} disabled={busy} onClick={() => void decide("accepted")}>
                    <i className="ri-check-line" aria-hidden="true" />
                    <span className="txt">{t("moderation.acceptTopic")}</span>
                </button>
            </footer>
        </article>
    );
}
