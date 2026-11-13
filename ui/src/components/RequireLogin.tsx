import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useAuth } from "../lib/auth";
import { Wrapper } from "./Page";
import Notice from "./Notice";

// Pages that only need a login (profile, my submissions) - also for
// accounts still waiting for approval.
export default function RequireLogin({ children }: { children: React.ReactNode }) {
    const { t } = useTranslation();
    const auth = useAuth();
    if (auth.isAuthenticated) return <>{children}</>;
    return (
        <Wrapper size="sm">
            <Notice
                icon="ri-lock-line"
                title={t("gate.login.title")}
                actions={
                    <Link className="btn" to="/login">
                        {t("gate.anonymous.login")}
                    </Link>
                }
            >
                <p>{t("gate.login.text")}</p>
            </Notice>
        </Wrapper>
    );
}
