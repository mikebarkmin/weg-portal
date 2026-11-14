import { describe, expect, it, vi } from "vitest";

// the module registers an auth listener on the shared PocketBase client
vi.mock("./pbClient", () => ({
    pb: { authStore: { onChange: () => undefined }, send: vi.fn(), collection: vi.fn() },
}));

import {
    formatPlanCoordinate,
    isIdentifyingLocation,
    latLngToPlan,
    locationLabel,
    parseFloorLines,
    parsePlanPoint,
    planToLatLng,
    type IssueArea,
} from "./issueAreas";

const areas: IssueArea[] = [
    { id: "house", name: "Haus 79", floors: ["EG", "1. OG"], active: true, has_plan: false },
    { id: "cellar", name: "Keller", floors: [], active: true, has_plan: true, plan: "plan.png" },
];

describe("locationLabel", () => {
    it("joins the area name and the floor", () => {
        expect(locationLabel({ area: "house", floor: "1. OG" }, areas)).toBe("Haus 79 · 1. OG");
        expect(locationLabel({ area: "cellar", floor: "" }, areas)).toBe("Keller");
    });

    it("falls back for an area that no longer exists", () => {
        expect(locationLabel({ area: "gone", floor: "EG" }, areas, "Unbekannt")).toBe("Unbekannt · EG");
        expect(locationLabel({ area: "gone", floor: "" }, areas)).toBe("");
    });
});

describe("isIdentifyingLocation", () => {
    it("flags floors and pins, not a bare area", () => {
        expect(isIdentifyingLocation(null)).toBe(false);
        expect(isIdentifyingLocation({ floor: "", has_pin: false })).toBe(false);
        expect(isIdentifyingLocation({ floor: "2. OG", has_pin: false })).toBe(true);
        expect(isIdentifyingLocation({ floor: "", has_pin: true })).toBe(true);
    });
});

describe("plan geometry", () => {
    it("maps normalized points to map positions and back (y from the top)", () => {
        // 2000 x 1000 plan: top-left, centre, bottom-right
        expect(planToLatLng({ x: 0, y: 0 }, 2000, 1000)).toEqual([1000, 0]);
        expect(planToLatLng({ x: 0.5, y: 0.5 }, 2000, 1000)).toEqual([500, 1000]);
        expect(planToLatLng({ x: 1, y: 1 }, 2000, 1000)).toEqual([0, 2000]);

        const [lat, lng] = planToLatLng({ x: 0.25, y: 0.75 }, 2000, 1000);
        expect(latLngToPlan(lat, lng, 2000, 1000)).toEqual({ x: 0.25, y: 0.75 });
    });

    it("rejects positions outside the plan", () => {
        expect(latLngToPlan(-1, 10, 2000, 1000)).toBeNull();
        expect(latLngToPlan(500, 2001, 2000, 1000)).toBeNull();
        expect(latLngToPlan(NaN, 10, 2000, 1000)).toBeNull();
        expect(latLngToPlan(10, 10, 0, 0)).toBeNull();
    });

    it("formats and parses the form's pin strings", () => {
        expect(formatPlanCoordinate(0.123456)).toBe("0.1235");
        expect(parsePlanPoint("0.25", "0.75")).toEqual({ x: 0.25, y: 0.75 });
        expect(parsePlanPoint("", "0.75")).toBeNull();
        expect(parsePlanPoint("1.2", "0.5")).toBeNull();
        expect(parsePlanPoint("abc", "0.5")).toBeNull();
    });
});

describe("parseFloorLines", () => {
    it("trims, drops empty lines and duplicates", () => {
        expect(parseFloorLines(" EG \n\n1. OG\nEG\n 2. OG")).toEqual(["EG", "1. OG", "2. OG"]);
        expect(parseFloorLines("")).toEqual([]);
    });
});
