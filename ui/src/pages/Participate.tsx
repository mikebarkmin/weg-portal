import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClientResponseError } from "pocketbase";

import { pb } from "../lib/pbClient";
import { canShow, useAuth } from "../lib/auth";
import { serverMessage } from "../lib/pbErrors";
import { formatLongDate } from "../lib/dates";
import { parsePBDate } from "../lib/recurrence";
import type { AgendaItem, Poll, PollVote } from "../types";
import { MenuButton, Page, PageHeading, SidebarMenu } from "../components/Page";
import FormField from "../components/FormField";
import ConfirmDeleteButton from "../components/ConfirmDeleteButton";
import { showError } from "../lib/toast";

type Section = "polls" | "agenda";

function pollClosed(poll: Poll): boolean {
    const closes = parsePBDate(poll.closes_at);
    return !!closes && closes.getTime() <= Date.now();
}

// Mitreden (owners): non-binding opinion polls and topics for the next
// owners' meeting. Polls are explicitly NOT resolutions (§ 23 WEG); only
// aggregated results are ever shown.
export default function Participate() {
    const { t } = useTranslation();
    const auth = useAuth();
    const isBeirat = canShow(auth.role);
    const [section, setSection] = useState<Section>("polls");

    return (
        <Page
            sidebar={
                <>
                    <SidebarMenu title={t("participate.heading")}>
                        <MenuButton icon="ri-bar-chart-box-line" active={section === "polls"} onClick={() => setSection("polls")}>
                            {t("participate.polls")}
                        </MenuButton>
                        <MenuButton icon="ri-list-ordered" active={section === "agenda"} onClick={() => setSection("agenda")}>
                            {t("participate.agenda")}
                        </MenuButton>
                    </SidebarMenu>
                    <p className="txt-hint sidebar-text">
                        {section === "polls" ? t("participate.pollsIntro") : t("participate.agendaIntro")}
                    </p>
                </>
            }
        >
            {section === "polls" ? <Polls isBeirat={isBeirat} /> : <Agenda />}
        </Page>
    );
}

// ---------------------------------------------------------------------------
// polls
// ---------------------------------------------------------------------------

