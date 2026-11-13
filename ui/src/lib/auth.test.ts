import { describe, expect, it } from "vitest";

import { boardAccessOf, canShow, roleOf } from "./auth";

describe("roleOf", () => {
    it("reads the role from the auth store record", () => {
        expect(roleOf({ id: "u1", role: "beirat" })).toBe("beirat");
        expect(roleOf({ id: "u2", role: "resident" })).toBe("resident");
    });

    it("returns an empty string without a record or role", () => {
        expect(roleOf(null)).toBe("");
        expect(roleOf({ id: "u3" })).toBe("");
        expect(roleOf({ id: "u4", role: 5 })).toBe("");
    });
});

describe("canShow (beirat-only pages)", () => {
    it("is true only for the beirat role", () => {
        expect(canShow("beirat")).toBe(true);
        expect(canShow("resident")).toBe(false);
        expect(canShow("hausmeister")).toBe(false);
        expect(canShow("hausverwaltung")).toBe(false);
        expect(canShow("")).toBe(false);
    });
});

describe("boardAccessOf (unapproved gate for the issue board)", () => {
    it("is granted for an approved+verified resident", () => {
        expect(
            boardAccessOf({ id: "u", role: "resident", approved: true, verified: true }),
        ).toBe("granted");
    });

    it("is granted (exempt) for beirat, hausmeister and hausverwaltung", () => {
        expect(boardAccessOf({ id: "u", role: "beirat", approved: false, verified: false })).toBe("granted");
        expect(boardAccessOf({ id: "u", role: "hausmeister", approved: false, verified: false })).toBe("granted");
        expect(boardAccessOf({ id: "u", role: "hausverwaltung", approved: false, verified: false })).toBe("granted");
    });

    it("shows the unverified page for residents without a confirmed email", () => {
        expect(
            boardAccessOf({ id: "u", role: "resident", approved: true, verified: false }),
        ).toBe("unverified");
        expect(
            boardAccessOf({ id: "u", role: "resident", approved: false, verified: false }),
        ).toBe("unverified"); // confirm the email first
    });

    it("shows the waiting page for verified residents without approval", () => {
        expect(
            boardAccessOf({ id: "u", role: "resident", approved: false, verified: true }),
        ).toBe("waiting");
    });

    it("treats missing flags and odd shapes conservatively", () => {
        expect(boardAccessOf(null)).toBe("granted"); // callers gate anonymous users separately
        expect(boardAccessOf({ id: "u", role: "resident" })).toBe("unverified");
        expect(boardAccessOf({ id: "u", role: 5 })).toBe("granted"); // non-resident garbage: not the gate's business
    });
});
