import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ClientResponseError } from "pocketbase";

import { pb } from "../lib/pbClient";
import { canShow, useAuth } from "../lib/auth";
import { renderMarkdown } from "../lib/markdown";
import { formatLongDate } from "../lib/dates";
import { parsePBDate } from "../lib/recurrence";
import { serverMessage } from "../lib/pbErrors";
import type { PortalAnnouncement, Visibility } from "../types";
import { Page, PageHeading, SidebarMenu } from "../components/Page";
import FormField, { SwitchField } from "../components/FormField";
import VisibilityLabel from "../components/VisibilityLabel";

function isExpired(a: PortalAnnouncement): boolean {
    const expires = parsePBDate(a.expires_at);
    return !!expires && expires.getTime() < Date.now();
}

// Aushänge: written by the Beirat, public or for owners only, optionally
// pinned or with an expiry date. Opted-in owners get them by mail.
export default function Announcements() {
    const { t, i18n } = useTranslation();
    const locale = i18n.language;
    const auth = useAuth();
    const isBeirat = canShow(auth.role);
    const location = useLocation();
    const [params, setParams] = useSearchParams();

    const [items, setItems] = useState<PortalAnnouncement[] | null>(null);
    const [error, setError] = useState(false);
    const [creating, setCreating] = useState(params.get("new") === "1");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [showExpired, setShowExpired] = useState(false);

    const load = () =>
        pb.collection<PortalAnnouncement>("announcements")
            .getFullList({ sort: "-pinned,-created", expand: "author" })
            .then((list) => {
                setItems(list);
                setError(false);
            })
            .catch(() => setError(true));

    useEffect(() => {
        void load();
    }, [auth.isAuthenticated, auth.role]);

    // deep links from the start page and the mails (#<id>)
    useEffect(() => {
        if (!items || !location.hash) return;
        document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" });
    }, [items, location.hash]);

    const visible = (items ?? []).filter((a) => showExpired || !isExpired(a));
    const expiredCount = (items ?? []).filter(isExpired).length;

    const closeCreate = () => {
        setCreating(false);
        if (params.get("new")) setParams({}, { replace: true });
    };

    return (
        <Page
            sidebar={
                <>
                    {isBeirat && (
                        <SidebarMenu title={t("announcements.heading")}>
                            <button type="button" className="menu-item" onClick={() => setCreating(true)}>
                                <i className="ri-add-line" aria-hidden="true" />
                                <span className="txt">{t("announcements.new")}</span>
                            </button>
                            {expiredCount > 0 && (
                                <button type="button" className="menu-item" onClick={() => setShowExpired((v) => !v)}>
                                    <i className="ri-history-line" aria-hidden="true" />
                                    <span className="txt">
                                        {showExpired ? t("announcements.hideExpired") : t("announcements.showExpired", { count: expiredCount })}
                                    </span>
                                </button>
                            )}
                        </SidebarMenu>
                    )}
                    <p className="txt-hint sidebar-text">
                        {auth.isAuthenticated ? t("announcements.introOwner") : t("announcements.introGuest")}
                    </p>
                </>
            }
        >
            <PageHeading title={t("announcements.heading")}>
                {isBeirat && !creating && (
                    <button type="button" className="btn sm" onClick={() => setCreating(true)}>
                        <i className="ri-add-line" aria-hidden="true" />
                        <span className="txt">{t("announcements.new")}</span>
                    </button>
                )}
            </PageHeading>

            <div className="flex-column gap-sm">
                {creating && (
                    <AnnouncementForm
                        onSaved={() => {
                            closeCreate();
                            void load();
                        }}
                        onCancel={closeCreate}
                    />
                )}
                {error && <div className="alert danger">{t("announcements.loadError")}</div>}
                {items === null && !error && <p className="txt-hint">{t("calendar.loading")}</p>}
                {items !== null && visible.length === 0 && !creating && (
                    <div className="alert">{t("announcements.empty")}</div>
                )}

                {visible.map((a) =>
                    editingId === a.id ? (
                        <AnnouncementForm
                            key={a.id}
                            announcement={a}
                            onSaved={() => {
                                setEditingId(null);
                                void load();
                            }}
                            onCancel={() => setEditingId(null)}
                        />
                    ) : (
                        <AnnouncementPost
                            key={a.id}
                            announcement={a}
                            locale={locale}
                            canEdit={isBeirat}
                            showVisibility={auth.isAuthenticated}
                            onEdit={() => setEditingId(a.id)}
                            onDeleted={() => void load()}
                        />
                    ),
                )}
            </div>
        </Page>
    );
}

