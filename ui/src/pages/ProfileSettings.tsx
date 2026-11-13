import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ClientResponseError } from "pocketbase";

import { pb } from "../lib/pbClient";
import { useAuth } from "../lib/auth";
import { useNavigate } from "react-router-dom";
import PersonalFeed from "../components/PersonalFeed";
import { MenuButton, Page, PageHeading, SidebarInfo, SidebarMenu } from "../components/Page";
import FormField, { SwitchField } from "../components/FormField";
import { errorStatus, serverMessage } from "../lib/pbErrors";
import {
    buildPasswordUpdate,
    buildProfileUpdate,
    MIN_PASSWORD_LENGTH,
    passwordChangeSchema,
    profileNameSchema,
} from "../lib/validation";

// ProfileSettings (M9): name, the notify_new_issues opt-in (hausmeister/
// hausverwaltung only), password change and PocketBase's email-change flow.
// role/approved/verified are NEVER editable here: no inputs exist for them,
// no payload ever contains them (see lib/validation.ts) - the server rules
// and the create hook own these fields.
export default function ProfileSettings() {
    const { t } = useTranslation();
    const auth = useAuth();

    // The self-record as currently stored in the auth record. Only the
    // fields this page manages are read from it.
    const record = pb.authStore.record as Record<string, unknown> | null;
    const currentEmail = typeof record?.["email"] === "string" ? record["email"] : "";
    const currentName = typeof record?.["name"] === "string" ? record["name"] : "";
    const verified = record?.["verified"] === true;
    const recordId = typeof record?.["id"] === "string" ? record["id"] : "";
    const role = auth.role;
    const [section, setSection] = useState<"account" | "notifications" | "calendar" | "password" | "email" | "delete">("account");
    const showNotify = role === "hausmeister" || role === "hausverwaltung";

    // ---- profile (name + optional notify flag) ----
    const [name, setName] = useState(currentName);
    const [notifyNewIssues, setNotifyNewIssues] = useState(
        record?.["notify_new_issues"] === true,
    );
    const [profileBusy, setProfileBusy] = useState(false);
    const [profileError, setProfileError] = useState<{ key: string; detail: string } | null>(null);
    const [profileSaved, setProfileSaved] = useState(false);

    // ---- password change ----
    const [oldPassword, setOldPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [passwordBusy, setPasswordBusy] = useState(false);
    const [passwordError, setPasswordError] = useState<{ key: string; detail: string } | null>(null);
    const [passwordSaved, setPasswordSaved] = useState(false);

    // ---- email change (PocketBase flow: mail with a confirm link to the
    // NEW address; the record email only changes after confirmation) ----
    const [newEmail, setNewEmail] = useState("");
    const [emailBusy, setEmailBusy] = useState(false);
    const [emailError, setEmailError] = useState<{ key: string; detail: string } | null>(null);
    const [emailSent, setEmailSent] = useState(false);

    // ---- resend verification email (unverified accounts) ----
    const [verifyBusy, setVerifyBusy] = useState(false);
    const [verifySent, setVerifySent] = useState(false);

    const updateAuthRecord = async () => {
        // authRefresh reloads the auth record so the UI (nav name,
        // notify flag, gate flags) follows the stored record.
        await pb.collection("users").authRefresh();
    };

    const saveProfile = async (event: React.FormEvent) => {
        event.preventDefault();
        setProfileError(null);
        setProfileSaved(false);
        const parsed = profileNameSchema.safeParse(name);
        if (!parsed.success) {
            setProfileError({ key: parsed.error.issues[0]?.message ?? "profile.error.save", detail: "" });
            return;
        }
        setProfileBusy(true);
        try {
            const patch = buildProfileUpdate(parsed.data, {
            });
            await pb.collection("users").update(recordId, patch);
            await updateAuthRecord();
            setProfileSaved(true);
        } catch (err) {
            const detail = err instanceof ClientResponseError ? serverMessage(err) : "";
            const key =
                err instanceof ClientResponseError && errorStatus(err) === 429
                    ? "profile.error.rateLimited"
                    : "profile.error.save";
            setProfileError({ key, detail });
        } finally {
            setProfileBusy(false);
        }
    };

    const savePassword = async (event: React.FormEvent) => {
        event.preventDefault();
        setPasswordError(null);
        setPasswordSaved(false);
        const parsed = passwordChangeSchema.safeParse({
            oldPassword,
            password: newPassword,
            passwordConfirm: confirmPassword,
        });
        if (!parsed.success) {
            setPasswordError({
                key: parsed.error.issues[0]?.message ?? "profile.error.save",
                detail: "",
            });
            return;
        }
        setPasswordBusy(true);
        try {
            await pb.collection("users").update(recordId, buildPasswordUpdate(parsed.data));
            setOldPassword("");
            setNewPassword("");
            setConfirmPassword("");
            setPasswordSaved(true);
        } catch (err) {
            const detail = err instanceof ClientResponseError ? serverMessage(err) : "";
            const key =
                err instanceof ClientResponseError && errorStatus(err) === 429
                    ? "profile.error.rateLimited"
                    : "profile.error.save";
            setPasswordError({ key, detail });
        } finally {
            setPasswordBusy(false);
        }
    };

    const requestEmailChange = async (event: React.FormEvent) => {
        event.preventDefault();
        setEmailError(null);
        setEmailSent(false);
        const value = newEmail.trim();
        if (value === "" || currentEmail === value) {
            setEmailError({ key: "profile.error.emailInvalid", detail: "" });
            return;
        }
        setEmailBusy(true);
        try {
            await pb.collection("users").requestEmailChange(value);
            setNewEmail("");
            setEmailSent(true);
        } catch (err) {
            const detail = err instanceof ClientResponseError ? serverMessage(err) : "";
            setEmailError({ key: "profile.error.emailChange", detail });
        } finally {
            setEmailBusy(false);
        }
    };

    const resendVerification = async () => {
        setVerifyBusy(true);
        try {
            await pb.collection("users").requestVerification(currentEmail);
            setVerifySent(true);
        } catch {
            setVerifySent(false);
        } finally {
            setVerifyBusy(false);
        }
    };

    const errorAlert = (error: { key: string; detail: string } | null) =>
        error && (
            <div className="col-12">
                <div className="alert danger">
                    {t(error.key)}
                    {error.detail ? ` (${error.detail})` : ""}
                </div>
            </div>
        );
    const successAlert = (show: boolean, key: string) =>
        show && (
            <div className="col-12">
                <div className="alert success">{t(key)}</div>
            </div>
        );

    return (
        <Page
            sidebar={
                <>
                    <SidebarMenu title={t("profile.heading")}>
                        <MenuButton icon="ri-user-line" active={section === "account"} onClick={() => setSection("account")}>
                            {t("profile.account")}
                        </MenuButton>
                        <MenuButton icon="ri-notification-3-line" active={section === "notifications"} onClick={() => setSection("notifications")}>
                            {t("profile.notifications.heading")}
                        </MenuButton>
                        <MenuButton icon="ri-calendar-2-line" active={section === "calendar"} onClick={() => setSection("calendar")}>
                            {t("profile.calendar.heading")}
                        </MenuButton>
                        <MenuButton icon="ri-lock-password-line" active={section === "password"} onClick={() => setSection("password")}>
                            {t("profile.password.heading")}
                        </MenuButton>
                        <MenuButton icon="ri-mail-line" active={section === "email"} onClick={() => setSection("email")}>
                            {t("profile.emailChange.heading")}
                        </MenuButton>
                        {role === "resident" && (
                            <MenuButton icon="ri-delete-bin-line" active={section === "delete"} onClick={() => setSection("delete")}>
                                {t("profile.delete.heading")}
                            </MenuButton>
                        )}
                    </SidebarMenu>
                    <SidebarInfo label={t("profile.role")}>
                        <span className="labels-list">
                            <span className="label sm">{t(`users.roleValues.${role}`)}</span>
                            {!verified && <span className="label sm warning">{t("profile.status.unverified")}</span>}
                        </span>
                    </SidebarInfo>
                    <p className="txt-hint sidebar-text">{t("profile.readonlyHint")}</p>
                </>
            }
        >
            {section === "account" && (
                <>
                    <PageHeading title={t("profile.account")} />
                    {!verified && (
                        <div className="alert warning m-b-sm flex gap-sm flex-wrap">
                            <span className="flex-fill">
                                {verifySent ? t("profile.verify.sent") : t("profile.verify.hint")}
                            </span>
                            <button
                                type="button"
                                className={`btn sm secondary ${verifyBusy ? "loading" : ""}`}
                                onClick={resendVerification}
                                disabled={verifyBusy}
                            >
                                {t("profile.verify.resend")}
                            </button>
                        </div>
                    )}
                    <form className="post" onSubmit={saveProfile}>
                        <div className="grid sm">
                            <FormField id="profile-name" label={t("profile.name")}>
                                <input
                                    id="profile-name"
                                    type="text"
                                    maxLength={200}
                                    autoComplete="name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                />
                            </FormField>
                            <FormField id="profile-email" label={t("profile.email")} hint={t("profile.emailHint")}>
                                <input id="profile-email" type="email" value={currentEmail} readOnly aria-readonly="true" />
                            </FormField>
                            {errorAlert(profileError)}
                            {successAlert(profileSaved, "profile.saved")}
                            <div className="col-12">
                                <footer className="form-footer">
                                    <button type="submit" className={`btn ${profileBusy ? "loading" : ""}`} disabled={profileBusy}>
                                        <span className="txt">{profileBusy ? t("profile.saving") : t("profile.save")}</span>
                                    </button>
                                </footer>
                            </div>
                        </div>
                    </form>
                </>
            )}

            {section === "notifications" && (
                <>
                    <PageHeading title={t("profile.notifications.heading")} />
                    <NotificationSettings
                        recordId={recordId}
                        staff={showNotify}
                        initial={{
                            notify_announcements: record?.["notify_announcements"] === true,
                            notify_events: record?.["notify_events"] === true,
                            notify_new_issues: notifyNewIssues,
                        }}
                        onSaved={(values) => setNotifyNewIssues(values.notify_new_issues)}
                    />
                </>
            )}

            {section === "calendar" && (
                <>
                    <PageHeading title={t("profile.calendar.heading")} />
                    <div className="post">
                        <p className="m-0">{t("profile.calendar.intro")}</p>
                        <PersonalFeed allowRenew />
                    </div>
                </>
            )}

            {section === "delete" && role === "resident" && (
                <>
                    <PageHeading title={t("profile.delete.heading")} />
                    <DeleteAccount recordId={recordId} email={currentEmail} />
                </>
            )}

            {section === "password" && (
                <>
                    <PageHeading title={t("profile.password.heading")} />
                    <form className="post" onSubmit={savePassword}>
                        <div className="grid sm">
                            <FormField id="profile-old-password" label={t("profile.password.old")} required>
                                <input
                                    id="profile-old-password"
                                    type="password"
                                    autoComplete="current-password"
                                    value={oldPassword}
                                    onChange={(e) => setOldPassword(e.target.value)}
                                />
                            </FormField>
                            <FormField id="profile-new-password" className="col-12 col-md-6" label={t("profile.password.new")} required>
                                <input
                                    id="profile-new-password"
                                    type="password"
                                    autoComplete="new-password"
                                    minLength={MIN_PASSWORD_LENGTH}
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                />
                            </FormField>
                            <FormField id="profile-confirm-password" className="col-12 col-md-6" label={t("profile.password.confirm")} required>
                                <input
                                    id="profile-confirm-password"
                                    type="password"
                                    autoComplete="new-password"
                                    minLength={MIN_PASSWORD_LENGTH}
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                />
                            </FormField>
                            {errorAlert(passwordError)}
                            {successAlert(passwordSaved, "profile.password.saved")}
                            <div className="col-12">
                                <footer className="form-footer">
                                    <button type="submit" className={`btn ${passwordBusy ? "loading" : ""}`} disabled={passwordBusy}>
                                        <span className="txt">{passwordBusy ? t("profile.saving") : t("profile.password.submit")}</span>
                                    </button>
                                </footer>
                            </div>
                        </div>
                    </form>
                </>
            )}

            {section === "email" && (
                <>
                    <PageHeading title={t("profile.emailChange.heading")} />
                    <form className="post" onSubmit={requestEmailChange}>
                        <div className="grid sm">
                            <FormField
                                id="profile-new-email"
                                label={t("profile.emailChange.newEmail")}
                                required
                                hint={t("profile.emailChange.hint")}
                            >
                                <input
                                    id="profile-new-email"
                                    type="email"
                                    inputMode="email"
                                    value={newEmail}
                                    onChange={(e) => setNewEmail(e.target.value)}
                                />
                            </FormField>
                            {errorAlert(emailError)}
                            {successAlert(emailSent, "profile.emailChange.sent")}
                            <div className="col-12">
                                <footer className="form-footer">
                                    <button type="submit" className={`btn ${emailBusy ? "loading" : ""}`} disabled={emailBusy}>
                                        <span className="txt">{emailBusy ? t("profile.saving") : t("profile.emailChange.submit")}</span>
                                    </button>
                                </footer>
                            </div>
                        </div>
                    </form>
                </>
            )}
        </Page>
    );
}

function NotificationSettings({
    recordId,
    staff,
    initial,
    onSaved,
}: {
    recordId: string;
    staff: boolean;
    initial: { notify_announcements: boolean; notify_events: boolean; notify_new_issues: boolean };
    onSaved: (values: { notify_announcements: boolean; notify_events: boolean; notify_new_issues: boolean }) => void;
}) {
    const { t } = useTranslation();
    const [values, setValues] = useState(initial);
    const [busy, setBusy] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState(false);

    const submit = async (e: { preventDefault(): void }) => {
        e.preventDefault();
        setBusy(true);
        setSaved(false);
        setError(false);
        try {
            await pb.collection("users").update(recordId, {
                notify_announcements: values.notify_announcements,
                notify_events: values.notify_events,
                ...(staff ? { notify_new_issues: values.notify_new_issues } : {}),
            });
            await pb.collection("users").authRefresh();
            setSaved(true);
            onSaved(values);
        } catch {
            setError(true);
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="post" onSubmit={submit}>
            <p className="m-0">{t("profile.notifications.intro")}</p>
            <div className="grid sm">
                <SwitchField
                    id="notify-announcements"
                    label={t("profile.notifications.announcements")}
                    hint={t("profile.notifications.announcementsHint")}
                    checked={values.notify_announcements}
                    onChange={(e) => setValues({ ...values, notify_announcements: e.target.checked })}
                />
                <SwitchField
                    id="notify-events"
                    label={t("profile.notifications.events")}
                    hint={t("profile.notifications.eventsHint")}
                    checked={values.notify_events}
                    onChange={(e) => setValues({ ...values, notify_events: e.target.checked })}
                />
                {staff && (
                    <SwitchField
                        id="profile-notify"
                        label={t("profile.notify")}
                        hint={t("profile.notifyHint")}
                        checked={values.notify_new_issues}
                        onChange={(e) => setValues({ ...values, notify_new_issues: e.target.checked })}
                    />
                )}
                {error && (
                    <div className="col-12">
                        <div className="alert danger">{t("profile.error.generic")}</div>
                    </div>
                )}
                {saved && (
                    <div className="col-12">
                        <div className="alert success">{t("profile.saved")}</div>
                    </div>
                )}
                <div className="col-12">
                    <footer className="form-footer">
                        <button type="submit" className={`btn ${busy ? "loading" : ""}`} disabled={busy}>
                            <span className="txt">{t("profile.save")}</span>
                        </button>
                    </footer>
                </div>
            </div>
        </form>
    );
}

// GDPR: owners delete their own account. Their reports and topics stay
// (without the link to the account); their poll votes are removed.
function DeleteAccount({ recordId, email }: { recordId: string; email: string }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [confirmText, setConfirmText] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);
    const matches = confirmText.trim().toLowerCase() === email.toLowerCase();

    const submit = async (e: { preventDefault(): void }) => {
        e.preventDefault();
        if (!matches) return;
        setBusy(true);
        setError(false);
        try {
            await pb.collection("users").delete(recordId);
            pb.authStore.clear();
            navigate("/?deleted=1");
        } catch {
            setError(true);
            setBusy(false);
        }
    };

    return (
        <form className="post" onSubmit={submit} noValidate>
            <div className="alert warning">{t("profile.delete.warning")}</div>
            <ul className="steps-list">
                <li>{t("profile.delete.effectAccount")}</li>
                <li>{t("profile.delete.effectSubmissions")}</li>
                <li>{t("profile.delete.effectVotes")}</li>
            </ul>
            <div className="grid sm">
                <FormField id="delete-confirm" label={t("profile.delete.confirmLabel", { email })} required>
                    <input id="delete-confirm" type="email" autoComplete="off" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
                </FormField>
                {error && (
                    <div className="col-12">
                        <div className="alert danger">{t("profile.delete.error")}</div>
                    </div>
                )}
                <div className="col-12">
                    <footer className="form-footer">
                        <button type="submit" className={`btn danger ${busy ? "loading" : ""}`} disabled={busy || !matches}>
                            <i className="ri-delete-bin-line" aria-hidden="true" />
                            <span className="txt">{t("profile.delete.submit")}</span>
                        </button>
                    </footer>
                </div>
            </div>
        </form>
    );
}
