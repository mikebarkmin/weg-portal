import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClientResponseError } from "pocketbase";

import { pb } from "../lib/pbClient";
import { errorStatus, serverMessage } from "../lib/pbErrors";
import { buildUserApprovalPatch } from "../lib/validation";
import type { PortalUser } from "../types";

interface UsersState {
    pending: PortalUser[];
    approved: PortalUser[];
    loading: boolean;
    error: boolean;
}

// Beirat user approval: new accounts wait here for `approved = true`
// (the create hook forces role=resident, approved=false). Moved-out
// residents are revoked the same way (plan.md "Users: updates and
// approval"). The Beirat may only flip `approved` - never name, email
// or role (enforced by the update rule; this page never sends them).
export default function UserApproval() {
    const { t } = useTranslation();
    const [state, setState] = useState<UsersState>({
        pending: [],
        approved: [],
        loading: true,
        error: false,
    });

    useEffect(() => {
        let active = true;
        setState((prev) => ({ ...prev, loading: true, error: false }));
        pb.collection<PortalUser>("users")
            .getFullList()
            .then((users) => {
                if (active) {
                    setState({
                        // per milestones.md only unapproved *verified*
                        // users wait for approval - an unverified account
                        // must confirm its email first (server rules
                        // require approved && verified for access anyway)
                        pending: users.filter((user) => !user.approved && user.verified),
                        approved: users.filter((user) => user.approved),
                        loading: false,
                        error: false,
                    });
                }
            })
            .catch(() => {
                if (active) {
                    setState((prev) => ({ ...prev, loading: false, error: true }));
                }
            });
        return () => {
            active = false;
        };
    }, []);

    const onApprovedChange = (user: PortalUser, approved: boolean) => {
        setState((prev) => ({
            pending: approved
                ? prev.pending.filter((item) => item.id !== user.id)
                : [...prev.pending, { ...user, approved: false }],
            approved: approved
                ? [{ ...user, approved: true }, ...prev.approved]
                : prev.approved.filter((item) => item.id !== user.id),
            loading: prev.loading,
            error: prev.error,
        }));
    };

    return (
        <>
            <h1>{t("users.heading")}</h1>

            {state.loading && <p className="state">{t("users.loading")}</p>}
            {state.error && (
                <p className="state state-error">{t("users.error.load")}</p>
            )}

            {!state.loading && !state.error && (
                <section className="queue" aria-label={t("users.pending.heading")}>
                    <h2>{t("users.pending.heading")}</h2>
                    {state.pending.length === 0 ? (
                        <p className="state">{t("users.pending.empty")}</p>
                    ) : (
                        state.pending.map((user) => (
                            <UserCard
                                key={user.id}
                                user={user}
                                action="approve"
                                onApprovedChange={onApprovedChange}
                            />
                        ))
                    )}
                </section>
            )}

            {!state.loading && !state.error && (
                <section className="queue" aria-label={t("users.approved.heading")}>
                    <h2>{t("users.approved.heading")}</h2>
                    {state.approved.length === 0 ? (
                        <p className="state">{t("users.approved.empty")}</p>
                    ) : (
                        state.approved.map((user) => (
                            <UserCard
                                key={user.id}
                                user={user}
                                action="revoke"
                                onApprovedChange={onApprovedChange}
                            />
                        ))
                    )}
                </section>
            )}
        </>
    );
}

function UserCard({
    user,
    action,
    onApprovedChange,
}: {
    user: PortalUser;
    action: "approve" | "revoke";
    onApprovedChange: (user: PortalUser, approved: boolean) => void;
}) {
    const { t } = useTranslation();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const run = async () => {
        const approved = action === "approve";
        setBusy(true);
        setError(null);
        try {
            await pb.collection("users").update(user.id, buildUserApprovalPatch(approved));
            onApprovedChange(user, approved);
        } catch (err) {
            if (err instanceof ClientResponseError && errorStatus(err) === 400) {
                setError(`${t("users.error.update")} (${serverMessage(err)})`);
            } else {
                setError(t("users.error.update"));
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <article className="card queue-card">
            <dl className="queue-meta">
                <dt>{t("users.name")}</dt>
                <dd>{user.name || t("users.noName")}</dd>
                <dt>{t("users.email")}</dt>
                <dd>{user.email}</dd>
                <dt>{t("users.role")}</dt>
                <dd>{t(`users.roleValues.${user.role}`)}</dd>
            </dl>
            {error && <div className="form-error">{error}</div>}
            <div className="btn-row">
                <button
                    type="button"
                    className={action === "approve" ? "btn" : "btn btn-outline"}
                    disabled={busy}
                    onClick={run}
                >
                    {t(action === "approve" ? "users.approve" : "users.revoke")}
                </button>
            </div>
        </article>
    );
}
