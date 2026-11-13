import { useTranslation } from "react-i18next";

import { PageHeading, Wrapper } from "./Page";

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
        <Wrapper>
            <PageHeading title={t(`${prefix}.title`)} />
            <div className="alert warning m-b-sm" role="note">
                {t("legal.draftNotice")}
            </div>
            {i18n.language === "en" && t("legal.englishNote") && (
                <div className="alert info m-b-sm">{t("legal.englishNote")}</div>
            )}
            <article className="post legal-text markdown-preview">
                {blocks.map((block) => (
                    <section className="legal-section" key={block.heading}>
                        <h2>{block.heading}</h2>
                        {block.paragraphs.map((paragraph, index) => (
                            <p key={index}>{paragraph}</p>
                        ))}
                    </section>
                ))}
            </article>
        </Wrapper>
    );
}