function Polls({ isBeirat }: { isBeirat: boolean }) {
    const { t } = useTranslation();
    const [polls, setPolls] = useState<Poll[] | null>(null);
    const [votes, setVotes] = useState<Record<string, PollVote>>({});
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState(false);

    const load = useCallback(() => {
        Promise.all([
            pb.collection<Poll>("polls").getFullList({ sort: "-created" }),
            pb.collection<PollVote>("poll_votes").getFullList(),
        ])
            .then(([pollList, voteList]) => {
                setPolls(pollList);
                setVotes(Object.fromEntries(voteList.map((v) => [v.poll, v])));
                setError(false);
            })
            .catch(() => setError(true));
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const open = (polls ?? []).filter((p) => !pollClosed(p));
    const closed = (polls ?? []).filter(pollClosed);

    return (
        <>
            <PageHeading title={t("participate.polls")}>
                {isBeirat && !creating && (
                    <button type="button" className="btn sm" onClick={() => setCreating(true)}>
                        <i className="ri-add-line" aria-hidden="true" />
                        <span className="txt">{t("participate.newPoll")}</span>
                    </button>
                )}
            </PageHeading>
            <div className="flex-column gap-sm">
                <div className="alert info">
                    <i className="ri-information-line" aria-hidden="true" /> {t("participate.nonBinding")}
                </div>
                {creating && (
                    <PollForm
                        onSaved={() => {
                            setCreating(false);
                            load();
                        }}
                        onCancel={() => setCreating(false)}
                    />
                )}
                {error && <div className="alert danger">{t("participate.loadError")}</div>}
                {polls === null && !error && <p className="txt-hint">{t("calendar.loading")}</p>}
                {polls !== null && polls.length === 0 && <div className="alert">{t("participate.noPolls")}</div>}
                {open.map((poll) => (
                    <PollCard key={poll.id} poll={poll} vote={votes[poll.id]} isBeirat={isBeirat} onChanged={load} />
                ))}
                {closed.length > 0 && (
                    <>
                        <h2 className="section-title m-t-sm">{t("participate.closedPolls")}</h2>
                        {closed.map((poll) => (
                            <PollCard key={poll.id} poll={poll} vote={votes[poll.id]} isBeirat={isBeirat} onChanged={load} />
                        ))}
                    </>
                )}
            </div>
        </>
    );
}

function PollCard({
    poll,
    vote,
    isBeirat,
    onChanged,
}: {
    poll: Poll;
    vote?: PollVote;
    isBeirat: boolean;
    onChanged: () => void;
}) {
    const { t, i18n } = useTranslation();
    const closed = pollClosed(poll);
    const closes = parsePBDate(poll.closes_at);
    const [choice, setChoice] = useState<number | null>(vote?.option ?? null);
    const [results, setResults] = useState<{ counts: number[]; total: number } | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const showResults = closed || vote !== undefined;

    useEffect(() => {
        setChoice(vote?.option ?? null);
    }, [vote?.option]);

    useEffect(() => {
        if (!showResults) return;
        pb.send<{ counts: number[]; total: number }>(`/api/portal/polls/${poll.id}/results`, {})
            .then(setResults)
            .catch(() => setResults(null));
    }, [poll.id, showResults, vote?.option]);

    const submit = async () => {
        if (choice === null) return;
        setBusy(true);
        setError(null);
        try {
            if (vote) {
                await pb.collection("poll_votes").update(vote.id, { option: choice });
            } else {
                await pb.collection("poll_votes").create({ poll: poll.id, user: pb.authStore.record?.id, option: choice });
            }
            onChanged();
        } catch (err) {
            setError(t("participate.voteError") + (err instanceof ClientResponseError ? ` (${serverMessage(err)})` : ""));
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        await pb.collection("polls").delete(poll.id);
        onChanged();
    };

    return (
        <article className="post poll-card">
            <header className="queue-card-header">
                <h2 className="post-title">{poll.question}</h2>
                <span className="meta">
                    <span className={`label sm ${closed ? "" : "success"}`}>
                        {closed ? t("participate.closed") : t("participate.open")}
                    </span>
                    {closes && (
                        <span className="meta-item">
                            <i className="ri-calendar-close-line" aria-hidden="true" />
                            {t(closed ? "participate.closedOn" : "participate.closesOn", {
                                date: formatLongDate(closes, i18n.language),
                            })}
                        </span>
                    )}
                    {results && (
                        <span className="meta-item">
                            <i className="ri-group-line" aria-hidden="true" />
                            {t("participate.voteCount", { count: results.total })}
                        </span>
                    )}
                </span>
            </header>
            {poll.description && <div className="content prewrap">{poll.description}</div>}

            <div className="poll-options" role="radiogroup" aria-label={poll.question}>
                {poll.options.map((option, index) => {
                    const count = results?.counts[index] ?? 0;
                    const share = results && results.total > 0 ? Math.round((count / results.total) * 100) : 0;
                    return (
                        <label
                            key={index}
                            className={`choice-card poll-option ${choice === index ? "active" : ""} ${closed ? "disabled" : ""}`}
                        >
                            <input
                                type="radio"
                                name={`poll-${poll.id}`}
                                checked={choice === index}
                                disabled={closed}
                                onChange={() => setChoice(index)}
                            />
                            <i className={choice === index ? "ri-radio-button-fill" : "ri-checkbox-blank-circle-line"} aria-hidden="true" />
                            <span className="choice-card-txt flex-fill">
                                <strong>{option}</strong>
                                {showResults && results && (
                                    <span className="poll-bar" aria-label={`${share} %`}>
                                        <span className="poll-bar-fill" style={{ width: `${share}%` }} />
                                    </span>
                                )}
                            </span>
                            {showResults && results && (
                                <span className="poll-share txt-hint txt-sm">
                                    {share} % · {count}
                                </span>
                            )}
                        </label>
                    );
                })}
            </div>

            {error && <div className="alert danger">{error}</div>}

            <footer className="form-footer">
                {isBeirat && (
                    <ConfirmDeleteButton prompt={t("participate.confirmDeletePoll")} onConfirm={remove} />
                )}
                <span className="flex-fill" />
                {!closed && (
                    <button
                        type="button"
                        className={`btn ${busy ? "loading" : ""}`}
                        disabled={busy || choice === null || choice === vote?.option}
                        onClick={() => void submit()}
                    >
                        <i className="ri-check-line" aria-hidden="true" />
                        <span className="txt">{vote ? t("participate.changeVote") : t("participate.vote")}</span>
                    </button>
                )}
            </footer>
        </article>
    );
}

function PollForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
    const { t } = useTranslation();
    const [question, setQuestion] = useState("");
    const [description, setDescription] = useState("");
    const [options, setOptions] = useState("");
    const [closes, setCloses] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: { preventDefault(): void }) => {
        e.preventDefault();
        const list = options
            .split("\n")
            .map((o) => o.trim())
            .filter(Boolean);
        if (!question.trim() || list.length < 2 || list.length > 10) {
            setError(t("participate.pollInvalid"));
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await pb.collection("polls").create({
                question: question.trim(),
                description: description.trim(),
                options: list,
                closes_at: closes ? new Date(`${closes}T23:59:59`).toISOString() : "",
                created_by: pb.authStore.record?.id,
            });
            onSaved();
        } catch (err) {
            setError(t("participate.saveError") + (err instanceof ClientResponseError ? ` (${serverMessage(err)})` : ""));
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="post" onSubmit={submit} noValidate>
            <h2 className="post-title">{t("participate.newPoll")}</h2>
            <div className="grid sm">
                <FormField id="poll-question" label={t("participate.question")} required>
                    <input id="poll-question" type="text" maxLength={300} value={question} onChange={(e) => setQuestion(e.target.value)} autoFocus />
                </FormField>
                <FormField id="poll-description" label={t("suggestion.description")}>
                    <textarea id="poll-description" rows={2} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
                </FormField>
                <FormField id="poll-options" label={t("participate.options")} required hint={t("participate.optionsHint")}>
                    <textarea id="poll-options" rows={4} value={options} onChange={(e) => setOptions(e.target.value)} />
                </FormField>
                <FormField id="poll-closes" className="col-12 col-md-6" label={t("participate.closesAt")} hint={t("participate.closesAtHint")}>
                    <input id="poll-closes" type="date" value={closes} onChange={(e) => setCloses(e.target.value)} />
                </FormField>
                {error && (
                    <div className="col-12">
                        <div className="alert danger">{error}</div>
                    </div>
                )}
                <div className="col-12">
                    <footer className="form-footer">
                        <button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>
                            {t("eventEditor.cancel")}
                        </button>
                        <button type="submit" className={`btn ${busy ? "loading" : ""}`} disabled={busy}>
                            <span className="txt">{t("participate.startPoll")}</span>
                        </button>
                    </footer>
                </div>
            </div>
        </form>
    );
}

// ---------------------------------------------------------------------------
// agenda topics for the owners' meeting
// ---------------------------------------------------------------------------

function Agenda() {
    const { t, i18n } = useTranslation();
    const locale = i18n.language;
    const userId = pb.authStore.record?.id ?? "";
    const [items, setItems] = useState<AgendaItem[] | null>(null);
    const [error, setError] = useState(false);
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [busy, setBusy] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [sent, setSent] = useState(false);

    const load = useCallback(() => {
        pb.collection<AgendaItem>("agenda_items")
            .getFullList({ sort: "-created" })
            .then((list) => {
                setItems(list);
                setError(false);
            })
            .catch(() => setError(true));
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const submit = async (e: { preventDefault(): void }) => {
        e.preventDefault();
        if (!title.trim()) {
            setFormError(t("validation.required"));
            return;
        }
        setBusy(true);
        setFormError(null);
        try {
            await pb.collection("agenda_items").create({
                title: title.trim(),
                description: description.trim(),
                author: userId,
                status: "pending",
            });
            setTitle("");
            setDescription("");
            setSent(true);
            load();
        } catch (err) {
            setFormError(t("participate.saveError") + (err instanceof ClientResponseError ? ` (${serverMessage(err)})` : ""));
        } finally {
            setBusy(false);
        }
    };

    const withdraw = async (item: AgendaItem) => {
        try {
            await pb.collection("agenda_items").delete(item.id);
        } catch {
            showError();
        }
        load();
    };

    const accepted = (items ?? []).filter((i) => i.status === "accepted");
    const mine = (items ?? []).filter((i) => i.author === userId);

    return (
        <>
            <PageHeading title={t("participate.agenda")} />
            <div className="flex-column gap-sm">
                <form className="post" onSubmit={submit} noValidate>
                    <h2 className="post-title">{t("participate.newTopic")}</h2>
                    <div className="grid sm">
                        <FormField id="agenda-title" label={t("suggestion.title")} required>
                            <input id="agenda-title" type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
                        </FormField>
                        <FormField id="agenda-description" label={t("participate.topicDescription")} hint={t("participate.topicHint")}>
                            <textarea id="agenda-description" rows={3} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
                        </FormField>
                        {formError && (
                            <div className="col-12">
                                <div className="alert danger">{formError}</div>
                            </div>
                        )}
                        {sent && (
                            <div className="col-12">
                                <div className="alert success">{t("participate.topicSent")}</div>
                            </div>
                        )}
                        <div className="col-12">
                            <footer className="form-footer">
                                <button type="submit" className={`btn ${busy ? "loading" : ""}`} disabled={busy}>
                                    <span className="txt">{t("participate.submitTopic")}</span>
                                </button>
                            </footer>
                        </div>
                    </div>
                </form>

                {error && <div className="alert danger">{t("participate.loadError")}</div>}

                <h2 className="section-title m-t-sm">{t("participate.acceptedTopics")}</h2>
                {accepted.length === 0 ? (
                    <div className="alert">{t("participate.noAcceptedTopics")}</div>
                ) : (
                    <div className="list">
                        {accepted.map((item) => (
                            <div key={item.id} className="list-item agenda-row">
                                <span className="status-icon status-resolved" aria-hidden="true">
                                    <i className="ri-check-line" />
                                </span>
                                <span className="content">
                                    <strong>{item.title}</strong>
                                    {item.description && <span className="txt-hint txt-sm prewrap">{item.description}</span>}
                                </span>
                            </div>
                        ))}
                    </div>
                )}

                {mine.length > 0 && (
                    <>
                        <h2 className="section-title m-t-sm">{t("participate.myTopics")}</h2>
                        <div className="list">
                            {mine.map((item) => {
                                const created = parsePBDate(item.created);
                                return (
                                    <div key={item.id} className="list-item agenda-row">
                                        <span className="content">
                                            <strong>{item.title}</strong>
                                            <span className="meta">
                                                <span className={`label sm ${item.status === "accepted" ? "success" : item.status === "rejected" ? "danger" : ""}`}>
                                                    {t(`participate.topicStatus.${item.status}`)}
                                                </span>
                                                {created && (
                                                    <span className="meta-item">
                                                        <i className="ri-time-line" aria-hidden="true" />
                                                        {formatLongDate(created, locale)}
                                                    </span>
                                                )}
                                            </span>
                                            {item.decision_note && (
                                                <span className="txt-hint txt-sm">
                                                    {t("participate.beiratNote")}: {item.decision_note}
                                                </span>
                                            )}
                                        </span>
                                        {item.status === "pending" && (
                                            <span className="ctrls">
                                                <button type="button" className="btn sm secondary transparent" onClick={() => void withdraw(item)}>
                                                    {t("participate.withdraw")}
                                                </button>
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>
        </>
    );
}
