import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

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
            <section className="card state">
                <h1>{t("gate.anonymous.title")}</h1>
                <p>{t("gate.anonymous.text")}</p>
                <div className="btn-row">
                    <Link className="btn" to="/login">
                        {t("gate.anonymous.login")}
                    </Link>
                    <Link className="btn btn-outline" to="/signup">
                        {t("gate.anonymous.signup")}
                    </Link>
                </div>
            </section>
        );
    }

    const access = boardAccessOf(record);
    if (access === "unverified") {
        return (
            <section className="card state">
                <h1>{t("gate.unverified.title")}</h1>
                <p>{t("gate.unverified.text")}</p>
                <div className="btn-row">
                    <Link className="btn btn-outline" to="/profile">
                        {t("gate.unverified.profile")}
                    </Link>
                </div>
            </section>
        );
    }
    if (access === "waiting") {
        return (
            <section className="card state">
                <h1>{t("gate.waiting.title")}</h1>
                <p>{t("gate.waiting.text")}</p>
                <div className="btn-row">
                    <Link className="btn btn-outline" to="/profile">
                        {t("gate.waiting.profile")}
                    </Link>
                </div>
            </section>
        );
    }

    return <>{children}</>;
}
