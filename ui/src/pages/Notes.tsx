import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClientResponseError } from "pocketbase";

import { pb } from "../lib/pbClient";
import { errorStatus, serverMessage } from "../lib/pbErrors";
import { orderNotes, renderMarkdown } from "../lib/markdown";
import {
    buildNoteCreate,
    buildNotePinUpdate,
    buildNoteUpdate,
    noteSchema,
} from "../lib/validation";
import type { PortalNote } from "../types";

interface NotesState {
    notes: PortalNote[];
    loading: boolean;
    error: boolean;
}

// Beirat notes (M10): the internal notes area. The list is ordered
// pinned-first (lib/markdown.ts orderNotes); the note bodies are raw
// markdown from the editor field and are rendered through
// renderMarkdown (marked + DOMPurify) before being injected - never
// as raw text/html of the record. The `author` relation is filled
// from the auth store on create and NEVER sent on edit, so the client
// cannot re-attribute notes (the create rule additionally requires
// author = @request.auth.id server-side).
export default function Notes() {
    const { t } = useTranslation();
    const [state, setState] = useState<NotesState>({
        notes: [],
        loading: true,
        error: false,
    });
    // id of the note currently being edited inline
    const [editingId, setEditingId] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        setState((prev) => ({ ...prev, loading: true, error: false }));
        pb.collection<PortalNote>("notes")
            .getFullList({ sort: "title", expand: "author" })
            .then((notes) => {
                if (active) {
                    setState({
                        notes: orderNotes(notes),
                        loading: false,
                        error: false,
                    });
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

    const upsertNote = (note: PortalNote) => {
        setState((prev) => {
            const exists = prev.notes.some((item) => item.id === note.id);
            const notes = exists
                ? prev.notes.map((item) => (item.id === note.id ? note : item))
                : [...prev.notes, note];
            return { ...prev, notes: orderNotes(notes) };
        });
    };

    const removeNote = (id: string) => {
        setState((prev) => ({
            ...prev,
            notes: orderNotes(prev.notes.filter((item) => item.id !== id)),
        }));
    };

    const onSaved = (note: PortalNote) => {
        setEditingId(null);
        upsertNote(note);
    };

    const onPinChange = (note: PortalNote, pinned: boolean) => {
        // optimistic, reverted on error
        upsertNote({ ...note, pinned });
        pb.collection<PortalNote>("notes")
            .update(note.id, buildNotePinUpdate(pinned))
            .catch(() => upsertNote(note));
    };

    const onDelete = (note: PortalNote) => {
        if (!window.confirm(t("notes.confirmDelete"))) {
            return;
        }
        removeNote(note.id);
        pb.collection("notes").delete(note.id).catch(() => {
            // reload so the list mirrors the server again
            pb.collection<PortalNote>("notes")
                .getFullList({ sort: "title", expand: "author" })
                .then((notes) =>
                    setState((prev) => ({ ...prev, notes: orderNotes(notes), error: false })),
                )
                .catch(() => setState((prev) => ({ ...prev, error: true })));
        });
    };

    return (
        <>
            <h1>{t("notes.heading")}</h1>

            {state.loading && <p className="state">{t("notes.loading")}</p>}
            {state.error && (
                <p className="state state-error">{t("notes.error.load")}</p>
            )}

            {!state.loading && state.notes.length === 0 && !state.error && (
                <p className="state">{t("notes.empty")}</p>
            )}

            {state.notes.length > 0 && (
                <section className="notes-list" aria-label={t("notes.heading")}>
                    {state.notes.map((note) =>
                        editingId === note.id ? (
                            <NoteForm
                                key={note.id}
                                note={note}
                                onSaved={onSaved}
                                onCancel={() => setEditingId(null)}
                            />
                        ) : (
                            <NoteCard
                                key={note.id}
                                note={note}
                                onEdit={() => setEditingId(note.id)}
                                onPinChange={onPinChange}
                                onDelete={onDelete}
                            />
                        ),
                    )}
                </section>
            )}

            <NoteForm onSaved={onSaved} />
        </>
    );
}

function NoteCard({
    note,
    onEdit,
    onPinChange,
    onDelete,
}: {
    note: PortalNote;
    onEdit: () => void;
    onPinChange: (note: PortalNote, pinned: boolean) => void;
    onDelete: (note: PortalNote) => void;
}) {
    const { t } = useTranslation();
    const author = note.expand?.author?.name || t("notes.unknownAuthor");

    return (
        <article className="card note-card">
            <div className="note-head">
                <h2 className="note-title">{note.title}</h2>
                {note.pinned && <span className="chip chip-pinned">{t("notes.pinned")}</span>}
            </div>
            <p className="note-meta">
                {t("notes.author")}: {author}
            </p>
            {/* raw markdown from the editor field -> rendered + sanitized */}
            <div
                className="note-body md-body"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(note.body) }}
            />
            <div className="btn-row">
                <button type="button" className="btn btn-outline btn-sm" onClick={() => onPinChange(note, !note.pinned)}>
                    {t(note.pinned ? "notes.unpin" : "notes.pin")}
                </button>
                <button type="button" className="btn btn-outline btn-sm" onClick={onEdit}>
                    {t("notes.editAction")}
                </button>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => onDelete(note)}>
                    {t("notes.delete")}
                </button>
            </div>
        </article>
    );
}

