import { describe, expect, it } from "vitest";

import {
    buildIssueAccept,
    buildIssueReject,
    buildSuggestionDecision,
    buildSuggestionPayload,
    buildUserApprovalPatch,
    toPBDateTime,
    suggestionSchema,
    type SuggestionFormValues,
} from "./validation";

function validValues(overrides: Partial<SuggestionFormValues> = {}): SuggestionFormValues {
    return {
        title: "Sommerfest am Hof",
        description: "Bitte eintragen",
        date_start: "2026-06-20T15:00",
        date_end: "",
        all_day: false,
        location: "Innenhof",
        category: "Fest",
        email: "bewohner@example.com",
        honeypot: "",
        ...overrides,
    };
}

describe("suggestionSchema", () => {
    it("accepts a complete valid form", () => {
        const result = suggestionSchema.safeParse(validValues());
        expect(result.success).toBe(true);
    });

    it("accepts a minimal form (only required fields)", () => {
        const result = suggestionSchema.safeParse(
            validValues({
                description: "",
                location: "",
                category: "",
                all_day: true,
                date_start: "2026-06-20",
            }),
        );
        expect(result.success).toBe(true);
    });

    it("rejects an empty title", () => {
        const result = suggestionSchema.safeParse(validValues({ title: " " }));
        expect(result.success).toBe(false);
    });

    it("rejects a title over 200 characters", () => {
        const result = suggestionSchema.safeParse(validValues({ title: "x".repeat(201) }));
        expect(result.success).toBe(false);
    });

    it("rejects a missing/invalid email", () => {
        expect(suggestionSchema.safeParse(validValues({ email: "" })).success).toBe(false);
        expect(
            suggestionSchema.safeParse(validValues({ email: "not-an-email" })).success,
        ).toBe(false);
    });

    it("rejects a missing date_start", () => {
        const result = suggestionSchema.safeParse(validValues({ date_start: "" }));
        expect(result.success).toBe(false);
    });

    it("rejects an unparsable date_start", () => {
        const result = suggestionSchema.safeParse(validValues({ date_start: "garbage" }));
        expect(result.success).toBe(false);
    });

    it("rejects a date_end before date_start", () => {
        const result = suggestionSchema.safeParse(
            validValues({ date_start: "2026-06-20T15:00", date_end: "2026-06-20T14:00" }),
        );
        expect(result.success).toBe(false);
        if (!result.success) {
            const fields = result.error.issues.map((issue) => issue.path.join("."));
            expect(fields).toContain("date_end");
        }
    });

    it("rejects a filled honeypot", () => {
        const result = suggestionSchema.safeParse(validValues({ honeypot: "spam" }));
        expect(result.success).toBe(false);
    });
});

describe("toPBDateTime", () => {
    it("emits ISO 8601 that parses back to the same instant", () => {
        const iso = toPBDateTime("2026-06-20T15:00", false);
        expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(new Date(iso).getTime()).toBe(new Date("2026-06-20T15:00").getTime());
    });

    it("treats an all-day date as local midnight", () => {
        const iso = toPBDateTime("2026-06-20", true);
        expect(new Date(iso).getTime()).toBe(new Date("2026-06-20T00:00").getTime());
    });

    it("keeps only the date part of a datetime value when all-day is toggled", () => {
        const iso = toPBDateTime("2026-06-20T15:00", true);
        expect(new Date(iso).getHours()).toBe(new Date("2026-06-20T00:00").getHours());
        expect(new Date(iso).getMinutes()).toBe(0);
    });
});

describe("buildSuggestionPayload", () => {
    it("forces status=pending and the trap fields", () => {
        const startedAt = 1234567890;
        const payload = buildSuggestionPayload(validValues(), startedAt);
        expect(payload.status).toBe("pending");
        expect(payload.honeypot).toBe("");
        expect(payload.form_started_at).toBe(startedAt);
        expect(payload.email).toBe("bewohner@example.com");
    });

    it("never contains decision fields", () => {
        const payload = buildSuggestionPayload(validValues(), Date.now());
        expect(payload).not.toHaveProperty("decision_note");
        expect(payload).not.toHaveProperty("decided_at");
    });

    it("omits an empty optional date_end", () => {
        const payload = buildSuggestionPayload(validValues({ date_end: "" }), 1);
        expect(payload.date_end).toBeUndefined();
    });

    it("includes a set date_end as ISO", () => {
        const payload = buildSuggestionPayload(
            validValues({ date_end: "2026-06-20T18:00" }),
            1,
        );
        expect(payload.date_end).toMatch(/Z$/);
    });
});

describe("moderation payload builders", () => {
    it("builds a suggestion accept with an optional trimmed note", () => {
        expect(buildSuggestionDecision("accepted", "  Danke!  ")).toEqual({
            status: "accepted",
            decision_note: "Danke!",
        });
    });

    it("omits an empty decision note", () => {
        expect(buildSuggestionDecision("rejected", "   ")).toEqual({
            status: "rejected",
        });
        expect(
            buildSuggestionDecision("rejected", "  ")
                .decision_note,
        ).toBeUndefined();
    });

    it("rejects an over-long decision note", () => {
        expect(() => buildSuggestionDecision("accepted", "x".repeat(2001))).toThrow();
    });

    it("builds the issue accept with status AND visibility in one payload", () => {
        expect(buildIssueAccept("community")).toEqual({
            status: "open",
            visibility: "community",
        });
        expect(buildIssueAccept("private")).toEqual({ status: "open", visibility: "private" });
    });

    it("builds the issue reject as status-only", () => {
        expect(buildIssueReject()).toEqual({ status: "rejected" });
        expect(buildIssueReject()).not.toHaveProperty("visibility");
    });

    it("builds the user approval patch as approved-only", () => {
        expect(buildUserApprovalPatch(true)).toEqual({ approved: true });
        expect(buildUserApprovalPatch(false)).toEqual({ approved: false });
        expect(buildUserApprovalPatch(true)).not.toHaveProperty("role");
    });
});
