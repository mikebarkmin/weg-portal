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

interface LegalBlock {
    heading: string;
    paragraphs: string[];
}

function legalBlocks(locale: unknown, page: "impressum" | "datenschutz"): LegalBlock[] {
    const legal = (locale as { legal: Record<string, unknown> }).legal;
    const pageData = legal[page] as unknown as { blocks: unknown };
    return pageData.blocks as LegalBlock[];
}

// The M12 legal pages are fed from the locale files - these tests pin
// the content requirements from plan.md/milestones.md so the texts
// cannot silently lose their mandatory pieces (draft warning, data
// list, third parties, retention periods matching the portal_settings
// migration defaults).
describe("legal pages content (M12)", () => {
    it("every block has a heading and paragraphs", () => {
        for (const locale of [de, en]) {
            for (const page of ["impressum", "datenschutz"] as const) {
                for (const block of legalBlocks(locale, page)) {
                    expect(typeof block.heading).toBe("string");
                    expect(block.paragraphs.length).toBeGreaterThan(0);
                }
            }
        }
    });

    it("warns that the texts are drafts pending legal review", () => {
        expect(JSON.stringify(de.legal.draftNotice)).toContain("Entwurf");
        expect(JSON.stringify(de.legal.draftNotice)).toContain("rechtliche");
        expect(JSON.stringify(en.legal.draftNotice)).toContain("draft");
        expect(JSON.stringify(en.legal.draftNotice)).toContain("legal review");
    });

    it("marks the unanswered Beirat placeholders", () => {
        const text = JSON.stringify(de.legal.impressum) + JSON.stringify(de.legal.datenschutz);
        expect(text).toContain("TODO(Beirat)");
    });

    it("lists the third parties: OSM tile server, SMTP provider, backup storage", () => {
        const text = legalBlocks(de, "datenschutz")
            .flatMap((block) => block.paragraphs)
            .join("\n");
        expect(text).toContain("tile.openstreetmap.org");
        expect(text).toContain("OpenStreetMap Foundation");
        expect(text).toContain("SMTP-Dienstleister");
        expect(text).toContain("Backups");
    });

    it("states the retention periods matching the portal_settings defaults (90/90/90/365)", () => {
        const join = legalBlocks(de, "datenschutz")
            .flatMap((block) => block.paragraphs)
            .join("\n");
        // rejected suggestions: 90 days, accepted suggestions: 90 days,
        // rejected issues: 90 days, resolved issues: 365 days
        expect(join).toContain("Abgelehnte Terminvorschläge werden 90 Tage");
        expect(join).toContain("Angenommene Terminvorschläge werden 90 Tage");
        expect(join).toContain("Abgelehnte Meldungen");
        expect(join).toContain("90 Tage nach der Entscheidung gelöscht");
        expect(join).toContain("Erledigte Meldungen");
        expect(join).toContain("365 Tage");
        // and the note that they must always match portal_settings
        expect(join).toContain("Portaleinstellungen");
        // pending items are never auto-deleted
        expect(join).toContain("nicht automatisch gelöscht");
    });

    it("lists the processed data per collection from plan.md", () => {
        const text = legalBlocks(de, "datenschutz")
            .flatMap((block) => block.paragraphs)
            .join("\n");
        expect(text).toContain("E-Mail-Adresse");
        expect(text).toContain("Fotos");
        expect(text).toContain("genaue Position");
        expect(text).toContain("gerundete Koordinaten");
        expect(text).toContain("Rolle");
        expect(text).toContain("Freigabestatus");
        expect(text).toContain("Interne Notizen");
    });

    it("carries the German legal text in en with an English preface note", () => {
        // single-language legal texts: en shows the same German text
        expect(en.legal.impressum).toEqual(de.legal.impressum);
        expect(en.legal.datenschutz).toEqual(de.legal.datenschutz);
        expect(JSON.stringify(en.legal.englishNote)).toContain("German only");
    });
});
