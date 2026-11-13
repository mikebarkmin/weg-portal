import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { pb } from "../lib/pbClient";
import { canShow, useAuth } from "../lib/auth";
import { renderMarkdown } from "../lib/markdown";
import { formatLongDate } from "../lib/dates";
import { parsePBDate } from "../lib/recurrence";
import { fillPlaceholders, type LegalPage, type LegalSlug } from "../lib/legal";
import { PageHeading, Wrapper } from "./Page";

// Public legal page (Impressum, Datenschutz). The text is maintained by the
// Beirat in the portal ("Rechtstexte"); it is German only.
export default function LegalText({ slug }: { slug: LegalSlug }) {
    const { t, i18n } = useTranslation();
    const auth = useAuth();
    const [page, setPage] = useState<LegalPage | null>(null);
    const [retention, setRetention] = useState<Record<string, number> | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        let active = true;
        pb.collection<LegalPage>("legal_pages")
            .getFirstListItem(pb.filter("slug = {:slug}", { slug }))
            .then((record) => active && setPage(record))
            .catch(() => active && setError(true));
        pb.send<Record<string, number>>("/api/portal/retention", {})
            .then((values) => active && setRetention(values))
            .catch(() => active && setRetention(null));
        return () => {
            active = false;
        };
    }, [slug]);

    const updated = page ? parsePBDate(page.updated) : null;

    return (
        <Wrapper>
            <PageHeading title={t(`legal.footer.${slug}`)}>
                {canShow(auth.role) && (
                    <Link className="btn sm secondary" to={`/rechtstexte?seite=${slug}`}>
                        <i className="ri-edit-line" aria-hidden="true" />
                        <span className="txt">{t("legal.edit")}</span>
                    </Link>
                )}
            </PageHeading>
            {page?.draft && (
                <div className="alert warning m-b-sm" role="note">
                    {t("legal.draftNotice")}
                </div>
            )}
            {i18n.language === "en" && <div className="alert info m-b-sm">{t("legal.englishNote")}</div>}
            {error && <div className="alert danger">{t("legal.loadError")}</div>}
            {!page && !error && <p className="txt-hint">{t("calendar.loading")}</p>}
            {page && (
                <article className="post legal-text">
                    <div
                        className="markdown-preview"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(fillPlaceholders(page.body, retention)) }}
                    />
                    {updated && (
                        <p className="txt-hint txt-sm m-0">
                            {t("legal.updatedOn", { date: formatLongDate(updated, i18n.language) })}
                        </p>
                    )}
                </article>
            )}
        </Wrapper>
    );
}
