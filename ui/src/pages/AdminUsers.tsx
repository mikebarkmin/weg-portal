import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { MenuButton, Page, PageHeading, SidebarMenu } from "../components/Page";
import FormField from "../components/FormField";
import { pb } from "../lib/pbClient";
import { serverMessage } from "../lib/pbErrors";
import { MIN_PASSWORD_LENGTH } from "../lib/validation";
import type { PortalUser } from "../types";
import { USER_ROLES } from "../types";

type View = "all" | "pending" | "new";

interface UsersState {
    users: PortalUser[];
    loading: boolean;
    error: boolean;
}

// Admin account management (/admin): everything a superuser previously
// did in the PocketBase dashboard happens here in the app - creating
// users, changing roles, approving/denying, resetting passwords and
// removing accounts. All writes go through the custom admin routes
// (hooks/adminUsers.go) because the collection API forbids role writes
// for non-superusers by design; the routes enforce their own guards
// (no self-edits, the last active admin stays untouched).
export default function AdminUsers() {
    const { t } = useTranslation();
    const [view, setView] = useState<View>("all");
    const [state, setState] = useState<UsersState>({ users: [], loading: true, error: false });

    // which record is the admin themself (the routes refuse to operate
    // on the caller's own record - the profile page owns it)
    const record = pb.authStore.record as Record<string, unknown> | null;
    const ownId = typeof record?.["id"] === "string" ? record["id"] : "";

    const load = useCallback(() => {
        let active = true;
        setState((prev) => ({ ...prev, loading: true, error: false }));
        pb.collection<PortalUser>("users")
            .getFullList({ sort: "-created" })
            .then((users) => {
                if (active) {
                    setState({ users, loading: false, error: false });
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

    useEffect(load, [load]);

    const pending = state.users.filter((user) => !user.approved && user.verified);

    const onSaved = (user: PortalUser) => {
        setState((prev) => ({
            ...prev,
            users: prev.users.some((item) => item.id === user.id)
                ? prev.users.map((item) => (item.id === user.id ? { ...item, ...user } : item))
                : [user, ...prev.users],
        }));
    };

    const onRemoved = (id: string) => {
        setState((prev) => ({ ...prev, users: prev.users.filter((item) => item.id !== id) }));
    };

    return (
        <Page
            sidebar={
                <>
                    <SidebarMenu title={t("admin.heading")}>
                        <MenuButton
                            icon="ri-group-line"
                            active={view === "all"}
                            count={state.users.length}
                            onClick={() => setView("all")}
                        >
                            {t("admin.all.heading")}
                        </MenuButton>
                        <MenuButton
                            icon="ri-user-add-line"
                            active={view === "pending"}
                            count={pending.length}
                            onClick={() => setView("pending")}
                        >
                            {t("admin.pending.heading")}
                        </MenuButton>
                        <MenuButton
                            icon="ri-user-follow-line"
                            active={view === "new"}
                            onClick={() => setView("new")}
                        >
                            {t("admin.new.submit")}
                        </MenuButton>
                    </SidebarMenu>
                    <p className="txt-hint sidebar-text">{t("admin.intro")}</p>
                </>
            }
        >
            {view === "new" ? (
                <NewUserView onSaved={onSaved} />
            ) : (
                <>
                    <PageHeading
                        title={view === "pending" ? t("admin.pending.heading") : t("admin.all.heading")}
                    />
                    {state.loading && <p className="txt-hint">{t("admin.loading")}</p>}
                    {state.error && <div className="alert danger">{t("admin.error.load")}</div>}
                    {!state.loading && !state.error && (
                        <>
                            {view === "pending" && pending.length === 0 && (
                                <div className="alert">{t("admin.pending.empty")}</div>
                            )}
                            <div className="list">
                                {state.users
                                    .filter((user) => (view === "pending" ? !user.approved && user.verified : true))
                                    .map((user) => (
                                        <UserRow
                                            key={user.id}
                                            user={user}
                                            ownRecord={user.id === ownId}
                                            onSaved={onSaved}
                                            onRemoved={onRemoved}
                                        />
                                    ))}
                            </div>
                        </>
                    )}
                </>
            )}
        </Page>
    );
}

function UserRow({
    user,
    ownRecord,
    onSaved,
    onRemoved,
}: {
    user: PortalUser;
    ownRecord: boolean;
    onSaved: (user: PortalUser) => void;
    onRemoved: (id: string) => void;
}) {
    const { t } = useTranslation();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<{ message: string; detail: string } | null>(null);
    const [password, setPassword] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const patch = async (body: Record<string, unknown>, url?: string) => {
        setBusy(true);
        setError(null);
        try {
            const saved = await pb.send<PortalUser>(url ?? `/api/portal/admin/users/${user.id}`, {
                method: "PATCH",
                body,
            });
            onSaved({ ...user, ...saved });
        } catch (err) {
            setError({ message: t("admin.error.save"), detail: serverMessage(err) });
        } finally {
            setBusy(false);
        }
    };

    const resetPassword = async () => {
        setBusy(true);
        setError(null);
        setPassword(null);
        setCopied(false);
        try {
            const res = await pb.send<{ password: string }>(
                `/api/portal/admin/users/${user.id}/reset-password`,
                { method: "POST", body: {} },
            );
            setPassword(res.password);
        } catch (err) {
            setError({ message: t("admin.error.password"), detail: serverMessage(err) });
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!window.confirm(t("admin.confirmDelete", { email: user.email }))) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await pb.send(`/api/portal/admin/users/${user.id}`, { method: "DELETE" });
            onRemoved(user.id);
        } catch (err) {
            setError({ message: t("admin.error.delete"), detail: serverMessage(err) });
            setBusy(false);
        }
    };

    const changeRole = (role: string) => {
        if (role !== user.role) {
            void patch({ role });
        }
    };

    const initials = (user.name || user.email).slice(0, 2).toUpperCase();
    const status = !user.verified
        ? "unverified"
        : !user.approved
          ? "waiting"
          : "granted";

    return (
        <div className="list-item user-row">
            <span className="thumb circle" aria-hidden="true">{initials}</span>
            <span className="content">
                <span className="txt-bold">{user.name || t("admin.noName")}</span>
                <span className="meta">
                    <span className="meta-item">
                        <i className="ri-mail-line" aria-hidden="true" />
                        {user.email}
                    </span>
                    <span className="label sm">{t(`users.roleValues.${user.role}`)}</span>
                    {status !== "granted" && (
                        <span className="label sm">{t(`admin.status.${status}`)}</span>
                    )}
                </span>
                {ownRecord && <span className="txt-hint">{t("admin.ownRecord")}</span>}
                {password && (
                    <div className="alert admin-password">
                        <span>{t("admin.password.generated")}:</span>
                        <code>{password}</code>
                        <button
                            type="button"
                            className="btn sm secondary"
                            onClick={() => {
                                void navigator.clipboard.writeText(password).then(() => setCopied(true));
                            }}
                        >
                            <i className={copied ? "ri-check-line" : "ri-file-copy-line"} aria-hidden="true" />
                            <span className="txt">
                                {copied ? t("admin.password.copied") : t("admin.password.copy")}
                            </span>
                        </button>
                    </div>
                )}
                {error && (
                    <span className="field-help error" role="alert">
                        {error.detail ? `${error.message} (${error.detail})` : error.message}
                    </span>
                )}
            </span>
            <span className="ctrls">
                <div className="field admin-role-select">
                    <select
                        value={user.role}
                        disabled={busy || ownRecord}
                        onChange={(e) => changeRole(e.target.value)}
                        aria-label={t("admin.role.change")}
                    >
                        {USER_ROLES.map((role) => (
                            <option key={role} value={role}>
                                {t(`users.roleValues.${role}`)}
                            </option>
                        ))}
                    </select>
                </div>
                <button
                    type="button"
                    className={`btn sm ${user.approved && user.verified ? "secondary" : ""}`}
                    disabled={busy || ownRecord}
                    title={t("admin.approved.toggle")}
                    onClick={() => void patch({ approved: !user.approved })}
                >
                    <i
                        className={user.approved ? "ri-user-unfollow-line" : "ri-check-line"}
                        aria-hidden="true"
                    />
                    <span className="txt">
                        {user.approved ? t("admin.revoke") : t("admin.approve")}
                    </span>
                </button>
                <button
                    type="button"
                    className="btn sm secondary"
                    disabled={busy || ownRecord}
                    title={t("admin.password.reset")}
                    onClick={() => void resetPassword()}
                >
                    <i className="ri-key-2-line" aria-hidden="true" />
                    <span className="txt">{t("admin.password.reset")}</span>
                </button>
                <button
                    type="button"
                    className="btn sm secondary"
                    disabled={busy || ownRecord}
                    title={t("admin.delete")}
                    onClick={() => void remove()}
                >
                    <i className="ri-delete-bin-line" aria-hidden="true" />
                    <span className="txt">{t("admin.delete")}</span>
                </button>
            </span>
        </div>
    );
}

function NewUserView({ onSaved }: { onSaved: (user: PortalUser) => void }) {
    const { t } = useTranslation();
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [role, setRole] = useState<string>("resident");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<{ message: string; detail: string } | null>(null);
    const [created, setCreated] = useState<{ user: PortalUser; password: string | null } | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        setCreated(null);
        try {
            const saved = await pb.send<PortalUser & { password?: string }>(
                "/api/portal/admin/users",
                {
                    method: "POST",
                    body: {
                        name: name.trim(),
                        email: email.trim(),
                        role,
                        ...(password.trim() !== "" ? { password: password.trim() } : {}),
                    },
                },
            );
            const created: PortalUser = { ...saved, name: name.trim(), email: email.trim(), role };
            onSaved(created);
            setCreated({ user: created, password: typeof saved.password === "string" ? saved.password : null });
            setName("");
            setEmail("");
            setPassword("");
        } catch (err) {
            setError({ message: t("admin.error.create"), detail: serverMessage(err) });
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <PageHeading title={t("admin.new.heading")} />
            <form className="post" onSubmit={submit}>
                <div className="grid sm">
                    <FormField id="admin-new-name" label={t("admin.name")} required>
                        <input
                            id="admin-new-name"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                    </FormField>
                    <FormField id="admin-new-email" label={t("admin.email")} required>
                        <input
                            id="admin-new-email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </FormField>
                    <FormField id="admin-new-role" label={t("admin.role.label")} required>
                        <select
                            id="admin-new-role"
                            value={role}
                            onChange={(e) => setRole(e.target.value)}
                        >
                            {USER_ROLES.map((option) => (
                                <option key={option} value={option}>
                                    {t(`users.roleValues.${option}`)}
                                </option>
                            ))}
                        </select>
                    </FormField>
                    <FormField
                        id="admin-new-password"
                        label={t("admin.new.password")}
                        hint={t("admin.new.passwordHint")}
                    >
                        <input
                            id="admin-new-password"
                            type="text"
                            autoComplete="off"
                            minLength={MIN_PASSWORD_LENGTH}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </FormField>
                    {error && (
                        <div className="col-12">
                            <div className="alert danger" role="alert">
                                {error.detail ? `${error.message} (${error.detail})` : error.message}
                            </div>
                        </div>
                    )}
                    {created && (
                        <div className="col-12">
                            <div className="alert">
                                {t("admin.new.created", { email: created.user.email })}
                                {created.password && (
                                    <>
                                        {" "}
                                        {t("admin.password.generated")}: <code>{created.password}</code>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                    <div className="col-12">
                        <footer className="form-footer">
                            <button type="submit" className={`btn ${busy ? "loading" : ""}`} disabled={busy}>
                                <span className="txt">
                                    {busy ? t("admin.new.busy") : t("admin.new.submit")}
                                </span>
                            </button>
                        </footer>
                    </div>
                </div>
            </form>
            <p className="txt-hint">{t("admin.new.note")}</p>
        </>
    );
}
