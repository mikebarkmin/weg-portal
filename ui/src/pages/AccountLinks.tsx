import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ClientResponseError } from "pocketbase";

import { Wrapper } from "../components/Page";
import FormField from "../components/FormField";
import { pb } from "../lib/pbClient";
import { errorStatus } from "../lib/pbErrors";
import { MIN_PASSWORD_LENGTH } from "../lib/validation";

// The account pages the auth mails link to (migration
// 1795000114_auth_mail_links.go) plus the "forgot password" request form.
// They replace PocketBase's /_/#/auth/... pages, which sit behind the
// admin basic auth in production.

function rateLimited(err: unknown): boolean {
    return err instanceof ClientResponseError && errorStatus(err) === 429;
}

function AuthCard({ heading, children }: { heading: string; children: React.ReactNode }) {
    const { t } = useTranslation();
    return (
        <Wrapper size="sm">
            <div className="post auth-form">
                <header className="auth-form-header">
                    <h1 className="title">{heading}</h1>
                </header>
                {children}
            </div>
            <p className="auth-links txt-hint">
                <Link to="/login">{t("account.toLogin")}</Link>
            </p>
        </Wrapper>
    );
}

// /passwort-vergessen: request a reset mail. The answer is the same whether
// or not the address has an account (PocketBase answers 204 either way).
export function ForgotPassword() {
    const { t } = useTranslation();
    const [email, setEmail] = useState("");
    const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
    const [error, setError] = useState<string | null>(null);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);
        if (!email.includes("@")) {
            setError("validation.invalidEmail");
            return;
        }
        setState("sending");
        try {
            await pb.collection("users").requestPasswordReset(email.trim());
            setState("sent");
        } catch (err) {
            setError(rateLimited(err) ? "account.error.rateLimited" : "account.error.generic");
            setState("idle");
        }
    };

    return (
        <AuthCard heading={t("account.forgot.heading")}>
            {state === "sent" ? (
                <div className="alert success">{t("account.forgot.sent")}</div>
            ) : (
                <form onSubmit={submit} noValidate>
                    <p className="txt-hint auth-intro">{t("account.forgot.intro")}</p>
                    <div className="grid sm">
                        <FormField id="forgot-email" label={t("login.email")} required>
                            <input
                                id="forgot-email"
                                type="email"
                                inputMode="email"
                                autoComplete="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />
                        </FormField>
                        {error && (
                            <div className="col-12">
                                <div className="alert danger">{t(error)}</div>
                            </div>
                        )}
                        <div className="col-12">
                            <button type="submit" className={`btn full-width ${state === "sending" ? "loading" : ""}`} disabled={state === "sending"}>
                                <span className="txt">{t("account.forgot.submit")}</span>
                            </button>
                        </div>
                    </div>
                </form>
            )}
        </AuthCard>
    );
}

// /konto/passwort-neu/:token
export function ResetPassword() {
    const { t } = useTranslation();
    const { token = "" } = useParams();
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [state, setState] = useState<"idle" | "sending" | "done">("idle");
    const [error, setError] = useState<string | null>(null);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);
        if (password.length < MIN_PASSWORD_LENGTH) {
            setError("validation.passwordTooShort");
            return;
        }
        if (password !== confirm) {
            setError("validation.passwordMismatch");
            return;
        }
        setState("sending");
        try {
            await pb.collection("users").confirmPasswordReset(token, password, confirm);
            setState("done");
        } catch (err) {
            setError(rateLimited(err) ? "account.error.rateLimited" : "account.error.invalidLink");
            setState("idle");
        }
    };

    return (
        <AuthCard heading={t("account.reset.heading")}>
            {state === "done" ? (
                <div className="alert success">{t("account.reset.done")}</div>
            ) : (
                <form onSubmit={submit} noValidate>
                    <div className="grid sm">
                        <FormField id="reset-password" label={t("account.reset.password")} required>
                            <input
                                id="reset-password"
                                type="password"
                                autoComplete="new-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                        </FormField>
                        <FormField id="reset-confirm" label={t("account.reset.confirm")} required>
                            <input
                                id="reset-confirm"
                                type="password"
                                autoComplete="new-password"
                                value={confirm}
                                onChange={(e) => setConfirm(e.target.value)}
                                required
                            />
                        </FormField>
                        {error && (
                            <div className="col-12">
                                <div className="alert danger">{t(error)}</div>
                            </div>
                        )}
                        <div className="col-12">
                            <button type="submit" className={`btn full-width ${state === "sending" ? "loading" : ""}`} disabled={state === "sending"}>
                                <span className="txt">{t("account.reset.submit")}</span>
                            </button>
                        </div>
                    </div>
                </form>
            )}
        </AuthCard>
    );
}

// /konto/bestaetigen/:token - confirms right away; no form needed.
export function ConfirmVerification() {
    const { t } = useTranslation();
    const { token = "" } = useParams();
    const [state, setState] = useState<"working" | "done" | "failed">("working");
    const started = useRef(false);

    useEffect(() => {
        // StrictMode runs effects twice; a token can only be used once
        if (started.current) return;
        started.current = true;
        pb.collection("users")
            .confirmVerification(token)
            .then(async () => {
                setState("done");
                // refresh a logged-in session so "verified" is current
                if (pb.authStore.isValid) {
                    await pb.collection("users").authRefresh().catch(() => undefined);
                }
            })
            .catch(() => setState("failed"));
    }, [token]);

    return (
        <AuthCard heading={t("account.verify.heading")}>
            {state === "working" && <p className="txt-hint">{t("account.verify.working")}</p>}
            {state === "done" && <div className="alert success">{t("account.verify.done")}</div>}
            {state === "failed" && <div className="alert danger">{t("account.error.invalidLink")}</div>}
        </AuthCard>
    );
}

// /konto/email-bestaetigen/:token - PocketBase requires the current
// password to confirm an email change.
export function ConfirmEmailChange() {
    const { t } = useTranslation();
    const { token = "" } = useParams();
    const [password, setPassword] = useState("");
    const [state, setState] = useState<"idle" | "sending" | "done">("idle");
    const [error, setError] = useState<string | null>(null);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);
        setState("sending");
        try {
            await pb.collection("users").confirmEmailChange(token, password);
            // the old session token is invalidated by the change
            pb.authStore.clear();
            setState("done");
        } catch (err) {
            setError(rateLimited(err) ? "account.error.rateLimited" : "account.error.emailChange");
            setState("idle");
        }
    };

    return (
        <AuthCard heading={t("account.emailChange.heading")}>
            {state === "done" ? (
                <div className="alert success">{t("account.emailChange.done")}</div>
            ) : (
                <form onSubmit={submit} noValidate>
                    <p className="txt-hint auth-intro">{t("account.emailChange.intro")}</p>
                    <div className="grid sm">
                        <FormField id="email-change-password" label={t("login.password")} required>
                            <input
                                id="email-change-password"
                                type="password"
                                autoComplete="current-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                        </FormField>
                        {error && (
                            <div className="col-12">
                                <div className="alert danger">{t(error)}</div>
                            </div>
                        )}
                        <div className="col-12">
                            <button type="submit" className={`btn full-width ${state === "sending" ? "loading" : ""}`} disabled={state === "sending" || !password}>
                                <span className="txt">{t("account.emailChange.submit")}</span>
                            </button>
                        </div>
                    </div>
                </form>
            )}
        </AuthCard>
    );
}
