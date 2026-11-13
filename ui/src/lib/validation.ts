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
    // users.name allows 255 (PocketBase default); stay below it
    name: 200,
    // notes.body (editor field) - generous client-side cap for
    // internal markdown notes, well inside PocketBase's editor limit
    noteBody: 20000,
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

// ---------------------------------------------------------------------------
// Accounts (M9) - signup + profile payloads and schemas.
//
// role, approved and verified are owned by the server: hooks/usersCreate.go
// forces them on create, the users update rule blocks them, and the email
// change goes through PocketBase's own flow only. No payload built here ever
// contains any of the three fields.

// PocketBase's minimum password length (PasswordAuth default).
export const MIN_PASSWORD_LENGTH = 8;

export const signupSchema = z
    .object({
        name: z
            .string()
            .trim()
            .min(1, "validation.required")
            .max(FIELD_LIMITS.name, "validation.tooLong"),
        email: z
            .string()
            .trim()
            .min(1, "validation.required")
            .email("validation.invalidEmail"),
        password: z.string().min(MIN_PASSWORD_LENGTH, "validation.passwordTooShort"),
        passwordConfirm: z
            .string()
            .min(MIN_PASSWORD_LENGTH, "validation.passwordTooShort"),
    })
    .superRefine((values, ctx) => {
        if (values.password !== values.passwordConfirm) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["passwordConfirm"],
                message: "validation.passwordMismatch",
            });
        }
    });

export type SignupFormValues = z.infer<typeof signupSchema>;

// Body for POST /api/collections/users/records. Only the four self-service
// fields are sent; the create hook forces role=resident, approved=false,
// verified=false (hooks/usersCreate.go).
export function buildSignupPayload(values: SignupFormValues) {
    return {
        name: values.name,
        email: values.email,
        password: values.password,
        passwordConfirm: values.passwordConfirm,
    };
}

// The name field shared by the profile page (same limits as the schema).
export const profileNameSchema = z
    .string()
    .trim()
    .min(1, "validation.required")
    .max(FIELD_LIMITS.name, "validation.tooLong");

export const passwordChangeSchema = z
    .object({
        oldPassword: z.string().min(1, "validation.required"),
        password: z.string().min(MIN_PASSWORD_LENGTH, "validation.passwordTooShort"),
        passwordConfirm: z
            .string()
            .min(MIN_PASSWORD_LENGTH, "validation.passwordTooShort"),
    })
    .superRefine((values, ctx) => {
        if (values.password !== values.passwordConfirm) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["passwordConfirm"],
                message: "validation.passwordMismatch",
            });
        }
    });

export type PasswordChangeValues = z.infer<typeof passwordChangeSchema>;

// Own-record update via the regular users update endpoint: the name and
// (for hausmeister/hausverwaltung) the notify_new_issues flag. Nothing else
// is ever sent - role/approved/verified must not be editable (plan.md
// "Users: updates and approval").
export function buildProfileUpdate(
    name: string,
    options: { notifyNewIssues?: boolean } = {},
): { name: string; notify_new_issues?: boolean } {
    const patch: { name: string; notify_new_issues?: boolean } = {
        name: profileNameSchema.parse(name),
    };
    if (options.notifyNewIssues !== undefined) {
        patch.notify_new_issues = options.notifyNewIssues;
    }
    return patch;
}

// Changing the password is an own-record update with PocketBase's special
// oldPassword field (required for non-superusers).
export function buildPasswordUpdate(values: PasswordChangeValues) {
    return {
        oldPassword: values.oldPassword,
        password: values.password,
        passwordConfirm: values.passwordConfirm,
    };
}

// ---------------------------------------------------------------------------
// Issue status transitions (M9) - the client mirror of the server-side
// diagram enforced by hooks/issueWorkflow.go:
//
// pending --accept (beirat, must set visibility)--> open --> in_progress --> resolved
//    \--reject (beirat)--> rejected
//
// Everything else is rejected with 400 by the hook - for every role. The
// pages use these helpers to enable ONLY the next steps that are valid for
// the caller's role; the server stays authoritative regardless.

