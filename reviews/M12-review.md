# M12 review — Legal and operations manual

Reviewer run: branch `m10-m12-work`, commit under review `63a6b86`
(with M10 at `691df59` reviewed separately). Authorship check passed (see
`M10-review.md`). All acceptance and checklist items pass; nothing needed
a review fix.

## Verdict: **APPROVED** (tag `m12-approved`)

## Acceptance re-run (final state)

- `cd ui && npm ci … npm test`: **8 files, 137 tests passed** (incl. the new
  legal-content pins in `src/locales/locales.test.ts:66-130`).
- `cd ui && npm run lint`: clean, exit 0.
- `cd ui && npm run build`: OK (`dist/index.js` 838.88 kB);
  `ui/dist/index.html` restored to committed state afterwards.
- `make build`: OK. `go test ./... -count=1`: `ok weg-portal` (1.944 s).

## Checklist (milestones.md M12)

- [x] **Retention periods and data list match plan.md and the code — all
  four numbers cross-checked three ways:**
  - legal text (`ui/src/locales/de.json:473-476`):
    rejected suggestions **90 d**, accepted suggestions **90 d** (event
    remains), rejected issues incl. photos/email **90 d**, resolved issues
    incl. photos/email **365 d**;
  - `migrations/1795000101_portal_settings_record.go:18-21`:
    90 / 90 / 90 / 365;
  - served record in the fixture DB (live server on a /tmp copy, read
    directly from SQLite + the fixture file `test_pb_data/data.db`):
    `portsettings000 = 90 / 90 / 90 / 365`.
  All four values are identical everywhere and equal the plan.md "Retention"
  defaults. The collection itself stays superuser-only (live: guest
  `GET portal_settings` → 403; all rules `null`), which also justifies
  hardcoding the text.
  - [x] **"Must match portal_settings" note exists**: on the page
    (`de.json:479` — "Die genannten Fristen entsprechen den aktuellen
    Portaleinstellungen … bei jeder Änderung … muss dieser Abschnitt …
    angepasst werden") and, with the explicit technical names, in the
    operations manual (`docs/betriebshandbuch.md:57-63`: collection
    `portal_settings`, record `portsettings000`, **Pflichtfolge**:
    Datenschutzerklärung update required after every change). Pinned by
    the locale test (`locales.test.ts:98-111` asserts 90/90/90/365 +
    "Portaleinstellungen").
  - Processed data list matches plan.md per collection (`de.json:437-459`):
    calendar (public), suggestions (submitter email, beirat-only view),
    issues (3-decimal rounded coords for members, exact position only for
    beirat/HM/HV, client-side EXIF/GPS stripping described, email + optional
    name stored separately), accounts (name, email, role, approval status,
    opt-in notification flag), beirat notes (beirat-only) — consistent with
    the plan.md roles matrix, security table and privacy rows.
- [x] **Legal texts are clearly marked as drafts** — they do NOT read as final
  legal advice:
  - visible draft warning rendered **above the title** on both pages
    (`ui/src/components/LegalText.tsx:20-22`, text `de.json:415`):
    „Hinweis: Entwurf – rechtliche Prüfung ausstehend … muss vor
    Veröffentlichung durch den Beirat … geprüft, ergänzt und freigegeben
    werden. Alle mit TODO(Beirat) markierten Stellen sind vom Beirat
    auszufüllen.“ — verified live logged out.
  - unfilled placeholders `TODO(Beirat)` in Impressum (5×: community name,
    address, board members, contact) and Datenschutz (Verantwortlicher,
    SMTP provider `de.json:465`, backup location `de.json:466`, rights
    contact); manual ends "Stand: Entwurf (M12).TODO(Beirat)…"
    (`betriebshandbuch.md:71-73`).
  - en locale: draft notice translated (English), English preface explains
    the German text is authoritative (`en.legal.englishNote`, rendered only
    for `lang=en`, `LegalText.tsx:23-25`) — verified live via the UI switch.

- [x] **Impressum + Datenschutz publicly reachable without auth**: routes
  `/impressum`, `/datenschutz` sit outside every guard
  (`ui/src/App.tsx:67-69`); both return HTTP 200 for an unauthenticated
  plain `fetch`, and the pages render fully logged out (draft notice,
  all sections) — re-verified in the live run.
- [x] OSM tile server named (`de.json:464`: tile.openstreetmap.org,
  OpenStreetMap Foundation, incl. IP-transmission note — matches plan.md
  "OSM tile server named in privacy policy").
- [x] SMTP provider and backup location marked as placeholders
  (`de.json:465`, `de.json:466`, both `TODO(Beirat)`).
- [x] `docs/betriebshandbuch.md`: **≤ 2 printed pages** (≈411 words ≈ 1
  page); German; covers Beirat tasks incl. **revoke moved-out residents**
  ("Auszug: Freigabe zurückziehen — wirkt sofort", `:13-18`), moderation with
  decision note + visibility choice (`:31-42`), internal notes (`:44-46`),
  **contact path** ("Wer kontaktiert wen?", `:51-56`, with TODO(Beirat)
  placeholders), and a superuser section with **two superuser accounts**
  (`:48`), **MFA** (`:49`), backups, roles, and the rule that **changing
  retention in `/_/` → `portal_settings` requires updating the
  Datenschutzerklärung** (`:56-63`).

## Live run-through (documented, re-done by reviewer)

Logged out (guest) on a `/tmp` fixture copy with the `make build` binary
(killed by PID afterwards; `test_pb_data` untouched):

- Calendar `/` as guest shows the footer: `[Impressum → /impressum,
  Datenschutz → /datenschutz]`; `scrollWidth = 375` at a 375 px viewport —
  no horizontal overflow.
- `/impressum` logged out: h1 „Impressum“; sections „Angaben gemäß § 5 DDG“,
  „Verantwortlich für den Inhalt“, „Zweck des Portals“; draft notice
  visible; 5× `TODO(Beirat)`; no overflow @375 px.
- `/datenschutz` logged out: h1 „Datenschutzerklärung“; sections
  Verantwortlicher / Welche Daten / Empfänger und Dienstleister /
  Speicherdauer und Löschfristen / Ihre Rechte; draft notice visible;
  retention sentences 90/90/90/365 + pending-never-deleted + the
  Portaleinstellungen-match note rendered verbatim; OSM/SMTP/backup present;
  Art. 15–21 + Aufsichtsbehörde + photo-consent revocation; no overflow
  @375 px.
- EN locale via the UI switch: `document.documentElement.lang=en`, English
  draft notice, English preface „provided in German only … The German text
  is authoritative“, German legal text kept, footer `Imprint` /
  `Privacy policy` — the documented i18n decision behaves as described.
  (Pure static rotor: `localStorage['weg-portal-lang']` persists the choice.)
- Footer links visible on every page incl. guests; no auth API involvement
  (legal text ships in the locale bundle; `portal_settings` stays 403 for
  guests).

## Answers to handoff open questions

1. **Footer-only placement of Impressum/Datenschutz** — acceptable. The
   milestone wording is "footer/nav"; the nav is already tight at 375 px and
   legal links do not belong between primary navigation items. Both links
   are visible for guests on every page through the footer.
2. **Naming the record id `portsettings000` in the manual** — keep it. It
   sends the superuser straight to the single record and is
   migration-defined; if a future migration ever changes ids, the manual
   section names the collection `portal_settings` as well.
3. **Datenschutz data list covering all collections incl. the public
   calendar** — correct and complete per the M12 task list ("Liste der
   verarbeiteten Daten pro Collection"); the wording was checked against
   plan.md's roles matrix, security table and privacy rows. The remaining
   legal-wording review belongs to the human/Beirat pass — the deliberately
   prominent draft marking covers this state properly.

## Findings

- **O1 (info, no action)** — the Datenschutz page words the requirement as
  „aktuelle Portaleinstellungen“ rather than the literal collection name
  `portal_settings` (the manual uses the literal name; the locale test pins
  the German wording). Content-wise the note exists on both surfaces; naming
  a DB collection in a public privacy policy would arguably be worse, so
  this is fine as is.
- **O2 (info, no action)** — retention values are hardcoded in the locale
  text with no runtime tie-in to `portal_settings` (public page cannot read
  the superuser-only record). This is exactly what the milestone asks for
  ("the current defaults, with a note that they must match
  `portal_settings`"), and the match is pinned by tests and re-verified
  here; the manual's Pflichtfolge closes the loop operationally.

No code changes applied — nothing rose to the level of a review fix.
