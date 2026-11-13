# WEG Community Portal — Plan

Status: planned, implementation not started. Execution is split into milestones in
[`milestones.md`](milestones.md).
Stack: PocketBase **used as a Go library** (SQLite backend), React SPA embedded
into the binary. Deployment: own VPS, Docker. Structural template: `../bugstage`.

## Requirements

1. Public calendar, usable by any resident without an account.
2. Form for suggesting calendar entries; accepted or rejected by a Beirat member.
3. Form for reporting community issues, with map location and photo attachments.
4. Every form collects an email so accept/reject can be reported back.
5. Issue board for the Beirat; read-only view of accepted issues for community members (account required).
6. Internal notes area for the Beirat.

Additional decisions made during planning:

- UI bilingual (German default, English later via react-i18next).
- Map: Leaflet + OpenStreetMap (no API key, no data to Google).
- Issues pass through a Beirat moderation step (`pending` → accepted) before becoming visible.
- Issues are tagged `community` or `private` (visibility decided by the Beirat on acceptance).
- Roles: `resident`, `beirat`, `hausmeister`, `hausverwaltung`.
- Frontend design language modeled on BugStage's design tokens (`../bugstage/ui/src/css/vars.css`).
- Status vocabulary is shared: `pending`, `rejected` for both suggestions and issues.
- The Beirat never uses the PocketBase admin UI (`/_/`); everything it does goes
  through the normal API and the SPA. Superusers are only for setup and roles.

## Architecture

```
Caddy (TLS termination, HSTS, optional IP allowlist for /_/)
  └── weg-portal container (single Go binary)
        ├── PocketBase core: API, auth, files, realtime, rate limits, backups
        ├── hooks/      – Go hooks + custom routes (one file per concern)
        ├── migrations/ – Go migrations (collections, rules, indexes)
        ├── ui/dist     – built React SPA, embedded via go:embed
        └── pb_data/    – SQLite + uploads (single Docker volume)
```

Layout copied from BugStage:

```
weg-portal/
├── portal.go          New()/bindAppHooks(): static SPA handler (CSP, cache headers) + hook registration
├── base/main.go       main(): flags, migratecmd, app.Start()  (no self-update plugin)
├── hooks/             one exported func per concern, e.g. hooks.IssueWorkflow(app)
├── hooks/templates/   mail templates (html/template)
├── migrations/        Go migrations
├── ui/                Vite + React app, ui/embed.go (//go:embed all:dist)
├── api_*_test.go      tests.ApiScenario tests against test_pb_data/
└── test_pb_data/      fixture DB with one user per role
```

- Docker: multi-stage build (node → `ui/dist`, golang → static binary, distroless/alpine runtime).
- PocketBase version pinned in `go.mod`; updates are tested against a copy of
  `pb_data` before rollout. No auto-update plugin. (Module path:
  `ganigeorgiev.com/pocketbase/pocketbase`, same as BugStage.)
- `jsvm` plugin is **not** registered: all logic is Go so it is typed and testable.
- Backups: PocketBase built-in scheduled backups (consistent SQLite snapshot),
  uploaded to S3-compatible offsite storage; encrypted at the bucket/provider
  level or via a post-backup `age` step. Never copy the live DB file.
- Rate limiting: PocketBase built-in rate limiter (settings set in a migration),
  not Caddy (stock Caddy has no rate limiter).

## Collections and access

PocketBase rule conventions: `""` = everyone including guests, `null` = superuser only.
Helper expressions used below:

- `B` = `@request.auth.role = 'beirat'`
- `STAFF` = `@request.auth.role = 'hausmeister' || @request.auth.role = 'hausverwaltung'`
- `APPROVED` = `@request.auth.approved = true && @request.auth.verified = true`

