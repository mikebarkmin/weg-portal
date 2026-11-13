import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Wrapper } from "../components/Page";
import FormField from "../components/FormField";
import { ClientResponseError } from "pocketbase";

import { pb } from "../lib/pbClient";
import { errorStatus } from "../lib/pbErrors";

// Login against the `users` collection. PocketBase stores the auth
// state in pb.authStore (persisted in localStorage by the SDK).
export default function Login() {
    const { t } = useTranslation();
    const navigate = useNavigate();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [sending, setSending] = useState(false);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);
        setSending(true);
        try {
            await pb.collection("users").authWithPassword(email, password);
            navigate("/");
        } catch (err) {
            if (
                err instanceof ClientResponseError &&
                errorStatus(err) === 429
            ) {
                setError("login.error.rateLimited");
            } else if (
                err instanceof ClientResponseError &&
                errorStatus(err) >= 400 &&
                errorStatus(err) < 500
            ) {
                setError("login.error.invalid");
            } else {
                setError("login.error.generic");
            }
        } finally {
            setSending(false);
        }
    };

    return (
        <Wrapper size="sm">
            <form className="post auth-form" onSubmit={submit} noValidate>
                <header className="auth-form-header">
                    <h1 className="title">{t("login.heading")}</h1>
                </header>
                <div className="grid sm">
                    <FormField id="login-email" label={t("login.email")} required>
                        <input
                            id="login-email"
                            type="email"
                            inputMode="email"
                            autoComplete="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </FormField>
                    <FormField id="login-password" label={t("login.password")} required>
                        <input
                            id="login-password"
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
                        <button type="submit" className={`btn full-width ${sending ? "loading" : ""}`} disabled={sending}>
                            <span className="txt">{sending ? t("login.submitting") : t("login.submit")}</span>
                        </button>
                    </div>
                </div>
            </form>
            <p className="auth-links txt-hint">
                <Link to="/signup">{t("login.toSignup")}</Link>
            </p>
        </Wrapper>
    );
}
