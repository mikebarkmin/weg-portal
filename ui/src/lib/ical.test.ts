import { describe, expect, it } from "vitest";

import { buildIcalUrl } from "./ical";

describe("buildIcalUrl", () => {
    it("builds the subscribe URL against the given origin", () => {
        expect(buildIcalUrl("https://portal.example.com")).toBe(
            "https://portal.example.com/api/portal/calendar.ics",
        );
    });

    it("keeps a trailing slash out of the path", () => {
        expect(buildIcalUrl("https://portal.example.com")).not.toContain(
            "//api",
        );
    });
});
