import { ClientResponseError } from "pocketbase";

// Small helpers around PocketBase's ClientResponseError so the pages
// can branch on the HTTP status (429 rate limit, 400 validation /
// transition error) without depending on the SDK error shape inline.

export function errorStatus(error: unknown): number {
    return error instanceof ClientResponseError ? error.status : 0;
}

// The API error message (English, e.g. the invalid transition messages
// from the workflow hooks). Shown as-is next to a localized explanation.
export function serverMessage(error: unknown): string {
    if (error instanceof ClientResponseError) {
        const message = error.response?.message;
        return typeof message === "string" ? message : "";
    }
    return "";
}

// PocketBase fails with its own message. Returned as
// { field name -> message }; safe to call for any error.
export function fieldErrors(error: ClientResponseError): Record<string, string> {
    const data = error.response?.data;
    if (!data || typeof data !== "object") {
        return {};
    }
    const result: Record<string, string> = {};
    for (const [field, detail] of Object.entries(data)) {
        if (
            detail &&
            typeof detail === "object" &&
            typeof (detail as { message?: unknown }).message === "string"
        ) {
            result[field] = (detail as { message: string }).message;
        }
    }
    return result;
}
