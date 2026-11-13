import { describe, expect, it } from "vitest";

import { canShow, roleOf } from "./auth";

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
