import { z } from "zod";

// Shared zod form schemas + the payload builders for the moderation
// decisions. Everything sendable lives here so it is unit-testable
// without rendering a component.

export const FIELD_LIMITS = {
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
//
// All-day entries are calendar DATES, not instants: they are stored as
// UTC midnight of the chosen date ("2026-12-24T00:00:00.000Z") so the
// iCal export (VALUE=DATE) and every viewer see the same day regardless
// of their UTC offset. Timed entries are local wall-clock -> UTC instant.
export function toPBDateTime(value: string, allDay: boolean): string {
    if (allDay) {
        return `${value.slice(0, 10)}T00:00:00.000Z`;
    }
    return new Date(value).toISOString();
}

// Submitter email of the public forms: required for guests (the decision
// is reported back by mail), not asked for when logged in - the server
// then uses the account address (hooks/submitIssue.go, suggestionCreate.go).
function submitterEmailSchema(loggedIn: boolean) {
    const email = z.string().trim();
    return loggedIn
        ? email
        : email.min(1, "validation.required").email("validation.invalidEmail");
}

export function makeSuggestionSchema(loggedIn: boolean) {
    return z
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
        email: submitterEmailSchema(loggedIn),
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
}

// The guest variant (email required).
export const suggestionSchema = makeSuggestionSchema(false);

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
    // omitted when logged in (the server uses the account address)
    email?: string;
    honeypot: string;
    // epoch ms, set when the form is mounted (time-trap)
    form_started_at: number;
}

// Payload for the public suggestion create. The createRule forces
// status='pending' (sent here, never decided client-side beyond that)
// and forbids decision fields - none are sent. Guests must give an email
// so the Beirat decision can be reported back; for logged-in users the
// server sets the account address, so an empty email is not sent.
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
        honeypot: values.honeypot,
        form_started_at: formStartedAt,
    };
    if (values.email) {
        payload.email = values.email;
    }
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

// Bounding box the location picker and the zod schema enforce. The
// values below are only the fallback (same defaults as the backend's
// hooks/submitIssue.go issueBounds): at startup lib/portalConfig.ts loads
// the deployment's real box (PORTAL_MIN/MAX_LAT/LNG env vars) from
// GET /api/portal/config and applies it with applyIssueBounds(), so the
// client and the server always validate against the same area.
export interface IssueBounds {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
}

export const ISSUE_BOUNDS: IssueBounds = {
    minLat: 51.0,
    maxLat: 51.5,
    minLng: 7.0,
    maxLng: 7.5,
};

// Replaces the bounding box (ignored unless it is a well-formed box).
export function applyIssueBounds(bounds: Partial<IssueBounds> | null | undefined): boolean {
    if (!bounds) return false;
    const { minLat, maxLat, minLng, maxLng } = bounds;
    const values = [minLat, maxLat, minLng, maxLng];
    if (!values.every((v) => typeof v === "number" && Number.isFinite(v))) {
        return false;
    }
    if (!(minLat! < maxLat! && minLng! < maxLng!)) {
        return false;
    }
    Object.assign(ISSUE_BOUNDS, { minLat, maxLat, minLng, maxLng });
    return true;
}

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

// parseable coordinate string within the bounding box; "" = no location
// (the map point is optional, but lat and lng come as a pair)
function coordinateSchema(axis: "lat" | "lng") {
    return z.string().superRefine((value, ctx) => {
            if (value === "") return;
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

export function makeIssueSchema(loggedIn: boolean) {
    return z
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
        // guests only: the decision is reported back by mail
        email: submitterEmailSchema(loggedIn),
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
        if ((values.lat === "") !== (values.lng === "")) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [values.lat === "" ? "lat" : "lng"],
                message: "validation.locationRequired",
            });
        }
    });
}

// The guest variant (email required).
export const issueSchema = makeIssueSchema(false);

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
    if (values.lat !== "" && values.lng !== "") {
        data.set("lat", values.lat);
        data.set("lng", values.lng);
    }
    if (values.email) {
        data.set("email", values.email);
    }
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
