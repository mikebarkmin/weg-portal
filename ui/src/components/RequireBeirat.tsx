import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Wrapper } from "./Page";
import Notice from "./Notice";

import { canShow, useAuth } from "../lib/auth";

// Route guard for the Beirat-only pages. The nav already hides the
// links for other roles; the server rules protect the data anyway -
// this guard just avoids rendering the page for a direct URL entry.
export default function RequireBeirat({ children }: { children: React.ReactNode }) {
    const { role } = useAuth();
    const { t } = useTranslation();

    if (!canShow(role)) {
        return (
            <Wrapper size="sm">
                <Notice
                    icon="ri-shield-user-line"
                    title={t("auth.forbidden.title")}
                    actions={
                        <Link className="btn secondary" to="/">
                            {t("auth.forbidden.back")}
                        </Link>
                    }
                >
                    <p>{t("auth.forbidden.text")}</p>
                </Notice>
            </Wrapper>
        );
    }

    return <>{children}</>;
}
