import { z } from "zod";

// Shared zod form schemas + the payload builders for the moderation
// decisions. Everything sendable lives here so it is unit-testable
// without rendering a component.

const FIELD_LIMITS = {
    title: 200,
    description: 5000,
    location: 200,
    category: 100,
    decisionNote: 2000,
} as const;

// Error message values are i18n keys resolved with t() in the pages.
function isParsableDate(value: string): boolean {
    if (!value) return false;
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime());
}

// A date or datetime-local input value ("YYYY-MM-DD" for all-day
// entries, "YYYY-MM-DDTHH:mm" otherwise) as ISO 8601 for PocketBase.
export function toPBDateTime(value: string, allDay: boolean): string {
    const normalized = allDay && value.includes("T")
        ? value.slice(0, 10) // datetime value kept from before the toggle
        : value;
    const local = allDay ? `${normalized}T00:00` : normalized;
    return new Date(local).toISOString();
}

export const suggestionSchema = z
    .object({
        title: z
            .string()
            .trim()
            .min(1, "validation.required")
            .max(FIELD_LIMITS.title, "validation.tooLong"),
        description: z.string().trim().max(FIELD_LIMITS.description, "validation.tooLong"),
        date_start: z
            .string()
            .min(1, "validation.required")
            .refine(isParsableDate, "validation.invalidDate"),
        date_end: z
            .string()
            .refine((v) => v === "" || isParsableDate(v), "validation.invalidDate"),
        all_day: z.boolean(),
        location: z.string().trim().max(FIELD_LIMITS.location, "validation.tooLong"),
        category: z.string().trim().max(FIELD_LIMITS.category, "validation.tooLong"),
        email: z
            .string()
            .trim()
            .min(1, "validation.required")
            .email("validation.invalidEmail"),
        // honeypot: hidden anti-spam field, must stay empty
        honeypot: z.string().refine((v) => v.trim() === "", "validation.submitFailed"),
    })
    .superRefine((values, ctx) => {
        if (values.date_end && isParsableDate(values.date_start) && isParsableDate(values.date_end)) {
            const start = new Date(values.date_start).getTime();
            const end = new Date(
                values.all_day ? `${values.date_end.slice(0, 10)}T00:00` : values.date_end,
            ).getTime();
            if (end < start) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["date_end"],
                    message: "validation.dateEndBeforeStart",
                });
            }
        }
    });

export type SuggestionFormValues = z.infer<typeof suggestionSchema>;

export interface SuggestionPayload {
    status: "pending";
    title: string;
    description: string;
    date_start: string;
    date_end?: string;
    all_day: boolean;
    location: string;
    category: string;
    email: string;
    honeypot: string;
    // epoch ms, set when the form is mounted (time-trap)
    form_started_at: number;
}

// Payload for the public suggestion create. The createRule forces
// status='pending' (sent here, never decided client-side beyond that)
// and forbids decision fields - none are sent. The submitter email is
// required so the Beirat decision can be reported back.
export function buildSuggestionPayload(
    values: SuggestionFormValues,
    formStartedAt: number,
): SuggestionPayload {
    const payload: SuggestionPayload = {
        status: "pending",
        title: values.title,
        description: values.description,
        date_start: toPBDateTime(values.date_start, values.all_day),
        all_day: values.all_day,
        location: values.location,
        category: values.category,
        email: values.email,
        honeypot: values.honeypot,
        form_started_at: formStartedAt,
    };
    if (values.date_end) {
        payload.date_end = toPBDateTime(values.date_end, values.all_day);
    }
    return payload;
}

export type SuggestionStatus = "accepted" | "rejected";

// The optional decision note mailed to the submitter on accept/reject.
export const decisionNoteSchema = z.string().max(FIELD_LIMITS.decisionNote);

// Beirat decision on a suggestion: status + optional decision_note
// (the note is mailed to the submitter, so it is trusted Beirat text).
export function buildSuggestionDecision(status: SuggestionStatus, note: string) {
    const payload: { status: SuggestionStatus; decision_note?: string } = { status };
    const trimmed = note.trim();
    if (trimmed) {
        if (trimmed.length > FIELD_LIMITS.decisionNote) {
            throw new Error("decision note too long");
        }
        payload.decision_note = trimmed;
    }
    return payload;
}

export type IssueVisibility = "community" | "private";

// Accepting a pending issue requires the visibility in the SAME
// request (pending -> open, decided by the Beirat).
export function buildIssueAccept(visibility: IssueVisibility) {
    return { status: "open" as const, visibility };
}

// Rejecting a pending issue sends the status only (pending -> rejected).
export function buildIssueReject() {
    return { status: "rejected" as const };
}

