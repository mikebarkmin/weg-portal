import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import MapPicker from "../components/MapPicker";
import PhotoInput, { type PreparedPhoto } from "../components/PhotoInput";
import {
    buildIssueFormData,
    issueSchema,
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

function FormError({ message, t }: { message?: string; t: TFunction }) {
    if (!message) return null;
    return <p className="field-error">{messageText(message, t)}</p>;
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
        resolver: zodResolver(issueSchema),
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
            const response = await fetch("/api/portal/issues", {
                method: "POST",
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
            <section className="card state-success">
                <h1>{t("issue.success.title")}</h1>
                <p>{t("issue.success.text")}</p>
                <div className="btn-row">
                    <button
                        type="button"
                        className="btn btn-outline"
                        onClick={resetForm}
                    >
                        {t("issue.success.another")}
                    </button>
                    <Link className="btn" to="/">
                        {t("issue.success.back")}
                    </Link>
                </div>
            </section>
        );
    }

    return (
        <>
            <h1>{t("issue.heading")}</h1>
            <p className="hint">{t("issue.intro")}</p>
            <form className="card form" onSubmit={submit} noValidate>
                <div className="field">
                    <label htmlFor="issue-title">{t("issue.title")}</label>
                    <input
                        id="issue-title"
                        type="text"
                        maxLength={200}
                        {...register("title")}
                    />
                    <FormError message={errors.title?.message} t={t} />
                </div>

                <div className="field">
                    <label htmlFor="issue-description">
                        {t("issue.description")}
                    </label>
                    <textarea
                        id="issue-description"
                        rows={4}
                        maxLength={5000}
                        {...register("description")}
                    />
                    <FormError message={errors.description?.message} t={t} />
                </div>

                <div className="field">
                    <label htmlFor="issue-category">{t("issue.category")}</label>
                    <input
                        id="issue-category"
                        type="text"
                        maxLength={100}
                        {...register("category")}
                    />
                    <FormError message={errors.category?.message} t={t} />
                </div>

                <div className="field">
                    <span className="field-label" id="issue-location-label">
                        {t("issue.location.label")}
                    </span>
                    <MapPicker lat={lat} lng={lng} onPick={pickLocation} />
                    <FormError message={errors.lat?.message || errors.lng?.message} t={t} />
                </div>

                <div className="field">
                    <span className="field-label" id="issue-photos-label">
                        {t("issue.photos.label")}
                    </span>
                    <PhotoInput photos={photos} onChange={changePhotos} />
                    <FormError message={errors.photos?.message} t={t} />
                </div>

                {photos.length > 0 && (
                    <div className="field field-inline">
                        <label>
                            <input type="checkbox" {...register("photo_consent")} />
                            {t("issue.photoConsent")}
                        </label>
                        <FormError message={errors.photo_consent?.message} t={t} />
                    </div>
                )}

                <div className="field">
                    <label htmlFor="issue-email">{t("issue.email")}</label>
                    <input
                        id="issue-email"
                        type="email"
                        inputMode="email"
                        {...register("email")}
                    />
                    <p className="hint">{t("issue.emailHint")}</p>
                    <FormError message={errors.email?.message} t={t} />
                </div>

                <div className="field">
                    <label htmlFor="issue-name">{t("issue.name")}</label>
                    <input
                        id="issue-name"
                        type="text"
                        maxLength={200}
                        {...register("name")}
                    />
                    <FormError message={errors.name?.message} t={t} />
                </div>

                {/*
                    Honeypot: hidden from users (off-screen, not
                    focusable), populated by spam bots. Must stay empty -
                    enforced by the zod schema and again server-side.
                */}
                <div className="hp-field" aria-hidden="true">
                    <label htmlFor="issue-hp">{t("issue.hpLabel")}</label>
                    <input
                        id="issue-hp"
                        type="text"
                        tabIndex={-1}
                        autoComplete="off"
                        {...register("honeypot")}
                    />
                </div>

                {serverError && (
                    <div className="form-error">
                        {t(serverError)}
                        {serverMessage && ` (${serverMessage})`}
                    </div>
                )}

                <div className="btn-row">
                    <button type="submit" className="btn" disabled={isSubmitting}>
                        {isSubmitting
                            ? t("issue.submitting")
                            : t("issue.submit")}
                    </button>
                </div>
            </form>
        </>
    );
}