| Collection | Core fields | Create | List/View | Update | Delete |
|---|---|---|---|---|---|
| `users` (auth) | role (select), approved (bool), notify_new_issues (bool), name | public; hook forces `role=resident`, `approved=false` | own record, or `B` | see below | superuser |
| `events` | title, description, date_start, date_end, all_day, location, category, rrule (text, RFC 5545, optional) | `B` | `""` | `B` | `B` |
| `suggestions` | title, description, date_start, date_end, all_day, location, category, **email**, status, decision_note, decided_at | `""` via rule forcing `status='pending'` | `B` | `B` | `null` (retention cron) |
| `issues` | title, description, category, lat, lng (rounded, 3 decimals), **lat_exact, lng_exact (schema-hidden)**, photos[] (protected), status, visibility, decided_at, resolved_at | via custom route only (`null` on the collection) | see "Issue read rule" | `B`, or `STAFF` limited to status (see below) | `null` (retention cron) |
| `issue_metas` | issue (relation, unique, cascade delete), **email**, name (optional) | via custom route only (`null`) | `B` | `null` | cascade |
| `notes` | title, body, author (relation users), pinned | `B && @request.body.author = @request.auth.id` | `B` | `B` | `B` |
| `portal_settings` | retention day fields (see "Retention") — single record | `null` | `null` | `null` | `null` |

### Users: updates and approval

- Own record: `@request.auth.id = id && @request.body.role:isset = false && @request.body.approved:isset = false && @request.body.verified:isset = false`.
  Email changes go through PocketBase's email-change flow only.
- Beirat approval: `B && @request.body.role:isset = false && @request.body.email:isset = false && @request.body.name:isset = false`
  — i.e. the Beirat may only flip `approved` (and `notify_new_issues`). A Go hook
  additionally rejects any non-superuser request that changes `role`.
- Roles other than `resident` are set by a superuser only.
- On create of a `hausmeister`/`hausverwaltung` user, a hook sets
  `notify_new_issues = true` unless explicitly given.
- Moved-out residents: Beirat sets `approved = false` (takes effect immediately,
  because rules read the DB, not the token).

### Issue read rule (list + view)

```
B
|| (@request.auth.id != "" && (APPROVED) && status != 'pending' && status != 'rejected'
    && (visibility = 'community' || STAFF))
```

Exact coordinates: `lat_exact`/`lng_exact` are marked `hidden` in the schema
(never returned or filterable for non-superusers). An `OnRecordEnrich("issues")`
hook calls `e.Record.Unhide("lat_exact","lng_exact")` for beirat/hausmeister/
hausverwaltung. Enrich also runs for realtime events, so the same rule
covers subscriptions. **This must be proven by tests** (see M2): residents
get no exact fields in list, view, expand, and realtime responses, and
`?filter=lat_exact>0` must not narrow results for a resident.

### Issue update rule

```
B
|| (@request.auth.role = 'hausmeister' && (APPROVED)
    && (status = 'open' || status = 'in_progress')
    && (@request.body.status = 'in_progress' || @request.body.status = 'resolved')
    && @request.body.title:isset = false && @request.body.description:isset = false
    && @request.body.category:isset = false && @request.body.visibility:isset = false
    && @request.body.lat:isset = false && @request.body.lng:isset = false
    && @request.body.lat_exact:isset = false && @request.body.lng_exact:isset = false
    && @request.body.photos:isset = false)
```

Plus a Go hook (`hooks/issueWorkflow.go`) that validates every status
transition server-side, regardless of role:

```
pending ──accept (beirat, must set visibility)──► open ──► in_progress ──► resolved
   └──reject (beirat)──► rejected
```

Disallowed transitions return 400 — for beirat/superusers too. Submitting the
**same** status as the stored one is rejected as well (M4 review decision: a
repeated accept is a client error, not a no-op; `status` must only be sent
when it actually changes), while updates that do not send `status` at all
(beirat content edits) remain allowed. The hook sets `decided_at` /
`resolved_at` and they are **hook-owned**: the stored values are restored on
every update before the transition is applied, so a client can never forge
them (the beirat update rule is otherwise unrestricted). The same moderation
semantics apply to suggestions via `hooks/suggestionWorkflow.go`
(`pending → accepted|rejected` only, same-status rejection, hook-owned
`decided_at`); on accept the `events` record is created in the same
transaction as the suggestion update.

### Roles matrix (`users.role`)

| | Resident | Beirat | Hausmeister | Hausverwaltung |
|---|---|---|---|---|
| Public calendar | read | read + write | read | read |
| Suggestion queue | – | full | – | – |
| Issue board + map | accepted, community, rounded coords | all incl. pending/rejected/private, exact coords | accepted incl. private, exact coords | accepted incl. private, exact coords |
| Change issue status (`open`→`in_progress`→`resolved`) | – | yes | yes | no |
| Accept/reject, set `visibility` | – | yes | – | – |
| Approve resident accounts | – | yes | – | – |
| Beirat notes | – | full | – | – |
| Submitter emails | – | yes | – | – |

