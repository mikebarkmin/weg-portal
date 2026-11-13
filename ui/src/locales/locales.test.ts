import { describe, expect, it } from "vitest";

import de from "./de.json";
import en from "./en.json";

// flattens nested locale objects into dotted key paths
function flatten(value: unknown, prefix = ""): string[] {
    if (typeof value !== "object" || value === null) {
        return [prefix];
    }
    return Object.entries(value).flatMap(([key, nested]) =>
        flatten(nested, prefix ? `${prefix}.${key}` : key),
    );
}

describe("locale files", () => {
    it("de and en define exactly the same keys", () => {
        const deKeys = flatten(de).sort();
        const enKeys = flatten(en).sort();
        expect(deKeys).toEqual(enKeys);
    });

    it("contain the German app title", () => {
        expect(de.app.title).toBe("WEG-Portal");
    });
});