function AnnouncementPost({
    announcement: a,
    locale,
    canEdit,
    showVisibility,
    onEdit,
    onDeleted,
}: {
    announcement: PortalAnnouncement;
    locale: string;
    canEdit: boolean;
    showVisibility: boolean;
    onEdit: () => void;
    onDeleted: () => void;
}) {
    const { t } = useTranslation();
    const [confirmDelete, setConfirmDelete] = useState(false);
    const created = parsePBDate(a.created);
    const expires = parsePBDate(a.expires_at);
    const expired = isExpired(a);

    const remove = async () => {
        try {
            await pb.collection("announcements").delete(a.id);
            onDeleted();
        } catch {
            setConfirmDelete(false);
        }
    };

    return (
        <article id={a.id} className={`post announcement ${a.pinned ? "pinned" : ""} ${expired ? "expired" : ""}`}>
            <header className="announcement-head">
                <h2 className="post-title">{a.title}</h2>
                <span className="meta">
                    {a.pinned && (
                        <span className="label sm warning">
                            <i className="ri-pushpin-line" aria-hidden="true" />
                            {t("announcements.pinned")}
                        </span>
                    )}
                    {showVisibility && <VisibilityLabel visibility={a.visibility} />}
                    {created && (
                        <span className="meta-item">
                            <i className="ri-time-line" aria-hidden="true" />
                            {formatLongDate(created, locale)}
                        </span>
                    )}
                    {a.expand?.author?.name && (
                        <span className="meta-item">
                            <i className="ri-user-line" aria-hidden="true" />
                            {a.expand.author.name}
                        </span>
                    )}
                    {expires && (
                        <span className={`meta-item ${expired ? "txt-danger" : ""}`}>
                            <i className="ri-calendar-close-line" aria-hidden="true" />
                            {t(expired ? "announcements.expiredOn" : "announcements.expiresOn", {
                                date: formatLongDate(expires, locale),
                            })}
                        </span>
                    )}
                </span>
            </header>
            <div className="content markdown-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(a.body) }} />
            {canEdit && (
                <footer className="post-footer note-actions">
                    {confirmDelete ? (
                        <>
                            <span className="txt-hint txt-sm">{t("announcements.confirmDelete")}</span>
                            <button type="button" className="btn sm secondary" onClick={() => setConfirmDelete(false)}>
                                {t("eventEditor.cancel")}
                            </button>
                            <button type="button" className="btn sm danger" onClick={() => void remove()}>
                                <i className="ri-delete-bin-line" aria-hidden="true" />
                                <span className="txt">{t("notes.delete")}</span>
                            </button>
                        </>
                    ) : (
                        <>
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
            )}
        </article>
    );
}

function AnnouncementForm({
    announcement,
    onSaved,
    onCancel,
}: {
    announcement?: PortalAnnouncement;
    onSaved: () => void;
    onCancel: () => void;
}) {
    const { t } = useTranslation();
    const [title, setTitle] = useState(announcement?.title ?? "");
    const [body, setBody] = useState(announcement?.body ?? "");
    const [visibility, setVisibility] = useState<Visibility>(announcement?.visibility ?? "public");
    const [pinned, setPinned] = useState(announcement?.pinned ?? false);
    const [expires, setExpires] = useState(announcement?.expires_at ? announcement.expires_at.slice(0, 10) : "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const suffix = announcement?.id ?? "new";

    const submit = async (e: { preventDefault(): void }) => {
        e.preventDefault();
        if (!title.trim() || !body.trim()) {
            setError(t("validation.required"));
            return;
        }
        setBusy(true);
        setError(null);
        const payload = {
            title: title.trim(),
            body: body.trim(),
            visibility,
            pinned,
            // hidden from the end of the chosen day on
            expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : "",
        };
        try {
            if (announcement) {
                await pb.collection("announcements").update(announcement.id, payload);
            } else {
                await pb.collection("announcements").create({ ...payload, author: pb.authStore.record?.id });
            }
            onSaved();
        } catch (err) {
            setError(
                t("announcements.saveError") + (err instanceof ClientResponseError ? ` (${serverMessage(err)})` : ""),
            );
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="post" onSubmit={submit} noValidate>
            <h2 className="post-title">{announcement ? t("announcements.edit") : t("announcements.new")}</h2>
            <div className="grid sm">
                <FormField id={`ann-title-${suffix}`} label={t("suggestion.title")} required>
                    <input id={`ann-title-${suffix}`} type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
                </FormField>
                <FormField id={`ann-body-${suffix}`} label={t("announcements.body")} required hint={t("notes.hint")}>
                    <textarea id={`ann-body-${suffix}`} rows={6} maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} />
                </FormField>
                <FormField id={`ann-visibility-${suffix}`} className="col-12 col-md-6" label={t("visibility.label")} hint={t(`visibility.${visibility}Hint`)}>
                    <select id={`ann-visibility-${suffix}`} value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
                        <option value="public">{t("visibility.public")}</option>
                        <option value="owners">{t("visibility.owners")}</option>
                    </select>
                </FormField>
                <FormField id={`ann-expires-${suffix}`} className="col-12 col-md-6" label={t("announcements.expires")} hint={t("announcements.expiresHint")}>
                    <input id={`ann-expires-${suffix}`} type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
                </FormField>
                <SwitchField id={`ann-pinned-${suffix}`} label={t("announcements.pinOnTop")} checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
                {!announcement && (
                    <div className="col-12">
                        <div className="field-help">{t("announcements.mailHint")}</div>
                    </div>
                )}
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
                            <span className="txt">{announcement ? t("eventEditor.save") : t("announcements.publish")}</span>
                        </button>
                    </footer>
                </div>
            </div>
        </form>
    );
}
