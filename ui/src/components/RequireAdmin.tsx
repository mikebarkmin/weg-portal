import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Wrapper } from "./Page";
import Notice from "./Notice";

import { canShowAdmin, useAuth } from "../lib/auth";

// Route guard for the admin-only account management page. The nav hides
// the link for other roles and the admin routes enforce the role
// server-side (hooks/adminUsers.go); this guard only avoids rendering
// the page for a direct URL entry.
export default function RequireAdmin({ children }: { children: React.ReactNode }) {
    const { role } = useAuth();
    const { t } = useTranslation();

    if (!canShowAdmin(role)) {
        return (
            <Wrapper size="sm">
                <Notice
                    icon="ri-admin-line"
                    title={t("auth.forbiddenAdmin.title")}
                    actions={
                        <Link className="btn secondary" to="/">
                            {t("auth.forbiddenAdmin.back")}
                        </Link>
                    }
                >
                    <p>{t("auth.forbiddenAdmin.text")}</p>
                </Notice>
            </Wrapper>
        );
    }

    return <>{children}</>;
}
