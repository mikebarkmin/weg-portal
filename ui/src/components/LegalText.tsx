import { useTranslation } from "react-i18next";

// Shared renderer for the two legal pages (M12). The legal TEXT lives
// in the locale files (de.json); en.json carries the same German text
// (legal texts are single-language) plus an English preface note that
// is rendered only for the en locale. The paragraphs are plain strings
// from the locale files - no markdown, no dangerouslySetInnerHTML.

interface LegalBlock {
    heading: string;
    paragraphs: string[];
}

export default function LegalText({ prefix }: { prefix: string }) {
    const { t, i18n } = useTranslation();
    const blocks = t(`${prefix}.blocks`, { returnObjects: true }) as unknown as LegalBlock[];

    return (
        <article className="card legal-text">
            <p className="legal-draft" role="note">
                {t("legal.draftNotice")}
            </p>
            {i18n.language === "en" && (
                <p className="legal-english-note">{t("legal.englishNote")}</p>
            )}
            <h1>{t(`${prefix}.title`)}</h1>
            {blocks.map((block) => (
                <section className="legal-section" key={block.heading}>
                    <h2>{block.heading}</h2>
                    {block.paragraphs.map((paragraph, index) => (
                        <p key={index}>{paragraph}</p>
                    ))}
                </section>
            ))}
        </article>
    );
}
