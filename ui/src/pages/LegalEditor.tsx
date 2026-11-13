import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ClientResponseError } from "pocketbase";

import { pb } from "../lib/pbClient";
import { renderMarkdown } from "../lib/markdown";
import { formatLongDate, formatTime } from "../lib/dates";
import { parsePBDate } from "../lib/recurrence";
import { serverMessage } from "../lib/pbErrors";
import { fillPlaceholders, RETENTION_PLACEHOLDERS, type LegalPage, type LegalSlug } from "../lib/legal";
import { MenuButton, Page, PageHeading, SidebarMenu } from "../components/Page";
import FormField, { SwitchField } from "../components/FormField";

const SLUGS: LegalSlug[] = ["impressum", "datenschutz"];

// Beirat area "Rechtstexte": edit Impressum and Datenschutz (Markdown) with
// a preview. The Beirat (WEG) is responsible for these texts; until they
// are released, the public pages show the draft notice.
export default function LegalEditor() {
    const { t } = useTranslation();
    const [params, setParams] = useSearchParams();
    const slug: LegalSlug = params.get("seite") === "datenschutz" ? "datenschutz" : "impressum";

    return (
        <Page
            sidebar={
                <>
                    <SidebarMenu title={t("legal.editorHeading")}>
                        {SLUGS.map((s) => (
                            <MenuButton
                                key={s}
                                icon={s === "impressum" ? "ri-building-line" : "ri-shield-keyhole-line"}
                                active={slug === s}
                                onClick={() => setParams({ seite: s })}
                            >
                                {t(`legal.footer.${s}`)}
                            </MenuButton>
                        ))}
                    </SidebarMenu>
                    <p className="txt-hint sidebar-text">{t("legal.editorIntro")}</p>
                </>
            }
        >
            <LegalPageEditor key={slug} slug={slug} />
        </Page>
    );
}

function LegalPageEditor({ slug }: { slug: LegalSlug }) {
    const { t, i18n } = useTranslation();
    const locale = i18n.language;
    const [page, setPage] = useState<LegalPage | null>(null);
    const [retention, setRetention] = useState<Record<string, number> | null>(null);
    const [body, setBody] = useState("");
    const [draft, setDraft] = useState(true);
    const [preview, setPreview] = useState(false);
    const [busy, setBusy] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        pb.collection<LegalPage>("legal_pages")
            .getFirstListItem(pb.filter("slug = {:slug}", { slug }), { expand: "updated_by" })
            .then((record) => {
                if (!active) return;
                setPage(record);
                setBody(record.body);
                setDraft(record.draft);
            })
            .catch(() => active && setError(t("legal.loadError")));
        pb.send<Record<string, number>>("/api/portal/retention", {})
            .then((values) => active && setRetention(values))
            .catch(() => undefined);
        return () => {
            active = false;
        };
    }, [slug, t]);

    const dirty = page !== null && (body !== page.body || draft !== page.draft);

    const save = async (e: { preventDefault(): void }) => {
        e.preventDefault();
        if (!page) return;
        setBusy(true);
        setSaved(false);
        setError(null);
        try {
            const updated = await pb
                .collection<LegalPage>("legal_pages")
                .update(page.id, { body, draft }, { expand: "updated_by" });
            setPage(updated);
            setSaved(true);
        } catch (err) {
            setError(t("legal.saveError") + (err instanceof ClientResponseError ? ` (${serverMessage(err)})` : ""));
        } finally {
            setBusy(false);
        }
    };

    const updated = page ? parsePBDate(page.updated) : null;

    return (
        <>
            <PageHeading title={t(`legal.footer.${slug}`)}>
                <Link className="btn sm secondary transparent" to={`/${slug}`}>
                    <i className="ri-external-link-line" aria-hidden="true" />
                    <span className="txt">{t("legal.viewPublic")}</span>
                </Link>
            </PageHeading>

            {!page && !error && <p className="txt-hint">{t("calendar.loading")}</p>}

            {page && (
                <form className="post" onSubmit={save}>
                    <div className="tabs-header">
                        <button type="button" className={`tab-item ${!preview ? "active" : ""}`} onClick={() => setPreview(false)}>
                            <i className="ri-edit-line" aria-hidden="true" /> {t("legal.tabEdit")}
                        </button>
                        <button type="button" className={`tab-item ${preview ? "active" : ""}`} onClick={() => setPreview(true)}>
                            <i className="ri-eye-line" aria-hidden="true" /> {t("legal.tabPreview")}
                        </button>
                    </div>

                    {preview ? (
                        <div
                            className="markdown-preview legal-text legal-preview"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(fillPlaceholders(body, retention)) }}
                        />
                    ) : (
                        <div className="grid sm">
                            <FormField
                                id={`legal-body-${slug}`}
                                label={t("legal.body")}
                                hint={
                                    <>
                                        {t("legal.markdownHint")}
                                        {slug === "datenschutz" && (
                                            <>
                                                {" "}
                                                {t("legal.placeholderHint")}{" "}
                                                {RETENTION_PLACEHOLDERS.map((p) => (
                                                    <code key={p} className="legal-placeholder">{`{{${p}}}`}</code>
                                                ))}
                                            </>
                                        )}
                                    </>
                                }
                            >
                                <textarea
                                    id={`legal-body-${slug}`}
                                    className="note-textarea legal-textarea"
                                    rows={22}
                                    maxLength={100000}
                                    value={body}
                                    onChange={(e) => setBody(e.target.value)}
                                />
                            </FormField>
                        </div>
                    )}

                    <div className="grid sm">
                        <SwitchField
                            id={`legal-draft-${slug}`}
                            label={t("legal.draftSwitch")}
                            hint={t("legal.draftSwitchHint")}
                            checked={draft}
                            onChange={(e) => setDraft(e.target.checked)}
                        />
                        {error && (
                            <div className="col-12">
                                <div className="alert danger">{error}</div>
                            </div>
                        )}
                        {saved && !dirty && (
                            <div className="col-12">
                                <div className="alert success">{t("legal.saved")}</div>
                            </div>
                        )}
                        <div className="col-12">
                            <footer className="form-footer">
                                {updated && (
                                    <span className="txt-hint txt-sm delete-hint">
                                        {t("legal.lastChange", {
                                            date: `${formatLongDate(updated, locale)}, ${formatTime(updated, locale)}`,
                                            name: page.expand?.updated_by?.name || t("legal.initialDraft"),
                                        })}
                                    </span>
                                )}
                                <button type="submit" className={`btn ${busy ? "loading" : ""}`} disabled={busy || !dirty}>
                                    <span className="txt">{t("eventEditor.save")}</span>
                                </button>
                            </footer>
                        </div>
                    </div>
                </form>
            )}
        </>
    );
}
