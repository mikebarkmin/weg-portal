import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";

import { Wrapper } from "../components/Page";
import FormField from "../components/FormField";
import Notice from "../components/Notice";
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
            <Wrapper size="sm">
                <Notice
                    icon="ri-mail-check-line"
                    tone="success"
                    title={t("signup.success.title")}
                    actions={
                        <>
                            <Link className="btn secondary" to="/">
                                {t("signup.success.back")}
                            </Link>
                            <button type="button" className="btn" onClick={() => navigate("/login")}>
                                {t("signup.success.toLogin")}
                            </button>
                        </>
                    }
                >
                    <ol className="steps-list">
                        <li>
                            {t("signup.success.stepEmail")}{" "}
                            {verificationRequested
                                ? t("signup.success.stepEmailSent")
                                : t("signup.success.stepEmailMaybe")}
                        </li>
                        <li>{t("signup.success.stepApproval")}</li>
                    </ol>
                </Notice>
            </Wrapper>
        );
    }

    const err = (message?: string) => (message ? t(message) : null);

    return (
        <Wrapper size="sm">
            <form className="post auth-form" onSubmit={submit} noValidate>
                <header className="auth-form-header">
                    <h1 className="title">{t("signup.heading")}</h1>
                    <p className="txt-hint">{t("signup.intro")}</p>
                </header>
                <div className="grid sm">
                    <FormField id="signup-name" label={t("signup.name")} required error={err(errors.name?.message)}>
                        <input id="signup-name" type="text" maxLength={200} autoComplete="name" {...register("name")} />
                    </FormField>
                    <FormField
                        id="signup-email"
                        label={t("signup.email")}
                        required
                        hint={t("signup.emailHint")}
                        error={err(errors.email?.message)}
                    >
                        <input id="signup-email" type="email" inputMode="email" autoComplete="email" {...register("email")} />
                    </FormField>
                    <FormField id="signup-password" label={t("signup.password")} required error={err(errors.password?.message)}>
                        <input id="signup-password" type="password" autoComplete="new-password" {...register("password")} />
                    </FormField>
                    <FormField
                        id="signup-password-confirm"
                        label={t("signup.passwordConfirm")}
                        required
                        error={err(errors.passwordConfirm?.message)}
                    >
                        <input id="signup-password-confirm" type="password" autoComplete="new-password" {...register("passwordConfirm")} />
                    </FormField>
                    {serverError && (
                        <div className="col-12">
                            <div className="alert danger">
                                {t(serverError)}
                                {serverDetail && ` (${serverDetail})`}
                            </div>
                        </div>
                    )}
                    <div className="col-12">
                        <button type="submit" className={`btn full-width ${isSubmitting ? "loading" : ""}`} disabled={isSubmitting}>
                            <span className="txt">{isSubmitting ? t("signup.submitting") : t("signup.submit")}</span>
                        </button>
                    </div>
                </div>
            </form>
            <p className="auth-links txt-hint">
                <Link to="/login">{t("signup.toLogin")}</Link>
            </p>
        </Wrapper>
    );
}
