# M10 review — Notes

Reviewer run: branch `m10-m12-work`, commit under review `691df59` (final-tree review
at `63a6b86`). Authorship check passed: the branch adds exactly two commits on top
of `9b539dd`; `git diff 9b539dd..691df59` (M10) touches only `ui/**` and
`reviews/**`, `git diff 691df59..63a6b86` (M12) only `docs/**`, `ui/**`, `reviews/**`.

## Verdict: **APPROVED** (tag `m10-approved`)

No review fixes required. All acceptance and checklist items pass; the two
findings below are minor observations with no action needed.

## Acceptance re-run (final state)

- `cd ui && npm ci … npm test`: **8 files, 137 tests passed** (incl.
  `src/lib/markdown.test.ts` 13, `src/lib/validation.test.ts` 59,
  `src/locales/locales.test.ts` 10).
- `cd ui && npm run lint`: clean, exit 0.
- `cd ui && npm run build`: OK (`dist/index.js` 838.88 kB, built in 1.91 s;
  `ui/dist/index.html` was restored to the committed state afterwards, so the
  tree stayed clean apart from the build-touched placeholder).
- `make build`: OK.
- `go test ./... -count=1`: `ok weg-portal` (1.944 s), all helper packages green.

## Checklist (milestones.md M10)

- [x] `author` set from auth, cannot be spoofed (server rule from M1).
  - Server rule proven: `migrations/1795000100_collections.go:217`
    (`CreateRule = B && @request.body.author = @request.auth.id`);
    `api_notes_test.go:141` ("beirat cannot spoof another author" → 400).
    Re-proven live against the fixture-copy server: beirat create with
    `author = userresident000` → HTTP 400; resident/guest create → 400.
  - UI never sends `author` on update: `buildNoteUpdate`
    (`ui/src/lib/validation.ts:520-524`) is title/body only; pinned by
    `ui/src/lib/validation.test.ts:591-595`. Verified in the real browser by
    intercepting the SDK requests: update PATCH body was exactly
    `{"title":…,"body":…}` (no `author`), pin PATCH was exactly
    `{"pinned":true}`; author unchanged after edit
    (`author = userbeirat00000`). Create POST carries `author` = auth-store id
    only (`ui/src/pages/Notes.tsx:236`, `ui/src/lib/validation.ts:506-516`).
- [x] Markdown output sanitized.
  - `ui/src/lib/markdown.ts` audited: whitelist of text-level tags only
    (`ALLOWED_TAGS` :24-46), attrs limited to `href,title,target,rel` (:49),
    `ALLOWED_URI_REGEXP = /^(?:(?:https?:|mailto:)|[/#.])/i` (:53) — so
    `javascript:`, `data:`, `vbscript:` and friends are dropped;
    `ALLOW_DATA_ATTR/ALLOW_ARIA_ATTR: false` + explicit
    `FORBID_TAGS: script/iframe/object/embed/form/svg/math/style` (:71-77);
    `afterSanitizeAttributes` hook forces `target=_blank` +
    `rel="noopener noreferrer"` (:57-66). Only one
    `dangerouslySetInnerHTML` consumer in the app: `Notes.tsx:177`.
  - Attacked it myself in the real browser (headless Chromium against the
    built SPA + `make build` server on a /tmp copy of `test_pb_data`), via
    the real create form with the payloads below; asserted on the live DOM
    (no `on*` attributes, no `img/svg/iframe/embed/object/base/meta/link/
    form/details/video/math/style` elements, no non-https/mailto/relative/
    anchor hrefs, no handler fired) — **all rendered completely inert**:
    - `<img src=x onerror=…>`, `<svg onload=…>`, `<video><source onerror=…>`
    - `formaction`/`<form action="javascript:…">`, `<details open ontoggle=…>`
    - `javascript:` with mixed case (`jAvAsCrIpT:`), tab
      (`java\tscript:`), HTML-entity variants (`jav&#x09;ascript:`,
      `jav&#x3a;ascript:`)
    - `data:text/html;base64,<script>alert(1)</script>`,
      `vbscript:msgbox(1)`, `srcdoc`-iframe, `<base href="javascript:">`,
      `<meta http-equiv=refresh …javascript:>`,
      `<link rel=stylesheet href="data:text/css,…expression…">`,
      `<embed src="data:image/svg+xml;base64,…onload…">`,
      `<math><mtext><table><mglyph><style>…` (mXSS attempt)
    - CSP as second line confirmed: the served `script-src 'self'` blocked
      every inline-handler attempt (the only console noise traced to
      React's own `oninput` capability probe in the bundle — pre-existing
      M2-era behavior, not an M10 defect).
  - Sanitizer test coverage (`ui/src/lib/markdown.test.ts`) is adequate for
    the important vectors: script blocks, onclick attrs, `javascript:` and
    `data:` hrefs, iframes, mixed payload, harmless text/link survival,
    relative+anchor hrefs preserved.

## Live run-through (documented, re-done by reviewer)

Fixture copy (`/tmp`, `test_pb_data` untouched; binary killed by PID
afterwards): as beirat — nav "Notizen" visible; create appeared in list; edit
inline rendered `**vier**` as `<strong>` and a `[link](https://…)` with
`rel="noopener noreferrer"` + `target="_blank"`; pin → `Angepinnt` chip +
pinned notes head the list; unpin → demoted, fixture "Wichtig" first; delete
via confirm dialog removed the card; fixture notes restored exactly
(`notesnormal0001`, `notespinned0001`). Guest and resident: nav lacks the
Notes link, `/notes` renders "Kein Zugriff", API list returns an empty
`items` array (rule-filtered), resident create → 400.
375 px viewport: notes page `scrollWidth = 375` (no horizontal overflow).

## Answers to handoff open questions

1. **`target="_blank"` + `rel="noopener noreferrer"` on every surviving
   link** — acceptable, keep it. Beirat notes mostly link to external
   documents; opening them in a new tab loses nothing and the forced `rel`
   removes the referrer/opener surface. It is the standard DOMPurify recipe.
2. **sanitize-after-parse (marked → DOMPurify)** — no objection. The
   sanitizer is the last step before the single injection site, which is
   exactly the right invariant; covered by tests and re-confirmed against
   ~25 live payloads above. Documented in code (`lib/markdown.ts:1-10`).

## Findings

- **O1 (minor, no action)** — a stripped `javascript:` link remains as a
  dead anchor: `[x](javascript:alert(9))` renders as
  `<a target="_blank" rel="noopener noreferrer">x</a>` with **no `href`**
  (DOMPurify removes only the attribute, the hook then re-attributes it).
  Inert — it navigates nowhere — and it is textbook DOMPurify behavior;
  purely cosmetic in an internal notes UI.
- **O2 (minor, no action)** — `orderNotes` sorts pinned-first and is stable
  **within the client state order**; after pin/unpin cycles the unpinned
  group's internal order can differ from the server's title ordering until
  the next reload. Plan.md only requires "pinned first", which always
  holds; the handoff documents the ordering rationale. Cosmetic.
- **O3 (info)** — the repo's `.gitignore` rule `/test_pb_data/.*` only
  matches dotfiles: a live server (or SQLite tooling) run against the
  in-repo fixture dir would leave untracked `data.db-wal`/`data.db-shm`.
  The reviewer's own read-only DB inspection produced these sidecars once —
  removed again; `test_pb_data/data.db` itself was never modified
  (`git status` clean). Out of M10 scope; noting for a future housekeeping
  commit only.

No code changes applied — nothing rose to the level of a review fix.
