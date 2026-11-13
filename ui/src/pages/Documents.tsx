import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClientResponseError } from "pocketbase";

import { pb } from "../lib/pbClient";
import { canShow, useAuth } from "../lib/auth";
import { serverMessage } from "../lib/pbErrors";
import { buildFileUrl } from "../lib/fileToken";
import { useFileToken } from "../lib/useFileToken";
import { formatLongDate } from "../lib/dates";
import { parsePBDate } from "../lib/recurrence";
import type { DocumentCategory, PortalDocument, Visibility } from "../types";
import { MenuButton, Page, PageHeading, SidebarMenu } from "../components/Page";
import FormField from "../components/FormField";
import VisibilityLabel from "../components/VisibilityLabel";

const CATEGORIES: DocumentCategory[] = [
    "hausordnung",
    "protokoll",
    "beschluss",
    "wirtschaftsplan",
    "abrechnung",
    "vertrag",
    "sonstiges",
];

const ACCEPT =
    "application/pdf,image/jpeg,image/png,image/webp,.docx,.xlsx,.odt,.ods";

function fileIcon(name: string): string {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "pdf") return "ri-file-pdf-2-line";
    if (["jpg", "jpeg", "png", "webp"].includes(ext)) return "ri-image-line";
    if (["docx", "odt"].includes(ext)) return "ri-file-word-2-line";
    if (["xlsx", "ods"].includes(ext)) return "ri-file-excel-2-line";
    return "ri-file-3-line";
}

