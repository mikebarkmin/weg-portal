import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Wrapper } from "./Page";
import Notice from "./Notice";

import { boardAccessOf, useAuth } from "../lib/auth";
import { pb } from "../lib/pbClient";

// Route guard for the issue board pages (M9). Three groups are kept away
// from the board content with an explanatory page:
//   - guests (login required),
//   - residents whose email is not confirmed yet,
//   - residents waiting for the Beirat's approval.
// beirat/hausmeister/hausverwaltung are exempt (boardAccessOf). The server
// rules remain authoritative - this only avoids rendering board content
// that the API would refuse anyway.
export default function RequireBoardAccess({ children }: { children: React.ReactNode }) {
    const { t } = useTranslation();
    const auth = useAuth();

    // The approval flags live on the auth record, not on the token. The
    // store copy goes stale when the Beirat flips a flag server-side
    // (approval, moved-out revocation) mid-session, so the guard
    // re-validates on every auth store change (the gate then follows
    // authRefresh performed anywhere - this page, ProfileSettings, ...)
    // and refreshes the stored record once per mount: a revoked resident
    // landing on /issues afterwards sees the waiting page instead of an
    // empty board (the rules already filtered the data away).
    const [record, setRecord] = useState<Record<string, unknown> | null>(() =>
        pb.authStore.record as Record<string, unknown> | null,
    );
    useEffect(() => {
        const unsubscribe = pb.authStore.onChange(() =>
            setRecord(pb.authStore.record as Record<string, unknown> | null),
        );
        return () => unsubscribe();
    }, []);
    useEffect(() => {
        if (!auth.isAuthenticated) return;
        pb.collection("users")
            .authRefresh()
            .catch(() => {
                // keep the stored snapshot; the server still refuses
                // everything it must refuse (rules read the DB)
            });
    }, [auth.isAuthenticated]);

    if (!auth.isAuthenticated) {
        return (
            <Wrapper size="sm">
                <Notice
                    icon="ri-lock-line"
                    title={t("gate.anonymous.title")}
                    actions={
                        <>
                            <Link className="btn secondary" to="/signup">
                                {t("gate.anonymous.signup")}
                            </Link>
                            <Link className="btn" to="/login">
                                {t("gate.anonymous.login")}
                            </Link>
                        </>
                    }
                >
                    <p>{t("gate.anonymous.text")}</p>
                </Notice>
            </Wrapper>
        );
    }

    const access = boardAccessOf(record);
    if (access === "unverified") {
        return (
            <Wrapper size="sm">
                <Notice
                    icon="ri-mail-unread-line"
                    tone="warning"
                    title={t("gate.unverified.title")}
                    actions={
                        <Link className="btn secondary" to="/profile">
                            {t("gate.unverified.profile")}
                        </Link>
                    }
                >
                    <p>{t("gate.unverified.text")}</p>
                </Notice>
            </Wrapper>
        );
    }
    if (access === "waiting") {
        return (
            <Wrapper size="sm">
                <Notice
                    icon="ri-hourglass-line"
                    title={t("gate.waiting.title")}
                    actions={
                        <Link className="btn secondary" to="/profile">
                            {t("gate.waiting.profile")}
                        </Link>
                    }
                >
                    <p>{t("gate.waiting.text")}</p>
                </Notice>
            </Wrapper>
        );
    }

    return <>{children}</>;
}