// Shared create + edit form: create mode (no `note`) posts a new
// note with the author from the auth store; edit mode patches the
// title/body ONLY - the author is deliberately not part of the update.
function NoteForm({
    note,
    onSaved,
    onCancel,
}: {
    note?: PortalNote;
    onSaved: (note: PortalNote) => void;
    onCancel?: () => void;
}) {
    const { t } = useTranslation();
    const [title, setTitle] = useState(note?.title ?? "");
    const [body, setBody] = useState(note?.body ?? "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(null);

        const parsed = noteSchema.safeParse({ title, body });
        if (!parsed.success) {
            setError(t(parsed.error.issues[0]?.message ?? "validation.required"));
            return;
        }

        setBusy(true);
        try {
            if (note) {
                const updated = await pb
                    .collection<PortalNote>("notes")
                    .update(note.id, buildNoteUpdate(parsed.data));
                // keep the expand data of the loaded record (author)
                onSaved({ ...note, ...updated });
            } else {
                const record = pb.authStore.record as Record<string, unknown> | null;
                const authorId = typeof record?.["id"] === "string" ? record["id"] : "";
                const authorName = typeof record?.["name"] === "string" ? record["name"] : "";
                const created = await pb
                    .collection<PortalNote>("notes")
                    .create(buildNoteCreate(parsed.data, authorId));
                setTitle("");
                setBody("");
                // the user's own auth record is the author (create rule
                // requires author = self, so this can never disagree)
                onSaved({ ...created, expand: { author: { id: authorId, name: authorName } } });
            }
        } catch (err) {
            if (err instanceof ClientResponseError && errorStatus(err) === 400) {
                setError(`${t("notes.error.save")} (${serverMessage(err)})`);
            } else {
                setError(t("notes.error.save"));
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="card form note-form" onSubmit={onSubmit}>
            <h2 className="section-title">
                {t(note ? "notes.edit.heading" : "notes.new.heading")}
            </h2>
            <div className="field">
                <label htmlFor={`note-title-${note ? note.id : "new"}`}>
                    {t("notes.new.title")}
                </label>
                <input
                    id={`note-title-${note ? note.id : "new"}`}
                    type="text"
                    value={title}
                    disabled={busy}
                    onChange={(event) => setTitle(event.target.value)}
                />
            </div>
            <div className="field">
                <label htmlFor={`note-body-${note ? note.id : "new"}`}>
                    {t("notes.new.body")}
                </label>
                <textarea
                    id={`note-body-${note ? note.id : "new"}`}
                    className="note-textarea"
                    rows={8}
                    value={body}
                    disabled={busy}
                    onChange={(event) => setBody(event.target.value)}
                />
                <p className="hint">{t("notes.hint")}</p>
            </div>
            {error && <div className="form-error">{error}</div>}
            <div className="btn-row">
                <button type="submit" className="btn" disabled={busy}>
                    {t(note ? "notes.edit.submit" : "notes.new.submit")}
                </button>
                {note && (
                    <button
                        type="button"
                        className="btn btn-outline"
                        disabled={busy}
                        onClick={onCancel}
                    >
                        {t("notes.edit.cancel")}
                    </button>
                )}
            </div>
        </form>
    );
}
