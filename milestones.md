# WEG Portal — Milestones

Execution plan for [`plan.md`](plan.md). Each milestone is implemented by an
**implementer agent** (cheaper model) and then checked by a **reviewer agent**
(stronger model) before the next milestone starts.

## Rules for the implementer

1. Work on **one milestone at a time**. Do not start the next one until the
   reviewer has approved the current one.
2. `plan.md` is the specification. Do not change it. If the plan is wrong,
   ambiguous or impossible, stop and write the question into the handoff file
   (see below) instead of guessing.
3. Use `../bugstage` as the reference for structure and PocketBase API usage.
   Read the matching BugStage file before writing a new kind of file
   (hook, migration, test, embed). Do not copy BugStage features that the
   plan does not mention (git, ssh, feeds, self-update, jsvm).
4. Stay inside the milestone's scope. No extra features, no refactors of
   earlier milestones unless the reviewer asked for them.
5. Every acceptance command listed in the milestone must pass. Paste its real
   output (last ~20 lines) into the handoff file. Never claim a test passes
   without running it.
6. Never weaken a test or access rule to make a test pass. If a security test
   fails, the code is wrong, not the test.
7. Commit at the end of the milestone: `git commit -m "M<n>: <title>"` and
   `git tag m<n>-impl`.

### Handoff file

At the end of each milestone, create `reviews/M<n>-handoff.md`:

```markdown
# M<n> handoff
## Done
- …
## Not done / deviations from plan.md (with reason)
- …
## Open questions for the reviewer
- …
## Acceptance command output
<paste>
```

## Rules for the reviewer

1. Read `plan.md`, the milestone section below, the handoff file and
   `git diff m<n-1>-approved..m<n>-impl`.
2. Re-run all acceptance commands yourself.
3. Go through the milestone's **review checklist**; these are the places where
   mistakes are most likely and most expensive.
