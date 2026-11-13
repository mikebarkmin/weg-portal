import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
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
        <section className="card form">
            <h1>{t("login.heading")}</h1>
            <form onSubmit={submit} noValidate>
                <div className="field">
                    <label htmlFor="login-email">{t("login.email")}</label>
                    <input
                        id="login-email"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />
                </div>
                <div className="field">
                    <label htmlFor="login-password">{t("login.password")}</label>
                    <input
                        id="login-password"
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />
                </div>
                {error && <div className="form-error">{t(error)}</div>}
                <div className="btn-row">
                    <button type="submit" className="btn" disabled={sending}>
                        {sending ? t("login.submitting") : t("login.submit")}
                    </button>
                </div>
            </form>
            <p className="hint">
                <Link to="/">{t("login.back")}</Link>
            </p>
        </section>
    );
}
