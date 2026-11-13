import { describe, expect, it } from "vitest";

import { fillPlaceholders } from "./legal";

describe("fillPlaceholders", () => {
    it("fills the retention periods", () => {
        expect(
            fillPlaceholders("nach {{retention_issues_resolved_days}} Tagen, {{ retention_issues_rejected_days }} Tage", {
                retention_issues_resolved_days: 365,
                retention_issues_rejected_days: 90,
            }),
        ).toBe("nach 365 Tagen, 90 Tage");
    });

    it("never guesses a missing value", () => {
        expect(fillPlaceholders("{{retention_issues_resolved_days}} Tage", null)).toBe("… Tage");
        expect(fillPlaceholders("{{unknown_thing}}", { retention_issues_resolved_days: 1 })).toBe("…");
    });
});
