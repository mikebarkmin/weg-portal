# M10 handoff

## Done
- `ui/src/lib/markdown.ts`: `renderMarkdown()` (marked + DOMPurify) —
  the notes `body` editor field stores raw markdown; the client parses it
  with marked and then **sanitizes the parsed HTML** with a conservative
  DOMPurify config:
  - whitelist of text-level tags only (p, br, hr, strong, em, b, i, del, s,
    ul/ol/li, blockquote, code, pre, h1–h6, a) — no images, no iframes,
    no tables, nothing interactive;
  - attrs limited to `href`, `title`, `target`, `rel`;
  - `ALLOWED_URI_REGEXP = /^(?:(?:https?:|mailto:)|[/#.])/i` — only
    https?, mailto: and relative/anchor URLs survive (javascript:, data:,
    vbscript: are dropped);
  - `ALLOW_DATA_ATTR: false`, `ALLOW_ARIA_ATTR: false`, explicit
    FORBID_TAGS for script/iframe/object/embed/form/svg/math/style;
  - afterSanitizeAttributes hook forces `target="_blank"` +
    `rel="noopener noreferrer"` on every surviving link.
  - `orderNotes()` pinned-first ordering helper (stable within groups).
- `ui/src/lib/markdown.test.ts` (vitest, jsdom environment): renders
  bold/lists/links; asserts `<script>` blocks, `onclick=` attributes,
  `javascript:` and `data:` URLs and `<iframe>` are stripped; mixed-payload
  test asserts the output is inert; pinned-first ordering tests for
  `orderNotes`.
- `ui/src/pages/Notes.tsx`: beirat-only notes page — list (pinned first,
  pinned chip), inline create + edit forms, pin/unpin, delete with confirm
  dialog, markdown bodies rendered via `renderMarkdown` and injected as
  `dangerouslySetInnerHTML`.
- `ui/src/lib/validation.ts`: `noteSchema`, `buildNoteCreate` (sends
  `author` from the auth store — the create rule requires
  `@request.body.author = @request.auth.id`), `buildNoteUpdate`
  (title/body only, **author is never part of an update payload**),
  `buildNotePinUpdate`; plus tests in `validation.test.ts`
  (incl. "buildNoteUpdate never contains author").
- `ui/src/types.ts`: `PortalNote` (raw markdown body, optional
  `expand.author`).
- Router: `/notes` wrapped in `RequireBeirat` (`App.tsx`); nav entry
  "Notizen" only rendered for beirat (`Layout.tsx`, `canShow`).
- Locales: `nav.notes`, full `notes.*` section in de.json/en.json
  (key parity covered by the existing locales test).
- CSS: `.notes-list`, `.note-card`, `.note-head`, `.note-meta`,
  `.note-body/.md-body` (styles for the whitelisted tags),
  `.note-textarea`, `.chip-pinned`, `.btn-sm` — mobile-first, fits 375px
  (cards stack, buttons wrap in `.btn-row`).
- Dependencies: `dompurify` + `marked` (runtime), `jsdom` +
  `@types/jsdom` (dev, for the sanitizer test environment).

## Not done / deviations from plan.md
- `orderNotes` lives in `lib/markdown.ts` (not a separate `lib/notes.ts`):
  the M10 task groups it with the markdown unit tests; documented in the
  file comment.
- The reminder text under the body textarea ("Der Text kann mit Markdown
  formatiert werden …") is a small UX addition not spelled out in
  plan.md — removed on request if unwanted.
- No `created/updated` sort: the `notes` collection has no autodate
  fields (M1 decision), so the server list is sorted by title and only
  the pinned grouping is applied client-side. If timestamps are wanted,
  that needs a migration (reviewer decision).

## Open questions for the reviewer
- The links keep `target="_blank"` + `rel="noopener noreferrer"` enforced
  by a DOMPurify hook (standard recipe from the DOMPurify README) —
  acceptable, or should notes links navigate in the same tab?
- `marked` renders inline raw HTML before sanitization; the sanitizer is
  the last step before injection. Any objection to relying on
  sanitize-after-parse (it is covered by the XSS tests)?

## Manual run-through (documented)
Environment: `make build` binary, `./weg-portal serve --dir <copy of
test_pb_data> --http 127.0.0.1:8097`, headless Chromium driven over CDP —
real browser, real forms, real clicks; plus curl against the same API the
page uses. The run container was isolated (/tmp copy), `test_pb_data`
itself untouched (restored to its two fixture notes "Wichtig"/"Sonstiges"
at the end).

API level (beirat@portal.test, fixtures, password "passwort123"):
- create with `author` from auth: 200, author = userbeirat00000
- create with a foreign author rejected: HTTP 400 (rule author=self)
- resident/guest GET notes list: HTTP 200 with **empty** `items`
  (PocketBase list rules act as filters; the Beirat-only data is
  unreachable — matches api_notes_test.go)
- edit (title/body only): 200, author unchanged
- pin: 200, `pinned: true`; list shows pinned first

Browser level (headless Chromium on the embedded SPA):
- nav has Notes link: true; h1: Interne Notizen
- created a note via the form ("Browser-Notiz M10"): appeared in the list
- edited it via the inline form: title + body updated, body rendered as
  `<ul><li>bearbeitet im Browser</li></ul>`
- pinned/unpinned: `Angepinnt` chip appears/disappears on the card
- deleted via the form (confirm dialog): card disappears
- XSS note submitted through the form containing
  `<script>alert(1)</script>`, a `javascript:alert(2)` link and an
  `<iframe src="https://evil.example">`:
  rendered body in the DOM was
  `<p><a target="_blank" rel="noopener noreferrer">Link</a></p>`
  and the assertion
  `document.querySelector('script') || querySelector('iframe') ||
  querySelector('[onclick]') || innerHTML.includes('javascript:')`
  returned **false** — i.e. the payload rendered completely inert.
- log out → `/notes` shows the "Kein Zugriff" forbidden page and the
  nav has no Notes link: `guest /notes h1: Kein Zugriff`,
  `guest nav has Notes link: false`

Bug found and fixed by the run-through: the locale section initially had
a duplicate `edit` key (form strings object + "Bearbeiten" button
label); JSON.parse kept the string, so the edit form buttons rendered the
raw keys `notes.edit.submit`. Renamed the button label to
`notes.editAction` and added a locales test that guards the edit-form
keys against exactly this silent collision.

## Acceptance command output (tails)

`cd ui && npm test`:
```
 ✓ src/lib/validation.test.ts (59 tests) 27ms
 ✓ src/lib/markdown.test.ts (13 tests) 55ms

 Test Files  8 passed (8)
      Tests  130 passed (130)
   Start at  15:00:16
   Duration  887ms (transform 325ms, setup 0ms, collect 690ms, environment 461ms, prepare 808ms)
```

`cd ui && npm run lint`:
```
> weg-portal-ui@0.1.0 lint
> eslint .
```
(no findings, exit 0)

`cd ui && npm run build`:
```
dist/index.html           0.52 kB
dist/@assets/index.css   35.92 kB
dist/@assets/index.js   825.97 kB
✓ built in 1.89s
```
(`ui/dist/index.html` restored to the committed state after the build.)

`make build`:
```
go build -o weg-portal ./base
```

`go test ./... -count=1`:
```
ok      	weg-portal	2.063s
?   	weg-portal/base	[no test files]
?   	weg-portal/fixturegen	[no test files]
?   	weg-portal/hooks	[no test files]
?   	weg-portal/migrations	[no test files]
?   	weg-portal/ui	[no test files]
```

`go vet ./...`: clean.