// The Beirat may only flip `approved` (never role/email/name).
export function buildUserApprovalPatch(approved: boolean) {
    return { approved };
}

// ---------------------------------------------------------------------------
// Public issue report (M8) - the form for POST /api/portal/issues.
//
// The upload itself is multipart/form-data (custom PocketBase route,
// hooks/submitIssue.go). Both lat and lng travel as plain strings - the
// server parses and validates them (NaN/Inf + bounding box) itself.

// Bounding box the location picker and the zod schema enforce. These are
// the same defaults as the backend (hooks/submitIssue.go issueBounds),
// which a deployment can override with PORTAL_MIN/MAX_LAT/LNG env vars.
// TODO(M11): deployment config must match on both sides - a single
// source (e.g. a /api/portal/config endpoint or build-time injection)
// is proposed in reviews/M8-handoff.md for the reviewer to decide.
export const ISSUE_BOUNDS = {
    minLat: 51.0,
    maxLat: 51.5,
    minLng: 7.0,
    maxLng: 7.5,
} as const;

export function isWithinIssueBounds(lat: number, lng: number): boolean {
    return (
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        lat >= ISSUE_BOUNDS.minLat &&
        lat <= ISSUE_BOUNDS.maxLat &&
        lng >= ISSUE_BOUNDS.minLng &&
        lng <= ISSUE_BOUNDS.maxLng
    );
}

// The maximum number of photos the server accepts (submitIssue.go).
export const MAX_PHOTOS = 5;

// parseable coordinate string within the bounding box
function coordinateSchema(axis: "lat" | "lng") {
    return z.string().min(1, "validation.locationRequired").superRefine((value, ctx) => {
            const parsed = Number(value);
            if (!Number.isFinite(parsed)) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: "validation.locationRequired" });
                return;
            }
            const inBounds = isWithinIssueBounds(
                axis === "lat" ? parsed : ISSUE_BOUNDS.minLat,
                axis === "lng" ? parsed : ISSUE_BOUNDS.minLng,
            );
            if (!inBounds) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: "validation.locationOutside" });
            }
        });
}

export const issueSchema = z
    .object({
        title: z
            .string()
            .trim()
            .min(1, "validation.required")
            .max(FIELD_LIMITS.title, "validation.tooLong"),
        description: z.string().trim().max(FIELD_LIMITS.description, "validation.tooLong"),
        category: z.string().trim().max(FIELD_LIMITS.category, "validation.tooLong"),
        lat: coordinateSchema("lat"),
        lng: coordinateSchema("lng"),
        // required: the decision is reported back by mail
        email: z
            .string()
            .trim()
            .min(1, "validation.required")
            .email("validation.invalidEmail"),
        // optional, matched to the issue_metas.name schema limit
        name: z.string().trim().max(200, "validation.tooLong"),
        // blobs produced by lib/exifStrip (re-encoded, EXIF-free)
        photos: z.array(z.instanceof(Blob)).max(MAX_PHOTOS, "validation.maxPhotos"),
        photo_consent: z.boolean(),
        // honeypot: hidden anti-spam field, must stay empty
        honeypot: z.string().refine((v) => v.trim() === "", "validation.submitFailed"),
    })
    .superRefine((values, ctx) => {
        if (values.photos.length > 0 && !values.photo_consent) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["photo_consent"],
                message: "validation.consentRequired",
            });
        }
    });

export type IssueFormValues = z.infer<typeof issueSchema>;

// Payload for POST /api/portal/issues: multipart/form-data with exactly
// the fields of the custom route contract (hooks/submitIssue.go). No
// status/visibility/coords-beyond-the-form are ever sent - the server
// owns them. photos[] is appended from the re-encoded blobs only
// (lib/exifStrip: the original files never leave the browser).
export function buildIssueFormData(
    values: IssueFormValues,
    photoBlobs: Blob[],
    formStartedAt: number,
): FormData {
    const data = new FormData();
    data.set("title", values.title);
    data.set("description", values.description);
    data.set("category", values.category);
    data.set("lat", values.lat);
    data.set("lng", values.lng);
    data.set("email", values.email);
    if (values.name) {
        data.set("name", values.name);
    }
    if (photoBlobs.length > 0) {
        // the server requires the consent flag when photos are attached
        data.set("photo_consent", values.photo_consent ? "true" : "false");
    }
    photoBlobs.forEach((blob, index) => {
        data.append("photos", blob, `photo-${index + 1}.jpg`);
    });
    data.set("honeypot", values.honeypot);
    data.set("form_started_at", String(formStartedAt));
    return data;
}
