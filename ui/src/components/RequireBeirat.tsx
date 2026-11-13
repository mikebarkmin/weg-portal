import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { canShow, useAuth } from "../lib/auth";

// Route guard for the Beirat-only pages. The nav already hides the
// links for other roles; the server rules protect the data anyway -
// this guard just avoids rendering the page for a direct URL entry.
export default function RequireBeirat({ children }: { children: React.ReactNode }) {
    const { role } = useAuth();
    const { t } = useTranslation();

    if (!canShow(role)) {
        return (
            <section className="card state">
                <h1>{t("auth.forbidden.title")}</h1>
                <p>{t("auth.forbidden.text")}</p>
                <Link className="btn btn-outline" to="/">
                    {t("auth.forbidden.back")}
                </Link>
            </section>
        );
    }

    return <>{children}</>;
}
