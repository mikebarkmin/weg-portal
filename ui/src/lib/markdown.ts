import DOMPurify from "dompurify";
import { Marked } from "marked";

// Client-side rendering pipeline for the beirat notes (M10). The
// backend stores the raw markdown in the `body` editor field and never
// interprets it; the client parses the markdown (marked) and then
// sanitizes the resulting HTML with DOMPurify. The sanitizer MUST run
// after the parser, because marked passes embedded raw HTML through
// unchanged - a note body is untrusted input, same as a suggestion
// description (the notes collection rules are beirat-only, but the
// sanitize-after-parse invariant must not depend on who may write).

// One parser instance + conservative options; no raw-HTML extension.
const parser = new Marked({
    gfm: true,
    breaks: false,
    async: false,
});

// Conservative whitelist: text-level formatting, lists, headings,
// block quotes, code blocks and links. No images (notes stay lean and
// img loading is an extra third-party request surface), no tables
// (unneeded for internal notes), nothing interactive.
const ALLOWED_TAGS = [
    "p",
    "br",
    "hr",
    "strong",
    "em",
    "b",
    "i",
    "del",
    "s",
    "ul",
    "ol",
    "li",
    "blockquote",
    "code",
    "pre",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "a",
];

const ALLOWED_ATTR = ["href", "title", "target", "rel"];

// Only https?, mailto: and relative/anchor URLs may survive
// sanitization - javascript:, data:, vbscript: etc. are dropped.
const ALLOWED_URI_REGEXP = /^(?:(?:https?:|mailto:)|[/#.])/i;

// Open every remaining link in a new tab without leaking the portal
// URL to the linked page (standard DOMPurify hook recipe).
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName.toUpperCase() === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
    }
});

// Renders untrusted markdown to safe HTML. The result is safe to
// inject via dangerouslySetInnerHTML (this is the ONLY function in the
// app that may produce such strings).
export function renderMarkdown(source: string): string {
    const parsed = parser.parse(source);
    const html = typeof parsed === "string" ? parsed : "";
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS,
        ALLOWED_ATTR,
        ALLOWED_URI_REGEXP,
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: false,
        FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "svg", "math", "style"],
    });
}

// Pinned notes first (M10). The server query keeps a deterministic
// order (title), so within the two groups the relative order is kept.
// The sort is explicit and stable so the invariant has a unit test.
// It lives next to renderMarkdown because the notes page consumes both.
export function orderNotes<T extends { pinned: boolean }>(notes: readonly T[]): T[] {
    return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned));
}
