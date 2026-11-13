import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { ClientResponseError } from "pocketbase";

import { pb } from "../lib/pbClient";
import { errorStatus, serverMessage } from "../lib/pbErrors";
import {
    buildSignupPayload,
    signupSchema,
    type SignupFormValues,
} from "../lib/validation";

// Signup: creates a resident account and walks the user into the approval
// workflow. The create hook forces role=resident, approved=false and
// verified=false (hooks/usersCreate.go); the verification mail (if SMTP is
// configured) is requested via PocketBase's own flow, the Beirat approves
// verified accounts in the user administration (plan.md "Account
// lifecycle"). Nothing here ever submits a role.
export default function Signup() {
    const { t } = useTranslation();
    const navigate = useNavigate();

    const [serverError, setServerError] = useState<string | null>(null);
    const [serverDetail, setServerDetail] = useState("");
    const [submitted, setSubmitted] = useState(false);
    const [verificationRequested, setVerificationRequested] = useState(false);

    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<SignupFormValues>({
        resolver: zodResolver(signupSchema),
        defaultValues: { name: "", email: "", password: "", passwordConfirm: "" },
    });

    const submit = handleSubmit(async (values) => {
        setServerError(null);
        setServerDetail("");
        try {
            await pb.collection("users").create(buildSignupPayload(values));
        } catch (err) {
            if (err instanceof ClientResponseError && errorStatus(err) === 429) {
                setServerError("signup.error.rateLimited");
            } else if (err instanceof ClientResponseError) {
                setServerError("signup.error.generic");
                setServerDetail(serverMessage(err));
            } else {
                setServerError("signup.error.generic");
            }
            return;
        }

        // PocketBase's email verification flow: ask for the confirmation
        // mail. Failures are not fatal here - without a configured SMTP
        // transport the account simply waits unverified (the profile page
        // can re-request the mail).
        try {
            await pb.collection("users").requestVerification(values.email);
            setVerificationRequested(true);
        } catch {
            setVerificationRequested(false);
        }
        setSubmitted(true);
    });

    if (submitted) {
        return (
            <section className="card state-success">
                <h1>{t("signup.success.title")}</h1>
                <p>{t("signup.success.stepEmail")}</p>
                <p>
                    {verificationRequested
                        ? t("signup.success.stepEmailSent")
                        : t("signup.success.stepEmailMaybe")}
                </p>
                <p>{t("signup.success.stepApproval")}</p>
                <div className="btn-row">
                    <button
                        type="button"
                        className="btn"
                        onClick={() => navigate("/login")}
                    >
                        {t("signup.success.toLogin")}
                    </button>
                    <Link className="btn btn-outline" to="/">
                        {t("signup.success.back")}
                    </Link>
                </div>
            </section>
        );
    }

    return (
        <>
            <h1>{t("signup.heading")}</h1>
            <p className="hint">{t("signup.intro")}</p>
            <form className="card form" onSubmit={submit} noValidate>
                <div className="field">
                    <label htmlFor="signup-name">{t("signup.name")}</label>
                    <input
                        id="signup-name"
                        type="text"
                        maxLength={200}
                        autoComplete="name"
                        {...register("name")}
                    />
                    {errors.name && (
                        <p className="field-error">{t(errors.name.message ?? "")}</p>
                    )}
                </div>

                <div className="field">
                    <label htmlFor="signup-email">{t("signup.email")}</label>
                    <input
                        id="signup-email"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        {...register("email")}
                    />
                    <p className="hint">{t("signup.emailHint")}</p>
                    {errors.email && (
                        <p className="field-error">{t(errors.email.message ?? "")}</p>
                    )}
                </div>

                <div className="field">
                    <label htmlFor="signup-password">{t("signup.password")}</label>
                    <input
                        id="signup-password"
                        type="password"
                        autoComplete="new-password"
                        {...register("password")}
                    />
                    {errors.password && (
                        <p className="field-error">{t(errors.password.message ?? "")}</p>
                    )}
                </div>

                <div className="field">
                    <label htmlFor="signup-password-confirm">
                        {t("signup.passwordConfirm")}
                    </label>
                    <input
                        id="signup-password-confirm"
                        type="password"
                        autoComplete="new-password"
                        {...register("passwordConfirm")}
                    />
                    {errors.passwordConfirm && (
                        <p className="field-error">
                            {t(errors.passwordConfirm.message ?? "")}
                        </p>
                    )}
                </div>

                {serverError && (
                    <div className="form-error">
                        {t(serverError)}
                        {serverDetail && ` (${serverDetail})`}
                    </div>
                )}

                <div className="btn-row">
                    <button type="submit" className="btn" disabled={isSubmitting}>
                        {isSubmitting ? t("signup.submitting") : t("signup.submit")}
                    </button>
                </div>
            </form>
            <p className="hint">
                <Link to="/login">{t("signup.toLogin")}</Link>
            </p>
        </>
    );
}
