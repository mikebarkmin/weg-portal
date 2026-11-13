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
