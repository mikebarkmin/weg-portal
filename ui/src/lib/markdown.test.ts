// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { orderNotes, renderMarkdown } from "./markdown";

// renderMarkdown needs a real DOM (DOMPurify), hence the jsdom
// environment above. The XSS assertions below are the safety net the
// M10 review checklist refers to ("markdown output sanitized").

describe("renderMarkdown", () => {
    it("renders bold text", () => {
        expect(renderMarkdown("Vorher **nachher**")).toContain("<strong>nachher</strong>");
    });

    it("renders bullet and numbered lists", () => {
        const html = renderMarkdown("- eins\n- zwei\n\n1. erstens\n2. zweitens");
        expect(html).toContain("<ul>");
        expect(html).toContain("<li>eins</li>");
        expect(html).toContain("<ol>");
        expect(html).toContain("<li>zweitens</li>");
    });

    it("renders links and keeps safe hrefs", () => {
        const html = renderMarkdown("[Dokument](https://example.com/doku)");
        expect(html).toContain('href="https://example.com/doku"');
        expect(html).toContain('rel="noopener noreferrer"');
    });

    it("strips <script> blocks", () => {
        const html = renderMarkdown("ok **fett** <script>alert(1)</script>");
        expect(html).toContain("<strong>fett</strong>");
        expect(html).not.toContain("<script");
        expect(html).not.toContain("alert(1)");
    });

    it("strips onclick attributes", () => {
        const html = renderMarkdown('<p onclick="alert(1)">Text</p>');
        expect(html).toContain("Text");
        expect(html).not.toContain("onclick");
        expect(html).not.toContain("alert(1)");
    });

    it("defuses javascript: links", () => {
        const html = renderMarkdown("[klick](javascript:alert(1))");
        expect(html).not.toContain("javascript:");
        expect(html).not.toContain("alert(1)");
    });

    it("defuses data: URLs", () => {
        const html = renderMarkdown("[xss](data:text/html,<script>alert(1)</script>)");
        expect(html).not.toContain("data:");
        expect(html).not.toContain("alert(1)");
    });

    it("strips iframes", () => {
        const html = renderMarkdown(
            '<iframe src="https://evil.example"></iframe>nach dem iframe',
        );
        expect(html).not.toContain("<iframe");
        expect(html).not.toContain("evil.example");
        expect(html).toContain("nach dem iframe");
    });

    it("keeps dangerous payloads inert in mixed content", () => {
        const html = renderMarkdown(
            'Notiz\n\n<script>alert(1)</script>\n\n' +
                '<img src=x onerror=alert(2)>\n\n' +
                "[Link](javascript:alert(3))\n\n" +
                "<iframe srcdoc=\"<script>alert(4)</script>\"></iframe>",
        );
        expect(html).not.toContain("alert(1)");
        expect(html).not.toContain("onerror");
        expect(html).not.toContain("alert(2)");
        expect(html).not.toContain("javascript:");
        expect(html).not.toContain("iframe");
        expect(html).not.toContain("alert(3)");
        expect(html).not.toContain("alert(4)");
        // the harmless text survives
        expect(html).toContain("Notiz");
        expect(html).toContain("Link");
    });

    it("keeps relative and anchor hrefs", () => {
        expect(renderMarkdown("[a](/termine)")).toContain('href="/termine"');
        expect(renderMarkdown("[b](#absatz)")).toContain('href="#absatz"');
    });
});

describe("orderNotes", () => {
    it("places pinned notes first and keeps the order within groups", () => {
        const notes = [
            { id: "a", title: "Brot", pinned: false },
            { id: "b", title: "Wichtig", pinned: true },
            { id: "c", title: "ABC", pinned: false },
            { id: "d", title: "Ganz oben", pinned: true },
        ];
        expect(orderNotes(notes).map((note) => note.id)).toEqual(["b", "d", "a", "c"]);
    });

    it("returns a new array without mutating the input", () => {
        const notes = [
            { id: "a", pinned: false },
            { id: "b", pinned: true },
        ];
        const ordered = orderNotes(notes);
        expect(ordered.map((note) => note.id)).toEqual(["b", "a"]);
        expect(notes.map((note) => note.id)).toEqual(["a", "b"]);
    });

    it("handles empty lists and notes without a pinned flag default", () => {
        expect(orderNotes([])).toEqual([]);
        expect(orderNotes([{ pinned: false }])).toEqual([{ pinned: false }]);
    });
});
