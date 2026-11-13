import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ClientResponseError } from "pocketbase";

import { pb } from "../lib/pbClient";
import { errorStatus, fieldErrors } from "../lib/pbErrors";
import {
    buildSuggestionPayload,
    suggestionSchema,
    type SuggestionFormValues,
} from "../lib/validation";

// Zod error messages are i18n keys; messages coming from the PocketBase
// field validators are English server content and shown as-is.
function messageText(message: string | undefined, t: TFunction): string {
    if (!message) return "";
    if (message.startsWith("validation.")) {
        return t(message);
    }
    return message;
}

function FormError({ message, t }: { message?: string; t: TFunction }) {
    if (!message) return null;
    return <p className="field-error">{messageText(message, t)}</p>;
}

// Public suggestion form (plan.md "Public submission routes"): the
// createRule forces status='pending' (sent in the payload), no
// decision fields are ever sent. The hidden honeypot field must stay
// empty and form_started_at (epoch ms, set on mount) must be >= 3 s
// old - both are enforced again server-side (hooks/trap.go).
export default function NewSuggestion() {
    const { t } = useTranslation();

    // time-trap: the moment this page mounted
    const startedAt = useRef(Date.now());

    const [submitted, setSubmitted] = useState(false);
    const [serverError, setServerError] = useState<string | null>(null);

    const {
        register,
        handleSubmit,
        reset,
        setError,
        watch,
        formState: { errors, isSubmitting },
    } = useForm<SuggestionFormValues>({
        resolver: zodResolver(suggestionSchema),
        defaultValues: {
            title: "",
            description: "",
            date_start: "",
            date_end: "",
            all_day: false,
            location: "",
            category: "",
            email: "",
            honeypot: "",
        },
    });

    const allDay = watch("all_day");
    const dateInputType = allDay ? "date" : "datetime-local";

    const submit = handleSubmit(async (values) => {
        setServerError(null);
        try {
            await pb
                .collection("suggestions")
                .create(buildSuggestionPayload(values, startedAt.current));
            setSubmitted(true);
        } catch (error) {
            if (error instanceof ClientResponseError && errorStatus(error) === 429) {
                // 5 submissions / 10 min / IP (settings migration)
                setServerError("suggestion.error.rateLimited");
            } else if (
                error instanceof ClientResponseError &&
                errorStatus(error) === 400
            ) {
                // map PocketBase's field failures onto the form
                const serverFieldErrors = fieldErrors(error);
                for (const [field, message] of Object.entries(serverFieldErrors)) {
                    setError(field as keyof SuggestionFormValues, { message });
                }
                if (Object.keys(serverFieldErrors).length === 0) {
                    // not a field error: honeypot/time-trap rejection
                    setServerError("suggestion.error.trapFailed");
                }
            } else {
                setServerError("suggestion.error.generic");
            }
        }
    });

    const resetForm = () => {
        startedAt.current = Date.now(); // fresh time-trap window
        reset();
        setSubmitted(false);
        setServerError(null);
    };

    if (submitted) {
        return (
            <section className="card state-success">
                <h1>{t("suggestion.success.title")}</h1>
                <p>{t("suggestion.success.text")}</p>
                <div className="btn-row">
                    <button
                        type="button"
                        className="btn btn-outline"
                        onClick={resetForm}
                    >
                        {t("suggestion.success.another")}
                    </button>
                    <Link className="btn" to="/">
                        {t("suggestion.success.back")}
                    </Link>
                </div>
            </section>
        );
    }

    return (
        <>
            <h1>{t("suggestion.heading")}</h1>
            <p className="hint">{t("suggestion.intro")}</p>
            <form className="card form" onSubmit={submit} noValidate>
                <div className="field">
                    <label htmlFor="suggestion-title">{t("suggestion.title")}</label>
                    <input
                        id="suggestion-title"
                        type="text"
                        maxLength={200}
                        {...register("title")}
                    />
                    <FormError message={errors.title?.message} t={t} />
                </div>

                <div className="field">
                    <label htmlFor="suggestion-description">
                        {t("suggestion.description")}
                    </label>
                    <textarea
                        id="suggestion-description"
                        rows={4}
                        maxLength={5000}
                        {...register("description")}
                    />
                    <FormError message={errors.description?.message} t={t} />
                </div>

                <div className="field field-inline">
                    <label>
                        <input type="checkbox" {...register("all_day")} />
                        {t("suggestion.allDay")}
                    </label>
                </div>

                <div className="field">
                    <label htmlFor="suggestion-date-start">
                        {t("suggestion.dateStart")}
                    </label>
                    <input
                        id="suggestion-date-start"
                        type={dateInputType}
                        {...register("date_start")}
                    />
                    <FormError message={errors.date_start?.message} t={t} />
                </div>

                <div className="field">
                    <label htmlFor="suggestion-date-end">
                        {t("suggestion.dateEnd")}
                    </label>
                    <input
                        id="suggestion-date-end"
                        type={dateInputType}
                        {...register("date_end")}
                    />
                    <FormError message={errors.date_end?.message} t={t} />
                </div>

                <div className="field">
                    <label htmlFor="suggestion-location">
                        {t("suggestion.location")}
                    </label>
                    <input
                        id="suggestion-location"
                        type="text"
                        maxLength={200}
                        {...register("location")}
                    />
                    <FormError message={errors.location?.message} t={t} />
                </div>

                <div className="field">
                    <label htmlFor="suggestion-category">
                        {t("suggestion.category")}
                    </label>
                    <input
                        id="suggestion-category"
                        type="text"
                        maxLength={100}
                        {...register("category")}
                    />
                    <FormError message={errors.category?.message} t={t} />
                </div>

                <div className="field">
                    <label htmlFor="suggestion-email">{t("suggestion.email")}</label>
                    <input
                        id="suggestion-email"
                        type="email"
                        inputMode="email"
                        {...register("email")}
                    />
                    <p className="hint">{t("suggestion.emailHint")}</p>
                    <FormError message={errors.email?.message} t={t} />
                </div>

                {/*
                    Honeypot: hidden from users (off-screen, not
                    focusable), populated by spam bots. Must stay empty -
                    enforced by the zod schema and again server-side.
                */}
                <div className="hp-field" aria-hidden="true">
                    <label htmlFor="suggestion-hp">{t("suggestion.hpLabel")}</label>
                    <input
                        id="suggestion-hp"
                        type="text"
                        tabIndex={-1}
                        autoComplete="off"
                        {...register("honeypot")}
                    />
                </div>

                {serverError && <div className="form-error">{t(serverError)}</div>}

                <div className="btn-row">
                    <button type="submit" className="btn" disabled={isSubmitting}>
                        {isSubmitting
                            ? t("suggestion.submitting")
                            : t("suggestion.submit")}
                    </button>
                </div>
            </form>
        </>
    );
}