### Public submission routes

Collections `issues` and `issue_metas` have `createRule = null`. Submission goes
through one custom route so the issue, its exact location and the submitter
email are written atomically:

- `POST /api/portal/issues` (multipart): fields title, description, category,
  lat, lng, email, name?, photo_consent, honeypot, form_started_at, photos[].
  - validates input (lengths, lat/lng within a configured bounding box around
    the property, max 5 photos, jpeg/png/webp, ≤ 5 MB each);
  - honeypot must be empty, `now - form_started_at ≥ 3 s`;
  - in `app.RunInTransaction`: create `issues` (status `pending`, rounded +
    exact coords) and `issue_metas`;
  - returns `{ "ok": true }` only — never the record.
- Suggestions use the normal collection create endpoint
  (`createRule: @request.body.status = 'pending' && @request.body.decision_note:isset = false && @request.body.decided_at:isset = false`)
  plus a `OnRecordCreateRequest("suggestions")` hook enforcing honeypot/time-trap.
- Both are covered by PocketBase's rate limiter (e.g. 5 requests / 10 min / IP on
  these two endpoints).

### Files

- `issues.photos` is a **protected** file field: URLs work only with a file token
  (`pb.files.getToken()`), and access follows the issue's view rule. Without this,
  photos of pending/private issues would be reachable by URL.
