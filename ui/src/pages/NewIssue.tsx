import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import MapPicker from "../components/MapPicker";
import { BackLink, Page, PageHeading, SidebarMenu, Wrapper } from "../components/Page";
import FormField, { SwitchField } from "../components/FormField";
import Notice from "../components/Notice";
import PhotoInput, { type PreparedPhoto } from "../components/PhotoInput";
import { useAuth } from "../lib/auth";
import { pb } from "../lib/pbClient";
import {
    buildIssueFormData,
    makeIssueSchema,
    type IssueFormValues,
} from "../lib/validation";

// Zod error messages are i18n keys; messages coming from the custom
// submission route are English server content and shown as-is (M7
// convention).
function messageText(message: string | undefined, t: TFunction): string {
    if (!message) return "";
    if (message.startsWith("validation.")) {
        return t(message);
    }
    return message;
}


// Response shape of the custom route (hooks/submitIssue.go):
// 200 -> {"ok": true}, 400/429 -> PocketBase error JSON.
function serverErrorMessage(body: unknown): string {
    if (body && typeof body === "object") {
        const message = (body as { message?: unknown }).message;
        if (typeof message === "string" && message !== "") {
            return message;
        }
    }
    return "";
}

// Public issue report form (plan.md "Public submission routes"). The
// upload goes to the custom multipart route POST /api/portal/issues
// with fetch() - the PocketBase SDK create would send JSON and cannot
// attach multipart file fields to a custom route. Only re-encoded,
// EXIF-free photo blobs are ever submitted (components/PhotoInput).
export default function NewIssue() {
    const { t } = useTranslation();
    // logged-in users report under their account (no email/name fields)
    const { isAuthenticated } = useAuth();
    const schema = useMemo(() => makeIssueSchema(isAuthenticated), [isAuthenticated]);

    // time-trap: the moment this page mounted
    const startedAt = useRef(Date.now());

    const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
    const photosRef = useRef<PreparedPhoto[]>([]);

    const [submitted, setSubmitted] = useState(false);
    const [serverError, setServerError] = useState<string | null>(null);
    const [serverMessage, setServerMessage] = useState("");

    const {
        register,
        handleSubmit,
        reset,
        setValue,
        watch,
        formState: { errors, isSubmitting },
    } = useForm<IssueFormValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            title: "",
            description: "",
            category: "",
            lat: "",
            lng: "",
            email: "",
            name: "",
            photos: [],
            photo_consent: false,
            honeypot: "",
        },
    });

    // release the preview object URLs when the page goes away
    useEffect(() => {
        photosRef.current = photos;
    }, [photos]);
    useEffect(() => {
        return () => {
            for (const photo of photosRef.current) {
                URL.revokeObjectURL(photo.url);
            }
        };
    }, []);

    const lat = watch("lat");
    const lng = watch("lng");

    const pickLocation = (newLat: string, newLng: string) => {
        setValue("lat", newLat, { shouldValidate: true });
        setValue("lng", newLng, { shouldValidate: true });
    };
    const clearLocation = () => pickLocation("", "");

    const changePhotos = (next: PreparedPhoto[]) => {
        // the zod schema audits the blob list (count + consent coupling)
        setPhotos(next);
        setValue("photos", next.map((photo) => photo.blob), { shouldValidate: true });
    };

    const submit = handleSubmit(async (values) => {
        setServerError(null);
        setServerMessage("");
        try {
            const data = buildIssueFormData(
                values,
                photos.map((photo) => photo.blob),
                startedAt.current,
            );
            // the token links the report to the account (and its email)
            const headers: Record<string, string> = {};
            if (pb.authStore.isValid && pb.authStore.token) {
                headers["Authorization"] = pb.authStore.token;
            }
            const response = await fetch("/api/portal/issues", {
                method: "POST",
                headers,
                body: data, // multipart/form-data with boundary set by the browser
            });

            if (response.ok) {
                setSubmitted(true);
                return;
            }

            const body = await response.json().catch(() => null);
            setServerMessage(serverErrorMessage(body));
            if (response.status === 429) {
                // 5 submissions / 10 min / IP (settings migration)
                setServerError("issue.error.rateLimited");
            } else if (response.status === 400) {
                setServerError("issue.error.rejected");
            } else {
                setServerError("issue.error.generic");
            }
        } catch {
            setServerError("issue.error.generic");
        }
    });

    const resetForm = () => {
        startedAt.current = Date.now(); // fresh time-trap window
        for (const photo of photosRef.current) {
            URL.revokeObjectURL(photo.url);
        }
        setPhotos([]);
        reset();
        setSubmitted(false);
        setServerError(null);
        setServerMessage("");
    };

    if (submitted) {
        return (
            <Wrapper size="sm">
                <Notice
                    icon="ri-checkbox-circle-line"
                    tone="success"
                    title={t("issue.success.title")}
                    actions={
                        <>
                            <button type="button" className="btn secondary" onClick={resetForm}>
                                {t("issue.success.another")}
                            </button>
                            <Link className="btn" to="/">
                                {t("issue.success.back")}
                            </Link>
                        </>
                    }
                >
                    <p>{t("issue.success.text")}</p>
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
                        <BackLink to="/">{t("home.back")}</BackLink>
                    </SidebarMenu>
                    <p className="txt-hint sidebar-text">{t("issue.intro")}</p>
                </>
            }
        >
            <PageHeading title={t("issue.heading")} />
            <form className="post" onSubmit={submit} noValidate>
                <div className="grid sm">
                    <FormField id="issue-title" label={t("issue.title")} required error={err(errors.title?.message)}>
                        <input id="issue-title" type="text" maxLength={200} autoComplete="off" {...register("title")} />
                    </FormField>

                    <FormField id="issue-description" label={t("issue.description")} error={err(errors.description?.message)}>
                        <textarea id="issue-description" rows={4} maxLength={5000} {...register("description")} />
                    </FormField>

                    <FormField id="issue-category" label={t("issue.category")} error={err(errors.category?.message)}>
                        <input id="issue-category" type="text" maxLength={100} {...register("category")} />
                    </FormField>

                    <div className="col-12">
                        <div className="field-group-label" id="issue-location-label">
                            {t("issue.location.label")}
                        </div>
                        <MapPicker lat={lat} lng={lng} onPick={pickLocation} onClear={clearLocation} />
                        {(errors.lat?.message || errors.lng?.message) && (
                            <div className="field-help error" role="alert">
                                {err(errors.lat?.message || errors.lng?.message)}
                            </div>
                        )}
                    </div>

                    <div className="col-12">
                        <div className="field-group-label" id="issue-photos-label">
                            {t("issue.photos.label")}
                        </div>
                        <PhotoInput photos={photos} onChange={changePhotos} />
                        {errors.photos?.message && (
                            <div className="field-help error" role="alert">{err(errors.photos.message)}</div>
                        )}
                    </div>

                    {photos.length > 0 && (
                        <SwitchField
                            id="issue-photo-consent"
                            label={t("issue.photoConsent")}
                            error={err(errors.photo_consent?.message)}
                            {...register("photo_consent")}
                        />
                    )}

                    {!isAuthenticated && (
                        <FormField
                            id="issue-email"
                            className="col-12 col-md-6"
                            label={t("issue.email")}
                            required
                            hint={t("issue.emailHint")}
                            error={err(errors.email?.message)}
                        >
                            <input id="issue-email" type="email" inputMode="email" autoComplete="email" {...register("email")} />
                        </FormField>
                    )}

                    {!isAuthenticated && (
                        <FormField
                            id="issue-name"
                            className="col-12 col-md-6"
                            label={t("issue.name")}
                            error={err(errors.name?.message)}
                        >
                            <input id="issue-name" type="text" maxLength={200} autoComplete="name" {...register("name")} />
                        </FormField>
                    )}

                    {/*
                        Honeypot: hidden from users (off-screen, not
                        focusable), populated by spam bots. Must stay empty -
                        enforced by the zod schema and again server-side.
                    */}
                    <div className="hp-field" aria-hidden="true">
                        <label htmlFor="issue-hp">{t("issue.hpLabel")}</label>
                        <input id="issue-hp" type="text" tabIndex={-1} autoComplete="off" {...register("honeypot")} />
                    </div>

                    {serverError && (
                        <div className="col-12">
                            <div className="alert danger">
                                {t(serverError)}
                                {serverMessage && ` (${serverMessage})`}
                            </div>
                        </div>
                    )}

                    <div className="col-12">
                        <footer className="form-footer">
                            <button type="submit" className={`btn expanded-lg ${isSubmitting ? "loading" : ""}`} disabled={isSubmitting}>
                                <span className="txt">{isSubmitting ? t("issue.submitting") : t("issue.submit")}</span>
                            </button>
                        </footer>
                    </div>
                </div>
            </form>
        </Page>
    );
}
