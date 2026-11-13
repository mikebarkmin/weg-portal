import { describe, expect, it } from "vitest";

import {
    buildIssueAccept,
    buildIssueFormData,
    buildIssueReject,
    buildNoteCreate,
    buildNoteUpdate,
    buildSuggestionDecision,
    buildSuggestionPayload,
    buildUserApprovalPatch,
    toPBDateTime,
    noteSchema,
    suggestionSchema,
    issueSchema,
    isWithinIssueBounds,
    MAX_PHOTOS,
    type IssueFormValues,
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

// --- issue report form (M8) -------------------------------------------------

function validIssueValues(overrides: Partial<IssueFormValues> = {}): IssueFormValues {
    return {
        title: "Kaputte Laterne",
        description: "Die Laterne am Hintereingang leuchtet nicht.",
        category: "Beleuchtung",
        lat: "51.24812",
        lng: "7.21222",
        email: "bewohner@example.com",
        name: "Anna",
        photos: [],
        photo_consent: false,
        honeypot: "",
        ...overrides,
    };
}

describe("issueSchema", () => {
    it("accepts a minimal valid report without photos or name", () => {
        const result = issueSchema.safeParse(
            validIssueValues({ name: "", category: "", description: "" }),
        );
        expect(result.success).toBe(true);
    });

    it("requires title and email", () => {
        expect(issueSchema.safeParse(validIssueValues({ title: "" })).success).toBe(false);
        expect(issueSchema.safeParse(validIssueValues({ email: "" })).success).toBe(false);
        expect(issueSchema.safeParse(validIssueValues({ email: "keine-mail" })).success).toBe(false);
    });

    it("enforces the field length limits like the server", () => {
        expect(
            issueSchema.safeParse(validIssueValues({ title: "x".repeat(201) })).success,
        ).toBe(false);
        expect(
            issueSchema.safeParse(validIssueValues({ description: "x".repeat(5001) })).success,
        ).toBe(false);
        expect(
            issueSchema.safeParse(validIssueValues({ category: "x".repeat(101) })).success,
        ).toBe(false);
        expect(
            issueSchema.safeParse(validIssueValues({ name: "x".repeat(201) })).success,
        ).toBe(false);
    });

    it("requires the coordinates to be present and within the bounding box", () => {
        expect(issueSchema.safeParse(validIssueValues({ lat: "" })).success).toBe(false);
        expect(issueSchema.safeParse(validIssueValues({ lat: "abc" })).success).toBe(false);
        // outside the box on each axis
        expect(issueSchema.safeParse(validIssueValues({ lat: "50.9" })).success).toBe(false);
        expect(issueSchema.safeParse(validIssueValues({ lat: "51.6" })).success).toBe(false);
        expect(issueSchema.safeParse(validIssueValues({ lng: "6.9" })).success).toBe(false);
        expect(issueSchema.safeParse(validIssueValues({ lng: "7.6" })).success).toBe(false);
        // boundary values themselves are valid
        expect(issueSchema.safeParse(validIssueValues({ lat: "51.0", lng: "7.0" })).success).toBe(true);
        expect(issueSchema.safeParse(validIssueValues({ lat: "51.5", lng: "7.5" })).success).toBe(true);
    });

    it("allows at most the server's photo count", () => {
        const blobs = Array.from({ length: MAX_PHOTOS }, () => new Blob(["x"]));
        const withSix = Array.from({ length: MAX_PHOTOS + 1 }, () => new Blob(["x"]));
        expect(
            issueSchema.safeParse(validIssueValues({ photos: blobs, photo_consent: true })).success,
        ).toBe(true);
        expect(
            issueSchema.safeParse(
                validIssueValues({ photos: withSix, photo_consent: true }),
            ).success,
        ).toBe(false);
    });

    it("requires photo consent only when photos are attached", () => {
        const values = validIssueValues({ photos: [new Blob(["x"])] });
        const withoutConsent = issueSchema.safeParse(values);
        expect(withoutConsent.success).toBe(false);
        if (!withoutConsent.success) {
            expect(withoutConsent.error.issues[0].path).toContain("photo_consent");
        }
        expect(issueSchema.safeParse(validIssueValues({ ...values, photo_consent: true })).success).toBe(true);
        expect(issueSchema.safeParse(validIssueValues({ photo_consent: false })).success).toBe(true);
    });

    it("keeps the honeypot trap", () => {
        expect(issueSchema.safeParse(validIssueValues({ honeypot: "spam" })).success).toBe(false);
    });
});

describe("isWithinIssueBounds", () => {
    it("matches the backend defaults", () => {
        expect(isWithinIssueBounds(51.25, 7.25)).toBe(true);
        expect(isWithinIssueBounds(51.0, 7.0)).toBe(true);
        expect(isWithinIssueBounds(51.5, 7.5)).toBe(true);
        expect(isWithinIssueBounds(50.9999, 7.25)).toBe(false);
        expect(isWithinIssueBounds(51.25, 7.5001)).toBe(false);
        expect(isWithinIssueBounds(NaN, 7.25)).toBe(false);
        expect(isWithinIssueBounds(51.25, Infinity)).toBe(false);
    });
});

describe("buildIssueFormData", () => {
    it("sends exactly the multipart contract of hooks/submitIssue.go", () => {
        const blob = new Blob(["reencoded"], { type: "image/jpeg" });
        const data = buildIssueFormData(validIssueValues({ photo_consent: true }), [blob], 1730000000000);

        expect(data.get("title")).toBe("Kaputte Laterne");
        expect(data.get("description")).toBe("Die Laterne am Hintereingang leuchtet nicht.");
        expect(data.get("category")).toBe("Beleuchtung");
        expect(data.get("lat")).toBe("51.24812");
        expect(data.get("lng")).toBe("7.21222");
        expect(data.get("email")).toBe("bewohner@example.com");
        expect(data.get("name")).toBe("Anna");
        expect(data.get("photo_consent")).toBe("true");
        expect(data.get("honeypot")).toBe("");
        expect(data.get("form_started_at")).toBe("1730000000000");
        expect(data.getAll("photos")).toHaveLength(1);

        const photo = data.get("photos") as File;
        expect(photo.name).toBe("photo-1.jpg");
        expect(photo.type).toBe("image/jpeg");
    });

    it("omits the optional name and skips consent/flag fields when there are no photos", () => {
        const data = buildIssueFormData(validIssueValues({ name: "" }), [], 1730000000000);
        expect(data.get("name")).toBeNull();
        expect(data.get("photo_consent")).toBeNull();
        expect(data.getAll("photos")).toHaveLength(0);
    });

    it("names multiple photos in order and never sends decision fields", () => {
        const blobs = Array.from({ length: 3 }, () => new Blob(["x"], { type: "image/jpeg" }));
        const data = buildIssueFormData(validIssueValues({ photo_consent: true }), blobs, 1);
        const photos = data.getAll("photos") as File[];
        expect(photos.map((p) => p.name)).toEqual(["photo-1.jpg", "photo-2.jpg", "photo-3.jpg"]);
        expect(data.get("status")).toBeNull();
        expect(data.get("visibility")).toBeNull();
        expect(data.get("lat_exact")).toBeNull();
        expect(data.get("lng_exact")).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// M9: accounts + issue workflow

import {
    buildIssueStatusUpdate,
    buildPasswordUpdate,
    buildProfileUpdate,
    buildSignupPayload,
    issueTransitionsFor,
    ISSUE_STATUSES,
    MIN_PASSWORD_LENGTH,
    passwordChangeSchema,
    profileNameSchema,
    signupSchema,
    type IssueStatus,
} from "./validation";

function signupValues(overrides: Record<string, unknown> = {}) {
    return {
        name: "Anna Beispiel",
        email: "anna@example.com",
        password: "passwort123",
        passwordConfirm: "passwort123",
        ...overrides,
    };
}

describe("signupSchema", () => {
    it("accepts a valid signup", () => {
        const result = signupSchema.safeParse(signupValues());
        expect(result.success).toBe(true);
    });

    it("requires all four fields", () => {
        for (const key of ["name", "email", "password", "passwordConfirm"]) {
            const values = { ...signupValues(), [key]: "" };
            const result = signupSchema.safeParse(values);
            expect(result.success).toBe(false);
        }
    });

    it("rejects an invalid email", () => {
        const result = signupSchema.safeParse(signupValues({ email: "kein-at" }));
        expect(result.success).toBe(false);
    });

    it("enforces the minimum password length", () => {
        const result = signupSchema.safeParse(
            signupValues({ password: "kurz", passwordConfirm: "kurz" }),
        );
        expect(result.success).toBe(false);
        expect(MIN_PASSWORD_LENGTH).toBe(8);
    });

    it("rejects mismatching passwords", () => {
        const result = signupSchema.safeParse(
            signupValues({ passwordConfirm: "anderes123" }),
        );
        expect(result.success).toBe(false);
        const issue = result.error?.issues[0];
        expect(issue?.path).toEqual(["passwordConfirm"]);
        expect(issue?.message).toBe("validation.passwordMismatch");
    });

    it("trims name and email", () => {
        const result = signupSchema.parse(
            signupValues({ name: "  Anna  ", email: "  anna@example.com " }),
        );
        expect(result.name).toBe("Anna");
        expect(result.email).toBe("anna@example.com");
    });

    it("limits the name length (below the PocketBase schema max)", () => {
        const result = signupSchema.safeParse({
            ...signupValues(),
            name: "a".repeat(201),
        });
        expect(result.success).toBe(false);
    });
});

describe("buildSignupPayload", () => {
    it("sends only the four self-service fields", () => {
        const values = signupSchema.parse(signupValues());
        const payload = buildSignupPayload(values);
        expect(payload).toEqual({
            name: "Anna Beispiel",
            email: "anna@example.com",
            password: "passwort123",
            passwordConfirm: "passwort123",
        });
        expect(Object.keys(payload).sort()).toEqual(
            ["email", "name", "password", "passwordConfirm"],
        );
    });
});

describe("profile/password payload builders", () => {
    it("buildProfileUpdate sends the name and, only for staff, the notify flag", () => {
        expect(buildProfileUpdate("Neuer Name")).toEqual({ name: "Neuer Name" });
        expect(
            buildProfileUpdate("Neuer Name", { notifyNewIssues: true }),
        ).toEqual({ name: "Neuer Name", notify_new_issues: true });
    });

    it("buildProfileUpdate throws on an empty or too long name", () => {
        expect(() => buildProfileUpdate("   ")).toThrow();
        expect(() => buildProfileUpdate("a".repeat(201))).toThrow();
    });

    it("buildProfileUpdate never touches role/approved/verified", () => {
        const patch = buildProfileUpdate("N", { notifyNewIssues: false });
        expect("role" in patch).toBe(false);
        expect("approved" in patch).toBe(false);
        expect("verified" in patch).toBe(false);
    });

    it("profileNameSchema trims before validating", () => {
        expect(profileNameSchema.parse("  A  ")).toBe("A");
        expect(profileNameSchema.safeParse("").success).toBe(false);
    });

    it("passwordChangeSchema validates like the signup schema", () => {
        const valid = {
            oldPassword: "altes123",
            password: "neues1234",
            passwordConfirm: "neues1234",
        };
        expect(passwordChangeSchema.safeParse(valid).success).toBe(true);
        const invalid = { ...valid, password: "kurz", passwordConfirm: "kurz" };
        expect(passwordChangeSchema.safeParse(invalid).success).toBe(false);
        const mismatch = { ...valid, passwordConfirm: "anders123" };
        expect(passwordChangeSchema.safeParse(mismatch).success).toBe(false);

        const payload = buildPasswordUpdate(passwordChangeSchema.parse(valid));
        expect(payload).toEqual(valid);
    });
});

// ---------------------------------------------------------------------------
// Transition matrix (mirrors hooks/issueWorkflow.go - the review
// checklist asks for the role x status -> allowed next statuses)

function allowed(role: string, status: IssueStatus): IssueStatus[] {
    return issueTransitionsFor(role, status).map((transition) => transition.status);
}

describe("issueTransitionsFor", () => {
    it("beirat: accept/reject a pending issue, then progress along the chain", () => {
        expect(allowed("beirat", "pending")).toEqual(["open", "rejected"]);
        expect(allowed("beirat", "open")).toEqual(["in_progress"]);
        expect(allowed("beirat", "in_progress")).toEqual(["resolved"]);
    });

    it("beirat has no way out of rejected/resolved (hook answers 400)", () => {
        expect(allowed("beirat", "resolved")).toEqual([]);
        expect(allowed("beirat", "rejected")).toEqual([]);
    });

    it("hausmeister: only open -> in_progress -> resolved", () => {
        expect(allowed("hausmeister", "open")).toEqual(["in_progress"]);
        expect(allowed("hausmeister", "in_progress")).toEqual(["resolved"]);
    });

    it("hausmeister cannot touch pending or terminal statuses", () => {
        expect(allowed("hausmeister", "pending")).toEqual([]);
        expect(allowed("hausmeister", "resolved")).toEqual([]);
        expect(allowed("hausmeister", "rejected")).toEqual([]);
    });

    it("hausverwaltung and residents are read-only for every status", () => {
        for (const status of ISSUE_STATUSES) {
            expect(allowed("hausverwaltung", status)).toEqual([]);
            expect(allowed("resident", status)).toEqual([]);
            expect(allowed("", status)).toEqual([]);
        }
    });

    it("marks the accept transition as the only visibility-requiring one", () => {
        const transitions = issueTransitionsFor("beirat", "pending");
        expect(transitions.find((t) => t.status === "open")?.requiresVisibility).toBe(true);
        expect(
            transitions.find((t) => t.status === "rejected")?.requiresVisibility,
        ).toBe(false);
        expect(
            issueTransitionsFor("beirat", "open").every((t) => !t.requiresVisibility),
        ).toBe(true);
        expect(
            issueTransitionsFor("hausmeister", "open").every((t) => !t.requiresVisibility),
        ).toBe(true);
    });
});

describe("buildIssueStatusUpdate", () => {
    it("accept requires the visibility and sends it in the same request", () => {
        expect(buildIssueStatusUpdate("beirat", "pending", "open", "community")).toEqual({
            status: "open",
            visibility: "community",
        });
        expect(buildIssueStatusUpdate("beirat", "pending", "open", "private")).toEqual({
            status: "open",
            visibility: "private",
        });
    });

    it("accept without a valid visibility is refused client-side", () => {
        // the visibility is optional in the signature, but the builder
        // refuses an accept without a valid visibility at runtime
        expect(() => buildIssueStatusUpdate("beirat", "pending", "open")).toThrow();
        // @ts-expect-error the empty string is not a visibility either
        expect(() => buildIssueStatusUpdate("beirat", "pending", "open", "")).toThrow();
        // @ts-expect-error anything else is not a visibility either
        expect(() => buildIssueStatusUpdate("beirat", "pending", "open", "friends")).toThrow();
    });

    it("reject and the working transitions send the status only", () => {
        expect(buildIssueStatusUpdate("beirat", "pending", "rejected")).toEqual({
            status: "rejected",
        });
        expect(buildIssueStatusUpdate("beirat", "open", "in_progress")).toEqual({
            status: "in_progress",
        });
        expect(buildIssueStatusUpdate("hausmeister", "open", "in_progress")).toEqual({
            status: "in_progress",
        });
        expect(buildIssueStatusUpdate("hausmeister", "in_progress", "resolved")).toEqual({
            status: "resolved",
        });
    });

    it("throws for arrows the server hook rejects with 400", () => {
        expect(() => buildIssueStatusUpdate("beirat", "open", "resolved")).toThrow();
        expect(() => buildIssueStatusUpdate("beirat", "resolved", "pending")).toThrow();
        expect(() => buildIssueStatusUpdate("beirat", "open", "rejected")).toThrow();
        expect(() => buildIssueStatusUpdate("hausmeister", "pending", "in_progress")).toThrow();
        expect(() => buildIssueStatusUpdate("hausverwaltung", "open", "in_progress")).toThrow();
        expect(() => buildIssueStatusUpdate("resident", "open", "in_progress")).toThrow();
        expect(() => buildIssueStatusUpdate("beirat", "pending", "pending")).toThrow();
    });
});

describe("noteSchema and note payloads", () => {
    it("accepts a valid note and rejects empty fields", () => {
        expect(noteSchema.safeParse({ title: "Notiz", body: "**Text**" }).success).toBe(true);
        expect(noteSchema.safeParse({ title: "", body: "Text" }).success).toBe(false);
        expect(noteSchema.safeParse({ title: "Notiz", body: "  " }).success).toBe(false);
    });

    it("buildNoteCreate sends author only from the caller", () => {
        const values = { title: "Notiz", body: "Text" };
        expect(buildNoteCreate(values, "userbeirat00000")).toEqual({
            title: "Notiz",
            body: "Text",
            author: "userbeirat00000",
            pinned: false,
        });
    });

    it("buildNoteUpdate never contains author", () => {
        const values = { title: "Notiz", body: "Text" };
        const payload = buildNoteUpdate(values) as Record<string, unknown>;
        expect(payload).toEqual({ title: "Notiz", body: "Text" });
        expect("author" in payload).toBe(false);
    });
});
