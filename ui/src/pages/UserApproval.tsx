import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { MenuButton, Page, PageHeading, SidebarMenu } from "../components/Page";
import { ClientResponseError } from "pocketbase";

import { pb } from "../lib/pbClient";
import { notifyInboxChanged } from "../lib/beiratInbox";
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
    const [view, setView] = useState<"pending" | "approved">("pending");
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

    const list = view === "pending" ? state.pending : state.approved;

    return (
        <Page
            sidebar={
                <>
                    <SidebarMenu title={t("users.heading")}>
                        <MenuButton
                            icon="ri-user-add-line"
                            active={view === "pending"}
                            count={state.pending.length}
                            onClick={() => setView("pending")}
                        >
                            {t("users.pending.heading")}
                        </MenuButton>
                        <MenuButton
                            icon="ri-group-line"
                            active={view === "approved"}
                            count={state.approved.length}
                            onClick={() => setView("approved")}
                        >
                            {t("users.approved.heading")}
                        </MenuButton>
                    </SidebarMenu>
                    <p className="txt-hint sidebar-text">{t("users.intro")}</p>
                </>
            }
        >
            <PageHeading
                title={view === "pending" ? t("users.pending.heading") : t("users.approved.heading")}
            />

            {state.loading && <p className="txt-hint">{t("users.loading")}</p>}
            {state.error && <div className="alert danger">{t("users.error.load")}</div>}

            {!state.loading && !state.error && (
                list.length === 0 ? (
                    <div className="alert">
                        {view === "pending" ? t("users.pending.empty") : t("users.approved.empty")}
                    </div>
                ) : (
                    <div className="list">
                        {list.map((user) => (
                            <UserRow
                                key={user.id}
                                user={user}
                                action={view === "pending" ? "approve" : "revoke"}
                                onApprovedChange={onApprovedChange}
                            />
                        ))}
                    </div>
                )
            )}
        </Page>
    );
}

function UserRow({
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
            notifyInboxChanged();
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

    const initials = (user.name || user.email).slice(0, 2).toUpperCase();

    return (
        <div className="list-item user-row">
            <span className="thumb circle" aria-hidden="true">{initials}</span>
            <span className="content">
                <span className="txt-bold">{user.name || t("users.noName")}</span>
                <span className="meta">
                    <span className="meta-item">
                        <i className="ri-mail-line" aria-hidden="true" />
                        {user.email}
                    </span>
                    <span className="label sm">{t(`users.roleValues.${user.role}`)}</span>
                </span>
                {error && <span className="field-help error">{error}</span>}
            </span>
            <span className="ctrls">
                <button
                    type="button"
                    className={`btn sm ${action === "approve" ? "" : "secondary"} ${busy ? "loading" : ""}`}
                    disabled={busy}
                    onClick={run}
                >
                    <i className={action === "approve" ? "ri-check-line" : "ri-user-unfollow-line"} aria-hidden="true" />
                    <span className="txt">{t(action === "approve" ? "users.approve" : "users.revoke")}</span>
                </button>
            </span>
        </div>
    );
}