4. Write `reviews/M<n>-review.md` with: verdict (`approved` / `changes requested`),
   findings (file:line, what's wrong, how to fix), and answers to open questions.
5. Small fixes: apply them directly, note them in the review. Anything larger:
   request changes and let the implementer redo it.
6. On approval: `git tag m<n>-approved`. If a finding means `plan.md` must
   change, the reviewer updates `plan.md` (the implementer never does).

---

## M0 — Repository scaffold

**Goal:** an empty PocketBase app in Go mode that builds, runs and serves a placeholder page.

Tasks:
- `git init`; `.gitignore` (pb_data/, ui/node_modules/, ui/dist/ except a placeholder, binaries).
- `go.mod` (module `weg-portal`), pin `ganigeorgiev.com/pocketbase/pocketbase` to the
  same version as `../bugstage/go.mod`.
- `portal.go` with `New()` and `bindAppHooks()` modeled on `../bugstage/bugstage.go`:
  static SPA handler serving the embedded UI, CSP + cache headers.
- `base/main.go` modeled on `../bugstage/base/main.go`, **without** jsvm, update plugin and ssh.
  Keep `migratecmd` (Go templates).
- `ui/embed.go` (`//go:embed all:dist`) and a placeholder `ui/dist/index.html` so the build works before React exists.
- `Makefile` targets: `build`, `run`, `test`.
- Initial commit tagged `m0-approved` by the reviewer after review.

Acceptance:
- `go build ./... && go vet ./...`
- `go run ./base serve` → `curl -sI localhost:8090/` shows status 200 and a `Content-Security-Policy` header.

Review checklist:
- [ ] No jsvm, no self-update, no ssh code.
- [ ] PocketBase version pinned and identical to BugStage's.
- [ ] CSP allows OSM tile images (`img-src` must include `https://*.tile.openstreetmap.org` and `blob:`).

---

## M1 — Collections, rules, indexes (migrations)

**Goal:** the complete data model from `plan.md` → "Collections and access", as Go migrations.

Tasks:
- `migrations/<ts>_collections.go`: `users` fields, `events`, `suggestions`,
  `issues`, `issue_metas`, `notes`, with **exactly** the rules from plan.md
  (expand the helper expressions `B`, `STAFF`, `APPROVED` inline).
- `issues.lat_exact`, `issues.lng_exact`: `Hidden: true`.
- `issues.photos`: `Protected: true`, max 5 files, 5 MB, mime jpeg/png/webp, thumbs `100x100`, `600x0`.
- `issue_metas.issue`: relation, `CascadeDelete: true`, unique index.
- Select fields: `users.role`, `suggestions.status` (`pending|accepted|rejected`),
  `issues.status` (`pending|open|in_progress|resolved|rejected`), `issues.visibility` (`community|private`).
- Indexes: `events(date_start)`, `issues(status)`, `suggestions(status)`.
- `portal_settings` collection (all rules `null`) with the four retention fields
  (number, onlyInt, min 1, max 3650) and a migration that inserts the single
  record with the plan.md defaults.
- `migrations/<ts>_settings.go`: app name, rate-limit rules (plan: "Public submission routes"),
  file-token settings. SMTP is configured via env, not committed.

Acceptance:
- `go build ./... && go vet ./...`
- `go run ./base serve` on a fresh `pb_data` applies migrations without error.
- Handoff includes a table: collection → each rule string as stored.

Review checklist:
- [ ] Every rule string matches plan.md character-for-character after expanding helpers. Pay attention to `null` (superuser only) vs `""` (public).
- [ ] `issues` and `issue_metas` have `createRule = null`.
- [ ] Users self-update rule blocks `role`, `approved`, `verified`.
- [ ] Hidden + protected flags set.
- [ ] Cascade delete on `issue_metas.issue`.

---

## M2 — Test fixtures and role-matrix API tests

**Goal:** prove the access model before any feature code exists. This is the most important milestone.

Tasks:
- `test_pb_data/`: fixture DB (create with a migration-backed script, document how in `test_pb_data/README.md`) containing:
  users `guest` (none), `unapproved@` (resident, approved=false), `resident@`,
  `beirat@`, `hm@` (hausmeister), `hv@` (hausverwaltung); events; suggestions in each status;
  issues in each status × visibility, with exact and rounded coords and one photo; metas; notes.
- `setupTestApp` + `getAuthToken` helpers modeled on BugStage's tests.
- `hooks/issueEnrich.go`: `OnRecordEnrich("issues")` unhides `lat_exact`/`lng_exact` for beirat/HM/HV.
- `api_<collection>_test.go` for every collection: list, view, create, update, delete × all six identities,
  using `tests.ApiScenario`, following the roles matrix in plan.md.
- Explicit security tests:
  - resident list/view of issues never contains `lat_exact`, `email`, pending/rejected/private issues;
  - resident `?filter=lat_exact>0` returns the same count as no filter (filter on hidden field has no effect or errors);
  - resident `?expand=` on anything cannot reach `issue_metas`;
  - unapproved resident sees no issues;
  - resident cannot set own `role`/`approved`; beirat cannot set `role`;
  - hausmeister cannot change `visibility`, title, or accept a `pending` issue; hausverwaltung cannot update at all;
  - protected photo URL without token → 404/403; with resident token on a private issue → denied.
- Realtime: a test (or documented manual check script) that a resident subscription on `issues` receives no private/pending records and no exact coords.

Acceptance:
- `go test ./... -count=1` passes.
- Handoff contains the test count per collection.

Review checklist:
- [ ] Each identity × operation × collection actually exists as a scenario (count them).
- [ ] Negative tests assert **absence** (`NotExpectedContent`) of `lat_exact`, `email`, private titles.
- [ ] Filter-probing test exists and is meaningful (fixture has issues on both sides of the filter value).
- [ ] No rule was changed relative to M1 to make tests pass (diff `migrations/`).
- [ ] If `Unhide` or hidden-field filtering does not behave as plan.md assumes, the implementer stopped and reported it rather than working around it.

---

## M3 — Public submission

**Goal:** residents without an account can submit suggestions and issues safely.

Tasks:
- `hooks/submitIssue.go`: `POST /api/portal/issues` exactly as specified in plan.md
  (validation, bounding box from env/settings, honeypot, time-trap, transaction, `{ok:true}` response, coords rounded to 3 decimals server-side).
- `hooks/suggestionCreate.go`: honeypot + time-trap on `OnRecordCreateRequest("suggestions")`; response must not echo the email.
- `hooks/usersCreate.go`: force `role=resident`, `approved=false` for non-superuser creates; default `notify_new_issues=true` for HM/HV created by superuser.
- Tests for: valid submission, each validation failure, honeypot, too fast, out-of-bounds coords, 6 photos, wrong mime, transaction rollback (meta failure → no issue left), guest cannot read back what was submitted.

Acceptance: `go test ./... -count=1`.

Review checklist:
- [ ] Issue + meta created in one `RunInTransaction`; files saved inside it.
- [ ] Client-supplied `status`, `visibility`, `lat_exact` etc. are ignored, not trusted.
- [ ] Rounding happens on the server.
- [ ] Response contains no id/email/record.
- [ ] Rate-limit rule covers `/api/portal/issues` and suggestion create.

---

## M4 — Workflows and mail

**Goal:** status transitions are enforced and everybody is notified correctly.

Tasks:
- `hooks/issueWorkflow.go`: transition validation (plan.md diagram), `visibility` required on accept, sets `decided_at`/`resolved_at`.
- `hooks/suggestionWorkflow.go`: on `pending → accepted` create the `events` record (copy date fields, `rrule` empty) in the same transaction; set `decided_at`.
- `hooks/mail.go` + `hooks/templates/*.html`: all triggers in plan.md "Notifications and email", sent via `routine.FireAndForget`, only when status changed.
- Tests using PocketBase's test mailer (`app.TestMailer`): which mail goes to whom for each transition; no mail on non-status updates; HM/HV opt-out respected.

Acceptance: `go test ./... -count=1`.

Review checklist:
- [ ] **No user-supplied text** (title, description, name) in any mail to a submitter address. Check every template.
- [ ] Mail only on actual status change (`Original()` compared).
- [ ] Invalid transitions return 400 for beirat too (e.g. `resolved → pending`).
- [ ] Event creation and suggestion update are atomic.

---

## M5 — Retention, iCal, settings

Tasks:
- `hooks/retention.go`: daily cron (`app.Cron().MustAdd`) implementing the retention table; deletes through `app.Delete` so files and cascades are handled.
  Periods are read from the `portal_settings` record on every run; if it is missing, log an error and delete nothing. Log deleted counts per category.
- `hooks/portalSettings.go`: reject creating a second `portal_settings` record and deleting the existing one.
- `hooks/ical.go`: `GET /api/portal/calendar.ics`, valid RFC 5545 (CRLF line endings, line folding at 75 octets, escaping, `RRULE` passed through, stable `UID`).
- Backup settings in the settings migration (cron, keep N, S3 via env).
- Tests: retention with fixture records at boundary dates; changed setting values take effect on the next run; missing settings record → nothing deleted; non-superusers get no access to `portal_settings`; ICS output for a single, an all-day and a recurring event.

Acceptance: `go test ./... -count=1`; ICS validated with an online or `python -I -c "import icalendar"` parser if available (note in handoff which).

Review checklist:
- [ ] Pending items are never deleted.
- [ ] Retention uses `decided_at`/`resolved_at`, not `updated`.
- [ ] No hard-coded retention days in the cron (only the migration's defaults); no fallback that deletes when settings are missing.
- [ ] ICS escapes `,` `;` `\` and newlines; all-day events use `VALUE=DATE`.

---

## M6 — Frontend scaffold and public calendar

Tasks:
- `ui/`: Vite + React + TS, ESLint, `vite build` outputs to `ui/dist`.
- `lib/pbClient.ts`, `lib/i18n.ts` (de default, en), `locales/de.json`, `en.json`.
- Design tokens in CSS custom properties derived from `../bugstage/ui/src/css/vars.css`; light/dark.
- Router; layout; `LangSwitch`.
- `PublicCalendar` + `EventDetail`: range query + all `rrule` events, expansion via `rrule` (`lib/recurrence.ts` with unit tests in vitest).
- iCal subscribe link.

Acceptance: `cd ui && npm run build && npm test`; `make build` embeds it; page works at 375 px width without horizontal scroll.

Review checklist:
- [ ] Recurring events that started before the visible range appear.
- [ ] No hard-coded German strings outside `locales/`.
- [ ] Role read from `pb.authStore.record`, never decoded from the JWT.

---

## M7 — Suggestion form and moderation queue

Tasks:
- `NewSuggestion` (react-hook-form + zod, honeypot, `form_started_at`, email required).
- `Login`, minimal auth state.
- `ModerationQueue` (beirat): pending suggestions + pending issues tabs; accept/reject with `decision_note`; issue accept requires choosing visibility.
- `UserApproval` (beirat): list unapproved verified users, approve/revoke.

Acceptance: `npm run build && npm test`; manual run-through documented in handoff (screenshots optional).

Review checklist:
- [ ] Beirat-only pages are also protected server-side (they are, by rules) and hidden in UI.
- [ ] Error states shown for rate limit (429) and validation (400).

---

## M8 — Issue reporting

Tasks:
- `MapPicker` (react-leaflet, OSM tiles with attribution, bounding box, "use my location").
- `PhotoInput` + `lib/exifStrip.ts`: downscale to max 2000 px, re-encode via canvas (`createImageBitmap(file, {imageOrientation: 'from-image'})`), max 5.
- `NewIssue` posting multipart to `/api/portal/issues`; photo-consent checkbox; honeypot; time-trap.

Acceptance: `npm run build && npm test` (unit test that exifStrip output has no EXIF segment); manual test on a phone documented, including an iPhone HEIC photo if available.

Review checklist:
- [ ] Original file never uploaded; only the re-encoded blob.
- [ ] Map tiles + attribution correct; no other third-party requests (check network tab).

---

## M9 — Issue board, accounts, realtime

Tasks:
- `Signup` (email verification flow), `ProfileSettings` (name, `notify_new_issues` for HM/HV, password, email change).
- `IssueBoard` (list + map, filters by status/category), `IssueDetail` (photos with file token, status change for beirat/HM).
- Realtime subscription on `issues`, unsubscribe on unmount.
- Unapproved users see an explanatory "waiting for approval" page.

Acceptance: `npm run build && npm test`; manual role run-through (resident, HM, HV, beirat) documented.

Review checklist:
- [ ] Residents' map uses rounded `lat`/`lng`; exact fields only used if present.
- [ ] File tokens refreshed before expiry.
- [ ] Status buttons match the transition diagram per role.

---

## M10 — Notes

Tasks: `Notes` page (beirat): list, pinned first, create/edit/delete, markdown rendered with sanitization (DOMPurify, as in BugStage).

Acceptance: `npm run build && npm test`.

Review checklist:
- [ ] `author` set from auth, cannot be spoofed (server rule from M1).
- [ ] Markdown output sanitized.

---

## M11 — Deployment

Tasks:
- Multi-stage `Dockerfile` (node → ui/dist, golang → static binary, minimal runtime image, non-root user).
- `compose.yaml`: `caddy` + `portal`, `pb_data` volume, env file for SMTP/S3/bounding box.
- `Caddyfile`: TLS, HSTS, `/_/` restricted (IP allowlist or basic auth), proxy to portal, realtime (SSE) not buffered.
- `docs/deploy.md`: first start, creating the two superusers, enabling superuser MFA, restore-from-backup drill, update procedure (test against a copy of pb_data).

Acceptance: `docker compose build && docker compose up -d`; `curl` checks for HSTS, CSP, `/_/` blocked from outside; backup created and restored once (documented).

Review checklist:
- [ ] No secrets in repo or image.
- [ ] Restore drill actually performed.

---

## M12 — Legal and operations manual

Tasks:
- `Impressum`, `Datenschutz` pages (content placeholders clearly marked `TODO(Beirat)`; list of processed data, OSM tile server, SMTP provider, backup location, retention periods — the current defaults, with a note that they must match `portal_settings`).
- `docs/betriebshandbuch.md`: German, max. 2 pages: approve accounts, accept/reject suggestions and issues, choose visibility, revoke moved-out residents, whom to contact; for superusers: changing retention in `/_/` → `portal_settings` requires updating the Datenschutzerklärung.

Review checklist:
- [ ] Retention periods and data list match plan.md and the code.
- [ ] Legal texts are marked as drafts needing human/legal review — the agent must not present them as final.
