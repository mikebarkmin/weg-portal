import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ClientResponseError } from "pocketbase";

import { pb } from "../lib/pbClient";
import { useAuth } from "../lib/auth";
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
                notifyNewIssues: showNotify ? notifyNewIssues : undefined,
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

    return (
        <>
            <h1>{t("profile.heading")}</h1>
            <p className="hint">{t("profile.readonlyHint")}</p>

            <form className="card form" onSubmit={saveProfile}>
                <h2 className="section-title">{t("profile.account")}</h2>
                <div className="field">
                    <label htmlFor="profile-name">{t("profile.name")}</label>
                    <input
                        id="profile-name"
                        type="text"
                        maxLength={200}
                        autoComplete="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                </div>
                <div className="field">
                    <label htmlFor="profile-email">{t("profile.email")}</label>
                    <input
                        id="profile-email"
                        type="email"
                        value={currentEmail}
                        readOnly
                        aria-readonly="true"
                    />
                    <p className="hint">{t("profile.emailHint")}</p>
                </div>
                {showNotify && (
                    <div className="field field-inline">
                        <label>
                            <input
                                type="checkbox"
                                checked={notifyNewIssues}
                                onChange={(e) => setNotifyNewIssues(e.target.checked)}
                            />
                            {t("profile.notify")}
                        </label>
                        <p className="hint">{t("profile.notifyHint")}</p>
                    </div>
                )}
                {!verified && (
                    <div className="field">
                        <p className="hint">{t("profile.verify.hint")}</p>
                        <button
                            type="button"
                            className="btn btn-outline"
                            onClick={resendVerification}
                            disabled={verifyBusy}
                        >
                            {t("profile.verify.resend")}
                        </button>
                        {verifySent && <p className="hint">{t("profile.verify.sent")}</p>}
                    </div>
                )}
                {profileError && (
                    <div className="form-error">
                        {t(profileError.key)}
                        {profileError.detail ? ` (${profileError.detail})` : ""}
                    </div>
                )}
                {profileSaved && <p className="hint">{t("profile.saved")}</p>}
                <div className="btn-row">
                    <button type="submit" className="btn" disabled={profileBusy}>
                        {profileBusy ? t("profile.saving") : t("profile.save")}
                    </button>
                </div>
            </form>

            <form className="card form" onSubmit={savePassword}>
                <h2 className="section-title">{t("profile.password.heading")}</h2>
                <div className="field">
                    <label htmlFor="profile-old-password">
                        {t("profile.password.old")}
                    </label>
                    <input
                        id="profile-old-password"
                        type="password"
                        autoComplete="current-password"
                        value={oldPassword}
                        onChange={(e) => setOldPassword(e.target.value)}
                    />
                </div>
                <div className="field">
                    <label htmlFor="profile-new-password">
                        {t("profile.password.new")}
                    </label>
                    <input
                        id="profile-new-password"
                        type="password"
                        autoComplete="new-password"
                        minLength={MIN_PASSWORD_LENGTH}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                    />
                </div>
                <div className="field">
                    <label htmlFor="profile-confirm-password">
                        {t("profile.password.confirm")}
                    </label>
                    <input
                        id="profile-confirm-password"
                        type="password"
                        autoComplete="new-password"
                        minLength={MIN_PASSWORD_LENGTH}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                </div>
                {passwordError && (
                    <div className="form-error">
                        {t(passwordError.key)}
                        {passwordError.detail ? ` (${passwordError.detail})` : ""}
                    </div>
                )}
                {passwordSaved && <p className="hint">{t("profile.password.saved")}</p>}
                <div className="btn-row">
                    <button type="submit" className="btn" disabled={passwordBusy}>
                        {passwordBusy
                            ? t("profile.saving")
                            : t("profile.password.submit")}
                    </button>
                </div>
            </form>

            <form className="card form" onSubmit={requestEmailChange}>
                <h2 className="section-title">{t("profile.emailChange.heading")}</h2>
                <div className="field">
                    <label htmlFor="profile-new-email">
                        {t("profile.emailChange.newEmail")}
                    </label>
                    <input
                        id="profile-new-email"
                        type="email"
                        inputMode="email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                    />
                    <p className="hint">{t("profile.emailChange.hint")}</p>
                </div>
                {emailError && (
                    <div className="form-error">
                        {t(emailError.key)}
                        {emailError.detail ? ` (${emailError.detail})` : ""}
                    </div>
                )}
                {emailSent && (
                    <p className="hint">{t("profile.emailChange.sent")}</p>
                )}
                <div className="btn-row">
                    <button type="submit" className="btn" disabled={emailBusy}>
                        {emailBusy ? t("profile.saving") : t("profile.emailChange.submit")}
                    </button>
                </div>
            </form>
        </>
    );
}
