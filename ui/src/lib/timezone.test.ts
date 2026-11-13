import { afterEach, describe, expect, it } from "vitest";

import { fromZonedDigits, getPortalTimeZone, setPortalTimeZone, toZonedDigits } from "./timezone";

afterEach(() => {
    setPortalTimeZone("Europe/Berlin");
});

describe("toZonedDigits / fromZonedDigits", () => {
    it("converts between instants and Berlin wall time in summer and winter", () => {
        expect(toZonedDigits(new Date("2026-07-01T16:30:00Z")).toISOString()).toBe("2026-07-01T18:30:00.000Z");
        expect(toZonedDigits(new Date("2026-12-01T16:30:00Z")).toISOString()).toBe("2026-12-01T17:30:00.000Z");
        expect(fromZonedDigits(new Date("2026-07-01T18:30:00Z")).toISOString()).toBe("2026-07-01T16:30:00.000Z");
        expect(fromZonedDigits(new Date("2026-12-01T18:30:00Z")).toISOString()).toBe("2026-12-01T17:30:00.000Z");
    });

    it("round-trips around the DST changes", () => {
        for (const iso of ["2026-03-29T00:59:59Z", "2026-03-29T01:00:00Z", "2026-10-24T23:59:59Z", "2026-10-25T02:00:00Z"]) {
            const instant = new Date(iso);
            expect(fromZonedDigits(toZonedDigits(instant)).toISOString()).toBe(instant.toISOString());
        }
    });

    it("resolves the repeated autumn hour to standard time", () => {
        // 02:30 exists twice on 25 Oct 2026 (CEST and CET): the later one wins
        expect(fromZonedDigits(new Date("2026-10-25T02:30:00Z")).toISOString()).toBe("2026-10-25T01:30:00.000Z");
    });

    it("resolves a wall time inside the spring-forward gap one hour later", () => {
        // 02:30 does not exist on 29 Mar 2026 in Berlin -> 03:30 CEST
        expect(fromZonedDigits(new Date("2026-03-29T02:30:00Z")).toISOString()).toBe("2026-03-29T01:30:00.000Z");
    });

    it("uses the configured zone and rejects unknown ones", () => {
        expect(setPortalTimeZone("America/New_York")).toBe(true);
        expect(toZonedDigits(new Date("2026-07-01T16:30:00Z")).toISOString()).toBe("2026-07-01T12:30:00.000Z");
        expect(setPortalTimeZone("Mars/Olympus")).toBe(false);
        expect(setPortalTimeZone(undefined)).toBe(false);
        expect(getPortalTimeZone()).toBe("America/New_York");
    });
});
