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

// Guards against duplicate JSON keys inside one section (an "edit":
// {"submit": ...} object silently wins/loses against a later "edit":
// "Bearbeiten" string on parse - see the M10 bug this caught).
describe("notes locale section", () => {
    it("keeps the edit form keys distinct from the edit action label", () => {
        for (const locale of [de, en]) {
            const notes = locale.notes as {
                edit: unknown;
                editAction: string;
                new: { submit: string };
            };
            expect(typeof notes.editAction).toBe("string");
            expect(notes.edit).toBeTypeOf("object");
            expect((notes.edit as { heading: string }).heading).toBeTypeOf("string");
            expect((notes.edit as { submit: string }).submit).toBeTypeOf("string");
            expect((notes.edit as { cancel: string }).cancel).toBeTypeOf("string");
        }
    });
});