export const ISSUE_STATUSES = [
    "pending",
    "open",
    "in_progress",
    "resolved",
    "rejected",
] as const;

export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export interface IssueTransition {
    // the next status the role may set from the current one
    status: IssueStatus;
    // beirat accept: the visibility must be decided in the SAME request
    requiresVisibility: boolean;
}

const BEIRAT_NEXT: Record<IssueStatus, IssueStatus[]> = {
    pending: ["open", "rejected"],
    open: ["in_progress"],
    in_progress: ["resolved"],
    resolved: [],
    rejected: [],
};

// The hausmeister rule whitelists status changes from open/in_progress only.
const HAUSMEISTER_NEXT: Record<IssueStatus, IssueStatus[]> = {
    pending: [],
    open: ["in_progress"],
    in_progress: ["resolved"],
    resolved: [],
    rejected: [],
};

// The hausverwaltung is read-only; residents never change statuses.
const NO_NEXT: Record<IssueStatus, IssueStatus[]> = {
    pending: [],
    open: [],
    in_progress: [],
    resolved: [],
    rejected: [],
};

export function issueTransitionsFor(
    role: string,
    status: IssueStatus,
): IssueTransition[] {
    const next =
        role === "beirat"
            ? BEIRAT_NEXT[status]
            : role === "hausmeister"
              ? HAUSMEISTER_NEXT[status]
              : NO_NEXT[status];
    return next.map((nextStatus) => ({
        status: nextStatus,
        requiresVisibility: status === "pending" && nextStatus === "open",
    }));
}

// The update body for a status transition. Throws when the role may not
// perform that transition from the current status (the UI never offers
// those buttons anyway - this guards against programming mistakes that
// the server would otherwise answer with 400).
export function buildIssueStatusUpdate(
    role: string,
    current: IssueStatus,
    next: IssueStatus,
    visibility?: IssueVisibility,
): { status: IssueStatus; visibility?: IssueVisibility } {
    const transition = issueTransitionsFor(role, current).find(
        (candidate) => candidate.status === next,
    );
    if (!transition) {
        throw new Error(`invalid transition for ${role}: ${current} -> ${next}`);
    }
    if (transition.requiresVisibility) {
        if (visibility !== "community" && visibility !== "private") {
            throw new Error("accepting a pending issue requires the visibility");
        }
        return { status: next, visibility };
    }
    return { status: next };
}

// ---------------------------------------------------------------------------
// Notes (M10) - the Beirat's internal markdown notes. The payloads are
// pure data builders: `author` is ONLY ever set from the auth store and
// only for the create request (the create rule requires
// @request.body.author = @request.auth.id); it is NEVER part of an
// update payload, so a client cannot re-attribute a note.

export const noteSchema = z.object({
    title: z
        .string()
        .trim()
        .min(1, "validation.required")
        .max(FIELD_LIMITS.title, "validation.tooLong"),
    // raw markdown, rendered + sanitized client-side (lib/markdown.ts)
    body: z
        .string()
        .trim()
        .min(1, "validation.required")
        .max(FIELD_LIMITS.noteBody, "validation.tooLong"),
});

export type NoteFormValues = z.infer<typeof noteSchema>;

// Create payload: `author` comes from the caller (pb.authStore), never
// from form input, and matches @request.auth.id by construction.
export function buildNoteCreate(
    values: NoteFormValues,
    authorId: string,
): { title: string; body: string; author: string; pinned: boolean } {
    return {
        title: values.title,
        body: values.body,
        author: authorId,
        pinned: false,
    };
}

// Update payload: title/body only - `author` is deliberately absent so
// the note can never be re-attributed through the client.
export function buildNoteUpdate(values: NoteFormValues): { title: string; body: string } {
    return {
        title: values.title,
        body: values.body,
    };
}

// Pin/unpin payload (sent on its own, without content fields).
export function buildNotePinUpdate(pinned: boolean): { pinned: boolean } {
    return { pinned };
}
