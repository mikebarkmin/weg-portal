# M7 review

**Reviewer:** reviewer agent · **Branch:** `m7-work` · **Verdict: approved**
(with one small fix applied directly as `M7: review fixes`, commit `e9a86de`)

## Scope check (`git diff m6-approved..m7-impl`)

The only new authorship in the range is `ee0f46f` ("M7: Suggestion form and
moderation queue"), which touches **exclusively `ui/**** and
`reviews/M7-handoff.md`. The range additionally contains the merge
`89e9ab8` (branch `m4-work`, i.e. content identical to the approved
`m4-approved` state plus the M3 review fixes from `m3-approved`) — `m6-approved`
simply predates the m4 merge. Backend files (`hooks/`, `api_*_test.go`,
`migrations/`, `fixturegen/`, `test_pb_data/`) are byte-identical to their
already-approved states; the M7 implementer changed nothing outside
`ui/` + `reviews/`. No unreviewed backend change.

## Acceptance (re-run by reviewer)

- `cd ui && npm ci` — ok (264 packages, esbuild postinstall notice only).
- `npm test` — **5 files, 51 tests, all pass** (ical 2, locales 2,
  validation 22, auth 3, recurrence 22).
- `npm run lint` — exit 0, no output.
- `npm run build` — `tsc --noEmit && vite build`, 124 modules,
  index.js 529.23 kB / index.css 15.40 kB, built ok.
- `make build` — ok; SPA served, CSP header present.
- `go vet ./...` — clean. `go test ./... -count=1` — **ok**.
- Note: one out of ~15 runs of `go test ./...` failed once (first run, chained
  directly after `npm run build && make build` under CPU contention). Not
  reproducible in 14 subsequent runs including the identical command chain
  and a stress loop. Most plausible candidate is the timing-critical
  "form_started_at too recent" trap test
  (`api_submission_test.go:443-446` sets `form_started_at = now` and relies on
  server-side processing starting within the 3 s trap window). Pre-existing
  M3/M4 code, outside this milestone's diff, nothing changed here — flagging
  for a future backend milestone (suggestion: use `now - 2900 ms` as the
  fixture value instead of `now`).

## Review checklist

- [x] **Beirat-only pages protected server-side and hidden in UI.**
  - `components/RequireBeirat.tsx` guards `/moderation` and `/users`
    (`App.tsx:36-50`); `Layout.tsx` renders the nav links only via
    `canShow(auth.role)` (`components/Layout.tsx:26-33`); `lib/auth.ts` reads
    the role from `pb.authStore.record`, never from the JWT.
  - The UI calls only rules-protected endpoints: `suggestions`
    list/create/update, `issues` list/update, `users` list/update,
    `authWithPassword`. No `/_/`, no superuser API, no custom routes.
  - Leak probes against the live fixture server: guest/resident list of
    `suggestions` → 200 with 0 items; resident `users` list → only own
    record; resident `issue_metas` list → 0 items; resident direct URL
    `/moderation` → localized forbidden panel (server returns empty lists,
    not data).
  - **Stale authStore after role/approved changes:** PocketBase persists the
    auth record in localStorage, so a logged-in session can hold a stale
    `role`/`approved` copy after a server-side change. Verified live (rules
    read the DB, not the token): revoking `approved` for the resident via
    the Beirat while keeping their old token changed their visible issue
    count from 5 to 0 immediately; restoring brought the 5 community issues
    back. No beirat data is reachable in any stale state — worst case the
    revoked user sees an empty queue / forbidden UI. Not a leak. (See
    findings #4 for an M9 improvement suggestion.)
- [x] **Error states shown for 429 and 400** — reproduced at API level and
  in the browser (headless Chromium):
  - honeypot filled → API **400** `{"data":{},"message":"Failed to submit the
    suggestion."}` (fresh instance, 127.0.0.1:8091);
  - `form_started_at` too recent → API **400**, same shape;
  - 5 requests / 10 min / IP bucket exhausted (the two 400s count) → 6th
    create **429** `Too Many Requests.`;
  - UI on the exhausted bucket: browser submit shows the localized
    "Zu viele Einsendungen. Bitte warten Sie einige Minuten …";
  - UI on a `< 3 s` (time-trap) submission: 400 without field errors →
    localized "Die Einsendung wurde abgelehnt. Bitte prüfen Sie Ihre
    Eingaben …" — this is the same code path that renders the honeypot 400,
    since the JS client blocks a filled honeypot earlier (zod, see
    findings #2);
  - login: `*:auth` 2/3 s limit → 3rd rapid wrong attempt shows the
    localized "Zu viele Anmeldeversuche …" (verified in the browser);
  - invalid transition as beirat (`open → pending`) → 400
    `Invalid status transition: "open" -> "pending".` surfaced as
    "Die Aktion wurde vom Server abgelehnt (…)" (per handoff, hook design
    from M4).
- [x] **Issue accept requires visibility (client + M4 server hook).**
  In the browser: accept without a chosen visibility → localized error, no
  request; accept with "community" → single PATCH with
  `{status:"open", visibility:"community"}` (`validation.ts:141-145`);
  fixture pending issues `issuepcom000001`/`issuepprv000001` verified as
  `open` + `community` afterwards via API. The M4 hook additionally rejects
  accept-without-visibility server-side (covered by `api_workflow_test.go`,
  unchanged since `m4-approved`).

## Manual run-through (reviewer, headless Chromium 375×812, own script)

All steps PASS (fixture copy on :8090, fresh migrated copy on :8091, servers
killed by PID afterwards):

- Guest `/suggestions/new`: no horizontal overflow (scroll 375 == client
  375) — also on login, moderation queue, user approval, success panel and
  the home calendar (M6 regression); empty submit → 3 localized zod field
  errors; too-fast submit → trap 400 message; valid submit → success panel;
  API shows the record as `pending`.
- Filled honeypot → blocked **client-side** by zod, **no server request**
  (0 POSTs), no visible error, no success — see findings #2.
- Login as `beirat@portal.test` (beirat nav: Moderation + Benutzer +
  Abmelden); moderation queue lists pending suggestions incl. guest
  submitter email; accepting with a note → `accepted`, `decision_note`
  and `decided_at` stored, and the `events` record was created by the M4
  hook (date correct incl. local→UTC conversion).
- Issues tab: pending issues listed; accept without visibility → localized
  error, no request; accept with community → `open`/`community` verified
  via API.
- `/users`: `unapproved@portal.test` listed; Freigeben moves to approved,
  Freigabe zurückziehen moves back (moved-out case).
- Logout, login as resident: no Moderation/Benutzer nav links; direct
  `/moderation` → forbidden panel.
- Wrong password → localized "E-Mail-Adresse oder Passwort ist falsch."
- EN locale: login + suggestion form flip to English.
- 429 checks (see checklist) on the fresh migrated instance.

## Locales / zod / payload builders

- de/en parity: 127 keys each, no difference; every `t()` key used in code
  exists; no stray German literals outside `locales/` (grep sweep clean;
  `index.html` `<title>` already the accepted M6 exception, replaced on
  mount).
- zod vs PB schema (`migrations/1795000100_collections.go:89-102`):
  title ≤ 200, description ≤ 5000, location ≤ 200, category ≤ 100,
  decision_note ≤ 2000 — exact match; email required + format checked.
  HTML `maxLength` attributes match on the inputs.
- Payload builders send exactly the whitelisted fields:
  `buildSuggestionPayload` → `status:"pending"` (createRule requires it) +
  whitelisted fields, `honeypot:""`, `form_started_at` (epoch ms), no
  decision fields, `date_end` omitted when empty
  (`validation.ts:92-116`); `buildSuggestionDecision` → `status` + optional
  trimmed `decision_note` only; `buildIssueAccept` →
  `{status:"open", visibility}` in one request; `buildIssueReject` →
  `{status:"rejected"}`; `buildUserApprovalPatch` → `{approved}` only.
  Verified 22 unit tests in `validation.test.ts` plus live API
  verification.

## Findings

1. **Fixed directly (small):** `ui/src/pages/UserApproval.tsx:39` listed all
   `approved=false` users; milestones.md M7 requires "list unapproved
   **verified** users". An unverified account must confirm its email before
   the Beirat approves it (the read rules require
   `approved && verified` anyway). Fix: the pending section now filters
   `!user.approved && user.verified`. Fixtures unaffected (fixture's
   unapproved user is verified). Commit `e9a86de` "M7: review fixes".
2. **Noted, intentional-looking, no change:** the honeypot is enforced twice
   client-side (`validation.ts:74-75` refine) and server-side
   (`hooks/suggestionCreate.go`). A **JS client** with a filled honeypot is
   blocked by zod before any request and shows **no** error (the hp field
   renders no `FormError` — `NewSuggestion.tsx:250-268` — and the zod
   message `validation.submitFailed` is therefore effectively dead code
   for that path). This is acceptable anti-spam behavior: bots without JS
   still hit the server 400, and the UI branch that renders the localized
   trap message for field-less 400s is exercised (and verified PASS in the
   browser) via `< 3 s` time-trap submissions, which produce the identical
   `{data:{}, message:"Failed to submit the suggestion."}` shape. No change
   requested.
3. **Noted, no change:** the moderation queue sorts suggestions by
   `date_start` and issues/users unsorted, since this PB fork has no
   `created`/`updated` system columns on base collections (the implementer
   verified `sort=created` fails; reviewer confirmed it isn't in the schema
   dump). Opts for fork-based behavior — accepted.
4. **For M9 (informational):** `pb.authStore` (localStorage) can hold stale
   `role`/`approved` after a server-side change. Verified harmless
   (server rules read the DB — see checklist), but M9's auth pages should
   call `authRefresh()` on boot before rendering role-dependent UI, and
   optionally re-fetch on window focus; also note that PocketBase JS SDK
   auto-refreshes only on token expiry, not on record changes.
5. **For a future backend milestone (informational):** the timing-sensitive
   "form_started_at too recent" test may flake under CPU contention (see
   acceptance note). Fix would be a one-liner in `api_submission_test.go`,
   but the backend is out of M7 scope; watch for recurrence.

## Answers to handoff open questions

1. **Empty lists instead of 403 for rule-failed list requests** (fork
   behavior): the current rule set is protection enough — verified
   empirically that residents/guests/i clients with any token state never
   receive items or submitter emails. M2's absence assertions already lock
   the actual behavior in; asserting 40x would couple tests to a
   PocketBase implementation detail the plan does not mandate. Keep as-is.
   One consequence stays on the books: the queue's UI "forbidden" state is
   (deliberately) not distinguishable from an empty queue.
2. **Unverified users in UserApproval:** Not acceptable as shipped —
   milestones.md says "unapproved **verified** users". Fixed by the
   reviewer: pending section filters `verified` too; approval of an
   unverified account is now impossible via the UI.
3. **`decision_note` also sent on accept:** Confirmed as intended. The
   plan's mail section ("mails submitter … decision note") does not
   restrict the note to rejections, an acceptance note is plausible
   Beirat content, and M4's implementation/stamps already accept this
   (`suggestionWorkflow.go` + templates unchanged). No change needed.
4. **Rate-limit bucket counts rejected submissions (400s):** Agreed,
   nothing to change client-side — counting failures is the more
   conservative anti-spam default. Carried forward for the M12 operations
   manual (Beirat needs to know a stuck form can 429 after 5 attempts
   including rejections).

## Verdict

**approved.** All acceptance commands re-run green by the reviewer, the
milestone checklist is fully satisfied, the deviations are reasonable and
documented, and the single fix needed (verified filter) is applied and
re-tested (`npm test` 51 pass, `npm run lint`, `npm run build`, `make build`,
`go test ./... -count=1` all green after the fix).
