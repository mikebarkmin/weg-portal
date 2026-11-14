import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ClientResponseError } from "pocketbase";

import { pb } from "../lib/pbClient";
import { useAuth } from "../lib/auth";
import { BackLink, Page, PageHeading, SidebarMenu, Wrapper } from "../components/Page";
import FormField, { SwitchField } from "../components/FormField";
import Notice from "../components/Notice";
import { errorStatus, fieldErrors } from "../lib/pbErrors";
import {
    buildSuggestionPayload,
    makeSuggestionSchema,
    type SuggestionFormValues,
} from "../lib/validation";
import {
    buildRRule,
    parseEditableRule,
    validateRecurrence,
    type RecurrenceErrors,
    type RecurrenceValues,
} from "../lib/eventForm";
import RecurrenceFields from "../components/RecurrenceFields";

// Zod error messages are i18n keys; messages coming from the PocketBase
// field validators are English server content and shown as-is.
function messageText(message: string | undefined, t: TFunction): string {
    if (!message) return "";
    if (message.startsWith("validation.")) {
        return t(message);
    }
    return message;
}


// Public suggestion form (plan.md "Public submission routes"): the
// createRule forces status='pending' (sent in the payload), no
// decision fields are ever sent. The hidden honeypot field must stay
// empty and form_started_at (epoch ms, set on mount) must be >= 3 s
// old - both are enforced again server-side (hooks/trap.go).
export default function NewSuggestion() {
    const { t } = useTranslation();
    // logged-in users are contacted at their account address (no email field)
    const { isAuthenticated } = useAuth();
    const schema = useMemo(() => makeSuggestionSchema(isAuthenticated), [isAuthenticated]);

    // time-trap: the moment this page mounted
    const startedAt = useRef(Date.now());

    // the optional repetition of the meeting (freq/interval/... up to the
    // RFC 5545 rule built on submit; all_day is taken from the form)
    const [recurrence, setRecurrence] = useState<RecurrenceValues>(() => ({ all_day: false, ...parseEditableRule("") }));
    const [recErrors, setRecErrors] = useState<RecurrenceErrors>({});

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
        resolver: zodResolver(schema),
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
        const found = validateRecurrence({ ...recurrence, all_day: values.all_day }, values.date_start);
        setRecErrors(found);
        if (Object.keys(found).length > 0) {
            return;
        }
        try {
            await pb
                .collection("suggestions")
                .create(
                    buildSuggestionPayload(
                        values,
                        startedAt.current,
                        buildRRule({ ...recurrence, all_day: values.all_day }),
                    ),
                );
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
        setRecurrence({ all_day: false, ...parseEditableRule("") });
        setRecErrors({});
        setSubmitted(false);
        setServerError(null);
    };

    if (submitted) {
        return (
            <Wrapper size="sm">
                <Notice
                    icon="ri-checkbox-circle-line"
                    tone="success"
                    title={t("suggestion.success.title")}
                    actions={
                        <>
                            <button type="button" className="btn secondary" onClick={resetForm}>
                                {t("suggestion.success.another")}
                            </button>
                            <Link className="btn" to="/kalender">
                                {t("suggestion.success.back")}
                            </Link>
                        </>
                    }
                >
                    <p>{t("suggestion.success.text")}</p>
                </Notice>
            </Wrapper>
        );
    }

    const err = (message?: string) => (message ? messageText(message, t) : null);

    return (
        <Page
            sidebar={
                <>
                    <SidebarMenu>
                        <BackLink to="/kalender">{t("event.back")}</BackLink>
                    </SidebarMenu>
                    <p className="txt-hint sidebar-text">{t("suggestion.intro")}</p>
                </>
            }
        >
            <PageHeading title={t("suggestion.heading")} />
            <form className="post" onSubmit={submit} noValidate>
                <div className="grid sm">
                    <FormField id="suggestion-title" label={t("suggestion.title")} required error={err(errors.title?.message)}>
                        <input id="suggestion-title" type="text" maxLength={200} autoComplete="off" {...register("title")} />
                    </FormField>

                    <FormField id="suggestion-description" label={t("suggestion.description")} error={err(errors.description?.message)}>
                        <textarea id="suggestion-description" rows={4} maxLength={5000} {...register("description")} />
                    </FormField>

                    <SwitchField id="suggestion-all-day" label={t("suggestion.allDay")} {...register("all_day")} />

                    <FormField
                        id="suggestion-date-start"
                        className="col-12 col-md-6"
                        label={t("suggestion.dateStart")}
                        required
                        error={err(errors.date_start?.message)}
                    >
                        <input id="suggestion-date-start" type={dateInputType} {...register("date_start")} />
                    </FormField>

                    <FormField
                        id="suggestion-date-end"
                        className="col-12 col-md-6"
                        label={t("suggestion.dateEnd")}
                        error={err(errors.date_end?.message)}
                    >
                        <input id="suggestion-date-end" type={dateInputType} {...register("date_end")} />
                    </FormField>

                    <FormField
                        id="suggestion-location"
                        className="col-12 col-md-6"
                        label={t("suggestion.location")}
                        error={err(errors.location?.message)}
                    >
                        <input id="suggestion-location" type="text" maxLength={200} {...register("location")} />
                    </FormField>

                    <FormField
                        id="suggestion-category"
                        className="col-12 col-md-6"
                        label={t("suggestion.category")}
                        error={err(errors.category?.message)}
                    >
                        <input id="suggestion-category" type="text" maxLength={100} {...register("category")} />
                    </FormField>

                    <RecurrenceFields
                        idPrefix="suggestion"
                        values={{ ...recurrence, all_day: allDay }}
                        onChange={(patch) => setRecurrence((prev) => ({ ...prev, ...patch }))}
                        errors={recErrors}
                    />

                    {!isAuthenticated && (
                        <FormField
                            id="suggestion-email"
                            label={t("suggestion.email")}
                            required
                            hint={t("suggestion.emailHint")}
                            error={err(errors.email?.message)}
                        >
                            <input id="suggestion-email" type="email" inputMode="email" autoComplete="email" {...register("email")} />
                        </FormField>
                    )}

                    {/*
                        Honeypot: hidden from users (off-screen, not
                        focusable), populated by spam bots. Must stay empty -
                        enforced by the zod schema and again server-side.
                    */}
                    <div className="hp-field" aria-hidden="true">
                        <label htmlFor="suggestion-hp">{t("suggestion.hpLabel")}</label>
                        <input id="suggestion-hp" type="text" tabIndex={-1} autoComplete="off" {...register("honeypot")} />
                    </div>

                    {serverError && (
                        <div className="col-12">
                            <div className="alert danger">{t(serverError)}</div>
                        </div>
                    )}

                    <div className="col-12">
                        <footer className="form-footer">
                            <button type="submit" className={`btn expanded-lg ${isSubmitting ? "loading" : ""}`} disabled={isSubmitting}>
                                <span className="txt">{isSubmitting ? t("suggestion.submitting") : t("suggestion.submit")}</span>
                            </button>
                        </footer>
                    </div>
                </div>
            </form>
        </Page>
    );
}
