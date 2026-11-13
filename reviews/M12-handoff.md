# M12 handoff

## Done
- `ui/src/pages/Impressum.tsx` + `ui/src/pages/Datenschutz.tsx` (public,
  no auth, no role guard) + shared renderer
  `ui/src/components/LegalText.tsx`. Routes `/impressum`,
  `/datenschutz` in `App.tsx`; footer links (Impressum, Datenschutz)
  in `Layout.tsx` — visible for everyone, including guests. Nav bar
  left unchanged: legal links live in the new footer only.
- Legal TEXT lives in the locale files (`ui/src/locales/de.json`, key
  `legal.*`); the pages render plain locale strings — no markdown, no
  `dangerouslySetInnerHTML`.
- **i18n decision (documented as required):** legal texts are
  single-language. de.json holds the German texts; en.json carries the
  same German texts plus an **English preface note**
  (`legal.englishNote`, rendered only for the en locale) stating that
  the German text is authoritative. UI chrome around the texts (footer
  labels, draft notice) is properly translated.
- Both pages show a clearly visible draft warning above the title
  (`legal.draftNotice`): „Hinweis: Entwurf – rechtliche Prüfung
  ausstehend…“ + the instruction that all `TODO(Beirat)` places must be
  filled in. The texts are NOT presented as final.
- Datenschutz content per plan.md "Security" table and the M12 task
  list:
  - processed data per collection: calendar events (public),
    suggestions (submitter email, only beirat-visible), issues
    (description/category/photos with client-side METADATA removal,
    exact coordinates only for beirat/HM/HV, rounded ~100 m coordinates
    for members, separately stored submitter email + optional name),
    accounts (name, email, role, approval status, opt-in notification
    flag), beirat notes (beirat-only).
  - third parties: **OSM tile server** (tile.openstreetmap.org,
    OpenStreetMap Foundation, incl. IP transmission note), **SMTP
    provider** (placeholder `TODO(Beirat)`), **backup storage**
    (placeholder `TODO(Beirat)`, encrypted, offsite).
  - retention periods: rejected suggestions **90 d**, accepted
    suggestions **90 d** (the event remains), rejected issues incl.
    photos/metas **90 d**, resolved issues **365 d**, pending items
    never auto-deleted, accounts until move-out/revoke — hardcoded as
    the current defaults, taken from
    `migrations/1795000101_portal_settings_record.go`, **with the note
    that they must always match the `portal_settings` values maintained
    by the superuser**.
  - data-subject rights (Art. 15–21 DSGVO), photo-consent revocation,
    complaint to a supervisory authority.
- Impressum content per plan.md: § 5 DDG Angaben, Vertretung durch den
  Beirat, Kontaktdaten — all name/address places marked
  `TODO(Beirat)`.
- `docs/betriebshandbuch.md` (German, ~410 words ≈ 1 printed page):
  Beirat tasks (approve/revoke accounts incl. move-outs, accept/reject
  suggestions and issues with decision note, choose visibility on
  accept, status flow, internal notes, who to contact), superuser tasks
  (two superusers, MFA per docs/deploy.md, backups per docs/deploy.md,
  roles — and the rule that **changing retention in `/_/` →
  `portal_settings` requires updating the Datenschutzerklärung**),
  draft note + TODO(Beirat) contacts.
- Locale-content tests in `ui/src/locales/locales.test.ts` pin the M12
  requirements: block structure, draft warning, TODO(Beirat)
  placeholders, third parties, retention numbers 90/90/90/365 + the
  portal_settings match note, processed-data list, and the German-text
  -in-en-with-preface decision.
- CSS: `.app-footer` (mobile-first, wraps at 375px), `.legal-text`,
  `.legal-section`, `.legal-draft` (warning box), `.legal-english-note`.

## Not done / deviations from plan.md
- `components/LegalText.tsx` is a new shared component not listed in
  the plan.md frontend sketch (the sketch's `pages/` list only names the
  two pages); it avoids duplicating the block renderer in both pages.
- The retention values are **hardcoded in the legal text** (per the
  milestone: "the current defaults, with a note that they must match
  `portal_settings`") — portal_settings is superuser-only (`null`
  rules), so the public page cannot query it; the match is pinned by the
  hand run-through + the locale tests.
- Legal links were added to a new footer instead of the nav bar
  ("footer/nav" per the milestone wording): the nav is already crowded
  at 375 px and legal links do not belong between the primary
  navigation items.
