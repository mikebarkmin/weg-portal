// Editable legal pages (collection legal_pages): Markdown with placeholders
// for the current deletion periods, e.g. {{retention_issues_resolved_days}}.
// They are filled from GET /api/portal/retention when the page is shown, so
// the privacy policy always states the periods actually configured.

export type LegalSlug = "impressum" | "datenschutz";

export interface LegalPage {
    id: string;
    slug: LegalSlug;
    body: string;
    draft: boolean;
    updated: string;
    updated_by: string;
    expand?: { updated_by?: { id: string; name: string } };
}

export const RETENTION_PLACEHOLDERS = [
    "retention_suggestions_rejected_days",
    "retention_suggestions_accepted_days",
    "retention_issues_rejected_days",
    "retention_issues_resolved_days",
] as const;

// Replaces {{name}} with the value; unknown or missing values become "…"
// (never a guessed number in a legal text).
export function fillPlaceholders(body: string, values: Record<string, number> | null): string {
    return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name: string) => {
        const value = values?.[name];
        return typeof value === "number" && Number.isFinite(value) ? String(value) : "…";
    });
}
