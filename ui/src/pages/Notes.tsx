import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Page, PageHeading, SidebarInfo, SidebarMenu } from "../components/Page";
import FormField from "../components/FormField";
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
    const [creating, setCreating] = useState(false);
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

    // NoteCard asks for confirmation inline before calling this
    const onDelete = (note: PortalNote) => {
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

    const pinnedCount = state.notes.filter((note) => note.pinned).length;

    return (
        <Page
            sidebar={
                <>
                    <SidebarMenu title={t("notes.heading")}>
                        <button type="button" className="menu-item" onClick={() => setCreating(true)}>
                            <i className="ri-add-line" aria-hidden="true" />
                            <span className="txt">{t("notes.new.heading")}</span>
                        </button>
                    </SidebarMenu>
                    <SidebarInfo label={t("notes.overview")}>
                        <span>
                            {t("notes.count", { count: state.notes.length })}
                            {pinnedCount > 0 && <> · {t("notes.pinnedCount", { count: pinnedCount })}</>}
                        </span>
                    </SidebarInfo>
                    <p className="txt-hint sidebar-text">{t("notes.intro")}</p>
                </>
            }
        >
            <PageHeading title={t("notes.heading")}>
                {!creating && (
                    <button type="button" className="btn sm" onClick={() => setCreating(true)}>
                        <i className="ri-add-line" aria-hidden="true" />
                        <span className="txt">{t("notes.new.heading")}</span>
                    </button>
                )}
            </PageHeading>

            <div className="flex-column gap-sm">
                {creating && (
                    <NoteForm
                        onSaved={(note) => {
                            onSaved(note);
                            setCreating(false);
                        }}
                        onCancel={() => setCreating(false)}
                    />
                )}

                {state.loading && <p className="txt-hint">{t("notes.loading")}</p>}
                {state.error && <div className="alert danger">{t("notes.error.load")}</div>}
                {!state.loading && state.notes.length === 0 && !state.error && !creating && (
                    <div className="alert">{t("notes.empty")}</div>
                )}

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
            </div>
        </Page>
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

    const [confirmDelete, setConfirmDelete] = useState(false);
    const initials = author.slice(0, 2).toUpperCase();

    return (
        <article className={`post note-card ${note.pinned ? "pinned" : ""}`}>
            <header className="post-header flex gap-10">
                <span className="thumb circle sm" aria-hidden="true">{initials}</span>
                <span className="author">{author}</span>
                {note.pinned && (
                    <span className="label sm warning">
                        <i className="ri-pushpin-line" aria-hidden="true" />
                        {t("notes.pinned")}
                    </span>
                )}
            </header>
            <h2 className="post-title note-title">{note.title}</h2>
            {/* raw markdown from the editor field -> rendered + sanitized */}
            <div className="content markdown-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(note.body) }} />
            <footer className="post-footer note-actions">
                {confirmDelete ? (
                    <>
                        <span className="txt-hint txt-sm">{t("notes.confirmDelete")}</span>
                        <button type="button" className="btn sm secondary" onClick={() => setConfirmDelete(false)}>
                            {t("notes.edit.cancel")}
                        </button>
                        <button type="button" className="btn sm danger" onClick={() => onDelete(note)}>
                            <i className="ri-delete-bin-line" aria-hidden="true" />
                            <span className="txt">{t("notes.delete")}</span>
                        </button>
                    </>
                ) : (
                    <>
                        <button type="button" className="btn sm secondary transparent" onClick={() => onPinChange(note, !note.pinned)}>
                            <i className={note.pinned ? "ri-unpin-line" : "ri-pushpin-line"} aria-hidden="true" />
                            <span className="txt">{t(note.pinned ? "notes.unpin" : "notes.pin")}</span>
                        </button>
                        <button type="button" className="btn sm secondary transparent" onClick={onEdit}>
                            <i className="ri-edit-line" aria-hidden="true" />
                            <span className="txt">{t("notes.editAction")}</span>
                        </button>
                        <button type="button" className="btn sm secondary transparent" onClick={() => setConfirmDelete(true)}>
                            <i className="ri-delete-bin-line" aria-hidden="true" />
                            <span className="txt">{t("notes.delete")}</span>
                        </button>
                    </>
                )}
            </footer>
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

    const idSuffix = note ? note.id : "new";

    return (
        <form className="post note-form" onSubmit={onSubmit}>
            <h2 className="post-title">{t(note ? "notes.edit.heading" : "notes.new.heading")}</h2>
            <div className="grid sm">
                <FormField id={`note-title-${idSuffix}`} label={t("notes.new.title")} required>
                    <input
                        id={`note-title-${idSuffix}`}
                        type="text"
                        value={title}
                        disabled={busy}
                        autoFocus
                        onChange={(event) => setTitle(event.target.value)}
                    />
                </FormField>
                <FormField id={`note-body-${idSuffix}`} label={t("notes.new.body")} required hint={t("notes.hint")}>
                    <textarea
                        id={`note-body-${idSuffix}`}
                        className="note-textarea"
                        rows={8}
                        value={body}
                        disabled={busy}
                        onChange={(event) => setBody(event.target.value)}
                    />
                </FormField>
                {error && (
                    <div className="col-12">
                        <div className="alert danger">{error}</div>
                    </div>
                )}
                <div className="col-12">
                    <footer className="form-footer">
                        {onCancel && (
                            <button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>
                                {t("notes.edit.cancel")}
                            </button>
                        )}
                        <button type="submit" className={`btn ${busy ? "loading" : ""}`} disabled={busy}>
                            <span className="txt">{t(note ? "notes.edit.submit" : "notes.new.submit")}</span>
                        </button>
                    </footer>
                </div>
            </div>
        </form>
    );
}