- Thumbnails: `100x100`, `600x0`.
- EXIF/GPS stripped client-side by re-encoding through a canvas (honours
  orientation; HEIC from iOS is converted by the browser's file picker; test it).
  The server cannot verify this; acceptable since only the uploader's own
  privacy is affected.

## Notifications and email

- SMTP provider for the app domain with SPF/DKIM/DMARC — deliverability is the
  basis of the whole reply-by-mail principle.
- Mails are sent from `OnRecordAfterUpdateSuccess` / `AfterCreateSuccess` hooks
  via `routine.FireAndForget` (BugStage pattern), and **only when `status` actually
  changed** (`e.Record.Original().GetString("status") != e.Record.GetString("status")`).
- **No user-supplied text (title, description, name) is copied into mails sent to
  submitter addresses** — the addresses are unverified, so echoing content would
  make the portal a spam relay. Mails to submitters contain a fixed text, the
  decision, and the Beirat's `decision_note` (Beirat-authored, trusted).
  Mails to Beirat/staff accounts may contain the content.
- Triggers:
  - suggestion accepted → hook creates `events` record, mails submitter;
  - suggestion rejected → mails submitter with optional decision note;
  - issue accepted / rejected / status changed → mails submitter (via `issue_metas`);
  - new suggestion / issue → mails all `beirat` users;
  - issue accepted → mails hausmeister/hausverwaltung with `notify_new_issues = true`
    (skips silently if none).
- Templates in `hooks/templates/*.html`, German first (i18n keys prepared).

## Retention (daily cron in a Go hook)

Retention periods are configurable by a superuser in the PocketBase admin UI
(`/_/` → collection `portal_settings`), not hard-coded. `portal_settings` is a
single-record collection (all API rules `null` = superuser only; a migration
creates the one record with the defaults below; a hook rejects creating a
second record and deleting the existing one).

| Setting field | Applies to | Default |
|---|---|---|
| `retention_suggestions_rejected_days` | suggestions `rejected`, after `decided_at` | 90 |
| `retention_suggestions_accepted_days` | suggestions `accepted`, after `decided_at` (the event remains) | 90 |
| `retention_issues_rejected_days` | issues `rejected` incl. metas + photos, after `decided_at` | 90 |
| `retention_issues_resolved_days` | issues `resolved` incl. metas + photos, after `resolved_at` | 365 |

- Fields are numbers, `onlyInt`, min `1`, max `3650`. There is no "keep forever"
  value: GDPR requires a defined period.
- Pending items are never deleted automatically; they stay in the moderation queue.
- The cron reads the record on every run, so changes apply from the next run
  without a restart. If the record is missing or unreadable, the cron logs an
  error and **deletes nothing** (it never falls back to silently deleting).
- Every run logs how many records it deleted per category.
- `issue_metas` is removed by cascade delete; files are removed by PocketBase with the record.
- The Datenschutzerklärung states the periods; the operations manual says it must
  be updated whenever a superuser changes them.

## Security

| Threat | Mitigation |
|---|---|
| Submitter emails leak | Emails only in Beirat-only `suggestions` / `issue_metas`; separate collection for issue emails; never in API responses for others |
| Reporter/issue location privacy | exact coords in schema-hidden fields, unhidden by enrich hook for beirat/HM/HV only; residents see 3-decimal rounding (~100 m); tested incl. realtime and filter probing |
| Privilege escalation | role only settable by superuser (rule + Go hook); Beirat can change only `approved`/`notify_new_issues`; create hook forces `resident` |
| Staff overreach | Hausmeister update rule whitelists status only; transition hook validates every change |
| Strangers reading the board | read requires approved + verified account |
| Photos reachable by URL | protected file field + file tokens |
| Photo EXIF (photographer GPS) | stripped client-side before upload |
| Upload abuse | mime whitelist, size/count limits, client-side downscaling, rate limit |
| Form spam / mail relay | PocketBase rate limiter, honeypot + time-trap, no user text in submitter mails, optional Turnstile later |
| Transport | HTTPS + HSTS by Caddy; CSP + cache headers set by the SPA handler (BugStage pattern) |
| Data at rest / GDPR | Impressum + Datenschutzerklärung; photo-consent checkbox; OSM tile server named in privacy policy; encrypted offsite backups; retention cron (above) |
| Admin exposure | `/_/` IP-allowlisted or basic-auth'd in Caddy; superuser MFA (password + email OTP, PocketBase built-in); two superusers minimum |

## Frontend

Vite + React + TypeScript, PocketBase JS SDK, react-leaflet (OSM tiles),
react-i18next (de default + en), react-hook-form + zod, rrule (recurrence
expansion). Role is read from `pb.authStore.record.role` (not from the JWT, which
carries no custom claims); the server rules are authoritative. No component
library — hand-rolled CSS with custom properties modeled on BugStage's tokens.

```
ui/src/
├── pages/      PublicCalendar, EventDetail, NewSuggestion, NewIssue,
│               ModerationQueue (beirat), IssueBoard, IssueDetail, Notes (beirat),
│               UserApproval (beirat), Login, Signup, ProfileSettings,
│               Impressum, Datenschutz
├── components/ MapPicker, PhotoInput, StatusBadge, LangSwitch, VisibilityChip
├── lib/        pbClient, i18n, validation, recurrence, exifStrip
└── locales/    de.json, en.json
```

Calendar loading: query non-recurring events by date range, plus **all** events
with a non-empty `rrule` (a range query would miss series that started earlier),
then expand recurrences client-side.

Dates and time zones (replaces the M6 review decision "UTC wall-clock
semantics"):

- Timed values are stored as UTC instants; the SPA converts form input from
  the viewer's local time.
- All-day values are calendar **dates**, stored as UTC midnight of that date
  (`2026-12-24 00:00:00.000Z`) and exported as `VALUE=DATE`. Legacy values
  holding local midnight in UTC are rounded to the nearest date.
- Recurring **timed** events repeat at the same local wall time in the portal
  time zone (`PORTAL_TIMEZONE`, IANA name, default `Europe/Berlin`, delivered
  to the SPA by `GET /api/portal/config`). The SPA expands them in that zone;
  the iCal export writes them as `DTSTART;TZID=<zone>:<local time>` plus a
  generated `VTIMEZONE`. Single timed events stay `DTSTART:...Z`.
- Mails show dates in the portal time zone.

## Owner portal (post-M12 extension)

Accounts are for **owners only**; tenants use the public pages without an
account. "Owners" visibility therefore means *any approved, verified
account* (owners, Beirat, Hausmeister, Hausverwaltung). Migration
`1795000105_owner_portal.go`, hooks `ownerPortal.go` / `ownerMail.go`,
tests `api_owner_portal_test.go`.

| Collection | Purpose | Read | Write |
|---|---|---|---|
| `events.calendar` | three calendars: `public`, `owners`, `beirat` | public: all; owners: approved; beirat: B | B |
| `announcements` | Aushänge (markdown, pinned, expiry) | public or owners, expired hidden (B sees all) | B, author = self, author immutable |
| `contacts` | emergency services, Beirat, Verwaltung, Hausmeister | public or owners | B |
| `documents` | protected file; view rule gates download (public docs need no token) | public or owners | B |
| `issue_events` | status history (server-written) + internal notes | B, or staff for accepted issues | notes only: B/staff, actor = self |
| `agenda_items` | topics for the owners' meeting, Beirat accepts/rejects | B; owners: own + accepted | owners create (pending, self); B decides |
| `polls`, `poll_votes` | non-binding opinion polls; one vote per account | polls: approved; votes: own only | B creates polls; owners vote while open |

- Results of polls only as aggregates (`GET /api/portal/polls/{id}/results`).
- Logged-in submissions are linked (`issue_metas.user`, `suggestions.user`,
  Beirat-only) and listed via `GET /api/portal/my-submissions`.
- Personal iCal feed: `POST /api/portal/calendar-token` creates/renews a
  secret; `calendar.ics?token=…` includes the calendars the account may see
  *at request time*; `&calendar=` narrows it. Non-public events: `CLASS:PRIVATE`.
- Opt-in mails (`notify_announcements`, `notify_events`) go to verified
  accounts that can see the content, one mail per recipient.
- Owners delete their own account; Beirat/staff accounts stay
  superuser-managed. Optional references are cleared, votes deleted.
- Polls are explicitly not resolutions (§ 23 WEG); the binding
  Beschluss-Sammlung (§ 24 WEG) stays with the Verwaltung.

## Other planned items

1. Recurring events: `rrule` string, expanded client-side in the portal time
   zone; iCal export emits it as-is (see "Dates and time zones").
2. Beirat/staff notifications on new suggestions/issues (hooks).
3. Email deliverability: SPF/DKIM/DMARC, SMTP provider.
4. Legal: Impressum, Datenschutzerklärung, photo-consent checkbox.
5. Account lifecycle: Beirat revokes `approved` for moved-out residents; retention cron.
6. Anonymous reports cannot be edited/deleted by their submitter — stated
   transparently; "contact the Beirat" as remedy.
7. iCal export: `GET /api/portal/calendar.ics` rendering `events`.
8. Two superusers + 2-page German operations manual for the Beirat
   (approve accounts, accept/reject, set visibility).
9. Mobile-first: forms and map designed and tested primarily on phones.

Explicitly out of scope: issue comment threads (use chat), self-hosted tile
server, uptime monitoring (ops decision), Turnstile (only if spam appears).

## Alternatives considered

- Node + Hono (+ better-auth, Drizzle, better-sqlite3): rejected — roughly 4x
  the code (auth, verification, uploads + thumbnails + protected files, realtime
  with permission checks, migrations, backups, rate limits), no functional gain.
- PocketBase prebuilt binary + JS hooks (`pb_hooks`): rejected in favour of Go
  mode — typed code, real unit/API tests (`tests.ApiScenario`), dependencies
  pinned in `go.mod`, single binary with embedded SPA. Same data model, so
  switching later would not have required a data migration.
- Shablon as frontend framework: rejected — 0.0.1-rc, author advises against
  real-world use. Revisit after a stable 1.0.
- BugStage: used as the **structural template** (Go mode layout, hook-per-file,
  enrich-based field hiding, API scenario tests, embedded SPA, CSP handler,
  fire-and-forget mail). Not forked; Git/SSH/feeds/self-update not taken over.
- Supabase / Appwrite: too heavy for one small VPS.
- Google Maps: rejected (API key, billing, data to Google).

## Build order

See [`milestones.md`](milestones.md) for the detailed, reviewable milestones.

1. Go scaffold, migrations, rules, fixture DB, role-matrix API tests.
2. Custom routes + hooks: submission, workflows, enrich, mails, retention, iCal.
3. React scaffold, i18n, tokens; public calendar, suggestion form, moderation queue.
4. Issue reporting (map picker, photos, EXIF strip), issue board + realtime, accounts + approval.
5. Beirat notes.
6. Hardening and ops: rate limits, backups, Docker/Caddy, legal pages, operations manual.