// Document library: Hausordnung (public), minutes, resolutions, budget
// plans ... (owners only). Files are protected: owner documents need a
// file token, public ones open without an account. The legally binding
// Beschluss-Sammlung (§ 24 WEG) stays with the Verwaltung; copies here
// are for convenience.
export default function Documents() {
    const { t, i18n } = useTranslation();
    const locale = i18n.language;
    const auth = useAuth();
    const isBeirat = canShow(auth.role);

    const [items, setItems] = useState<PortalDocument[] | null>(null);
    const [error, setError] = useState(false);
    const [category, setCategory] = useState<DocumentCategory | "all">("all");
    const [uploading, setUploading] = useState(false);
    const { token, onError } = useFileToken(auth.isAuthenticated);

    const load = useCallback(() => {
        pb.collection<PortalDocument>("documents")
            .getFullList({ sort: "-document_date,-created" })
            .then((list) => {
                setItems(list);
                setError(false);
            })
            .catch(() => setError(true));
    }, []);

    useEffect(() => {
        load();
    }, [load, auth.isAuthenticated, auth.role]);

    const counts = useMemo(() => {
        const result: Record<string, number> = { all: items?.length ?? 0 };
        for (const doc of items ?? []) result[doc.category] = (result[doc.category] ?? 0) + 1;
        return result;
    }, [items]);

    const visible = (items ?? []).filter((d) => category === "all" || d.category === category);

    const remove = async (doc: PortalDocument) => {
        await pb.collection("documents").delete(doc.id).catch(() => undefined);
        load();
    };

    return (
        <Page
            sidebar={
                <>
                    <SidebarMenu title={t("documents.categories")}>
                        <MenuButton icon="ri-folder-3-line" active={category === "all"} count={counts.all} onClick={() => setCategory("all")}>
                            {t("documents.all")}
                        </MenuButton>
                        {CATEGORIES.filter((c) => (counts[c] ?? 0) > 0).map((c) => (
                            <MenuButton key={c} icon="ri-folder-line" active={category === c} count={counts[c]} onClick={() => setCategory(c)}>
                                {t(`documents.category.${c}`)}
                            </MenuButton>
                        ))}
                    </SidebarMenu>
                    <p className="txt-hint sidebar-text">
                        {auth.isAuthenticated ? t("documents.introOwner") : t("documents.introGuest")}
                    </p>
                </>
            }
        >
            <PageHeading title={t("documents.heading")}>
                {isBeirat && !uploading && (
                    <button type="button" className="btn sm" onClick={() => setUploading(true)}>
                        <i className="ri-upload-2-line" aria-hidden="true" />
                        <span className="txt">{t("documents.upload")}</span>
                    </button>
                )}
            </PageHeading>

            <div className="flex-column gap-sm">
                {uploading && (
                    <DocumentForm
                        onSaved={() => {
                            setUploading(false);
                            load();
                        }}
                        onCancel={() => setUploading(false)}
                    />
                )}
                {error && <div className="alert danger">{t("documents.loadError")}</div>}
                {items === null && !error && <p className="txt-hint">{t("calendar.loading")}</p>}
                {items !== null && visible.length === 0 && <div className="alert">{t("documents.empty")}</div>}

                {visible.length > 0 && (
                    <div className="list document-list">
                        {visible.map((doc) => {
                            const date = parsePBDate(doc.document_date) ?? parsePBDate(doc.created);
                            const url = buildFileUrl(pb.baseUrl, "documents", doc.id, doc.file, {
                                token: token ?? undefined,
                            });
                            return (
                                <div key={doc.id} className="list-item document-row">
                                    <span className="document-icon" aria-hidden="true">
                                        <i className={fileIcon(doc.file)} />
                                    </span>
                                    <span className="content">
                                        <a className="document-title" href={url} target="_blank" rel="noopener" onError={() => onError(doc.file)}>
                                            {doc.title}
                                        </a>
                                        <span className="meta">
                                            <span className="label sm">{t(`documents.category.${doc.category}`)}</span>
                                            {auth.isAuthenticated && <VisibilityLabel visibility={doc.visibility} />}
                                            {date && (
                                                <span className="meta-item">
                                                    <i className="ri-calendar-line" aria-hidden="true" />
                                                    {formatLongDate(date, locale)}
                                                </span>
                                            )}
                                        </span>
                                        {doc.description && <span className="txt-hint txt-sm">{doc.description}</span>}
                                    </span>
                                    <span className="ctrls">
                                        <a className="btn sm secondary" href={url} target="_blank" rel="noopener">
                                            <i className="ri-download-2-line" aria-hidden="true" />
                                            <span className="txt">{t("documents.open")}</span>
                                        </a>
                                        {isBeirat && <DeleteButton onConfirm={() => void remove(doc)} />}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </Page>
    );
}

function DeleteButton({ onConfirm }: { onConfirm: () => void }) {
    const { t } = useTranslation();
    const [confirm, setConfirm] = useState(false);
    return confirm ? (
        <>
            <button type="button" className="btn sm secondary" onClick={() => setConfirm(false)}>
                {t("eventEditor.cancel")}
            </button>
            <button type="button" className="btn sm danger" onClick={onConfirm}>
                {t("notes.delete")}
            </button>
        </>
    ) : (
        <button type="button" className="btn sm secondary transparent" aria-label={t("notes.delete")} onClick={() => setConfirm(true)}>
            <i className="ri-delete-bin-line" aria-hidden="true" />
        </button>
    );
}

function DocumentForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
    const { t } = useTranslation();
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [category, setCategory] = useState<DocumentCategory>("protokoll");
    const [visibility, setVisibility] = useState<Visibility>("owners");
    const [date, setDate] = useState("");
    const [file, setFile] = useState<File | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: { preventDefault(): void }) => {
        e.preventDefault();
        if (!title.trim() || !file) {
            setError(t("documents.missing"));
            return;
        }
        setBusy(true);
        setError(null);
        const data = new FormData();
        data.set("title", title.trim());
        data.set("description", description.trim());
        data.set("category", category);
        data.set("visibility", visibility);
        if (date) data.set("document_date", `${date} 00:00:00.000Z`);
        data.set("file", file);
        try {
            await pb.collection("documents").create(data);
            onSaved();
        } catch (err) {
            setError(t("documents.saveError") + (err instanceof ClientResponseError ? ` (${serverMessage(err)})` : ""));
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="post" onSubmit={submit} noValidate>
            <h2 className="post-title">{t("documents.upload")}</h2>
            <div className="grid sm">
                <FormField id="doc-title" label={t("suggestion.title")} required>
                    <input id="doc-title" type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
                </FormField>
                <FormField id="doc-description" label={t("suggestion.description")}>
                    <textarea id="doc-description" rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
                </FormField>
                <FormField id="doc-category" className="col-12 col-md-6" label={t("documents.categoryLabel")}>
                    <select id="doc-category" value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)}>
                        {CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                                {t(`documents.category.${c}`)}
                            </option>
                        ))}
                    </select>
                </FormField>
                <FormField id="doc-visibility" className="col-12 col-md-6" label={t("visibility.label")} hint={t(`visibility.${visibility}Hint`)}>
                    <select id="doc-visibility" value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
                        <option value="owners">{t("visibility.owners")}</option>
                        <option value="public">{t("visibility.public")}</option>
                    </select>
                </FormField>
                <FormField id="doc-date" className="col-12 col-md-6" label={t("documents.date")}>
                    <input id="doc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </FormField>
                <FormField id="doc-file" className="col-12 col-md-6" label={t("documents.file")} required hint={t("documents.fileHint")}>
                    <input id="doc-file" type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
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
                            <i className="ri-upload-2-line" aria-hidden="true" />
                            <span className="txt">{t("documents.uploadSubmit")}</span>
                        </button>
                    </footer>
                </div>
            </div>
        </form>
    );
}