- The draft notices are translated in en (they are UI chrome, not legal
  text); the legal texts themselves stay German in both locales.

## Open questions for the reviewer
- Is the footer-only placement of Impressum/Datenschutz acceptable
  (see deviation above)?
- Should the betriebshandbuch reference the portal_settings record id
  (`portsettings000`) explicitly (it does now), or stay generic?
- The Datenschutz list of processed data covers all collections incl.
  the public calendar — the "Data at rest / GDPR" row in plan.md only
  names Impressum/Datenschutzerklärung + consent. Content-wise complete
  per the M12 task list („Liste der verarbeiteten Daten pro
  Collection“), please double-check the legal wording as a human
  review is anyway pending (draft warning is deliberate).

## Manual run-through (documented)
`make build` binary on a /tmp copy of `test_pb_data`, headless
Chromium via CDP — fully logged out (`localStorage.clear()`):

- calendar `/` as guest renders the footer:
  `["Impressum -> /impressum","Datenschutz -> /datenschutz"]`
- `/impressum` logged out: h1 „Impressum“, sections „Angaben gemäß § 5
  DDG“, „Verantwortlich für den Inhalt“, „Zweck des Portals“, draft
  notice visible: „Hinweis: Entwurf – rechtliche Prüfung ausstehend…“
- `/datenschutz` logged out: h1 „Datenschutzerklärung“, sections
  „Verantwortlicher“, „Welche Daten werden verarbeitet?“, „Empfänger
  und Dienstleister (Drittanbieter)“, „Speicherdauer und
  Löschfristen“, „Ihre Rechte“, draft notice visible.
- Retention paragraphs rendered on the page:
  - „Abgelehnte Terminvorschläge werden 90 Tage nach der Entscheidung
    gelöscht.“
  - „Angenommene Terminvorschläge werden 90 Tage … der veröffentlichte
    Termin selbst bleibt …“
  - „Abgelehnte Meldungen … werden 90 Tage nach der Entscheidung
    gelöscht.“
  - „Erledigte Meldungen … werden 365 Tage nach Erledigung gelöscht.“
  - „… offene Vorschläge und Meldungen werden nicht automatisch
    gelöscht.“
  - „… Fristen entsprechen den aktuellen Portaleinstellungen … muss
    dieser Abschnitt … angepasst werden.“
- Cross-checked against the live fixture DB via superuser:
  `GET /api/collections/portal_settings/records` →
  `{retention_suggestions_rejected_days: 90,
  retention_suggestions_accepted_days: 90,
  retention_issues_rejected_days: 90, retention_issues_resolved_days:
  365}` — all four match the page.
- en locale on `/impressum`: `lang= en`, English preface note rendered
  („… provided in German only … German text is authoritative“), the
  German legal text kept, draft notice in English, footer labels
  „Imprint“/„Privacy policy“.
- Grep of the sources: no German legal text outside the locale files
  (only the pre-existing `*.tile.openstreetmap.org` tile URLs in
  MapPicker/IssueBoard from M8/M9).
- Grep of the built bundle `ui/dist/@assets/index.js`:
  „Datenschutzerklärung“ ×1 (locale JSON), „tile.openstreetmap.org“ ×2
  (tile URL constant + locale text) — the legal strings enter the
  bundle exactly once, i.e. no other page embeds legal text.

## Acceptance command output (tails)

`cd ui && npm test`:
```
 ✓ src/locales/locales.test.ts (10 tests) 10ms
 ✓ src/lib/markdown.test.ts (13 tests) 53ms

 Test Files  8 passed (8)
      Tests  137 passed (137)
   Start at  15:07:06
   Duration  881ms (transform 415ms, setup 0ms, collect 737ms, environment...)
```

`cd ui && npm run lint`:
```
> weg-portal-ui@0.1.0 lint
> eslint .
```
(no findings, exit 0)

`cd ui && npm run build`:
```
✓ 187 modules transformed.
dist/index.html           0.52 kB
dist/@assets/index.css   37.08 kB
dist/@assets/index.js   838.88 kB
✓ built in 1.90s
```
(`ui/dist/index.html` restored to the committed state after the build.)

`make build`:
```
go build -o weg-portal ./base
```

`go test ./... -count=1`:
```
ok      	weg-portal	1.908s
?   	weg-portal/base	[no test files]
?   	weg-portal/fixturegen	[no test files]
?   	weg-portal/hooks	[no test files]
?   	weg-portal/migrations	[no test files]
?   	weg-portal/ui	[no test files]
```
