# M9 handoff

## Done

- **`src/lib/validation.ts` additions** (all unit-tested in
  `lib/validation.test.ts`, 23 new tests → 56 total there):
  - `signupSchema` (name 1–200, email, password + confirm ≥ 8 chars,
    confirm-mismatch via `superRefine`, i18n-key error messages) and
    `buildSignupPayload` — sends ONLY `name/email/password/passwordConfirm`;
    `role/approved/verified` NEVER travel (the create hook forces them,
    see hooks/usersCreate.go – reviewed manually, no backend changes).
  - `profileNameSchema`, `passwordChangeSchema`,
    `buildProfileUpdate(name, {notifyNewIssues?})` (own-record patch: name +
    `notify_new_issues` only, when explicitly requested) and
    `buildPasswordUpdate` (PocketBase's `oldPassword` flow).
  - `IssueStatus`, `ISSUE_STATUSES`, `issueTransitionsFor(role, status)` —
    the client mirror of the hooks/issueWorkflow.go diagram:
    beirat: `pending→[open (requiresVisibility), rejected]`,
    `open→in_progress`, `in_progress→resolved` (and nothing out of
    `resolved`/`rejected`); hausmeister: `open→in_progress`,
    `in_progress→resolved` ONLY; hausverwaltung/resident/*: read-only
    (`NO_NEXT`). `open→resolved` etc. are not offered (and would be 400).
  - `buildIssueStatusUpdate(role, current, next, visibility?)` — validates
    against the matrix and only then builds the PATCH body; accept
    (`pending→open`) refuses to build without `community|private`
    (the hook would reject the request with 400 anyway).

- **`src/lib/fileToken.ts`** + `lib/fileToken.test.ts` (11 tests):
  - `FILE_TOKEN_TTL_SECONDS = 300` (mirrors `users.FileToken.Duration`
    from migrations/1795000102_settings.go) and
    `FILE_TOKEN_REFRESH_AFTER_MS = 200_000` (~2/3 of the TTL).
  - `buildFileUrl(base, collection, recordId, filename, {token, thumb})`
    — pure URL builder for `/api/files/issues/{id}/{name}?token=…&thumb=…`.
  - `FileTokenRefresher` — single-flight token provider with an injectable
    clock/fetcher: concurrent `get()` calls share ONE in-flight
    `pb.files.getToken()` request; a cached token is reused for 200 s and
    then proactively refreshed; `get(true)` forces a refresh (the 404
    retry); `invalidate()` drops the cache; a failed fetch releases the
    in-flight slot so the next call retries.
  - IssueDetail uses it: images render `…?token=<t>&thumb=600x0`; an image
    error triggers ONE forced refresh + retry per photo, a second error
    hides just that photo with a localized note.

- **`src/lib/auth.ts`**: `boardAccessOf(record)` →
  `granted | unverified | waiting` — the unapproved-gate logic (unit-tested
  in `lib/auth.test.ts`, 5 new tests): non-resident roles (beirat,
  hausmeister, hausverwaltung) are exempt per the milestone; residents
  need `verified` (confirm-email page first) and then `approved`
  (waiting-for-approval page).

- **`src/components/RequireBoardAccess.tsx`** — route guard for
  `/issues` + `/issues/:id`: guests get a login-required card, unverified
  residents a confirm-email card, unapproved residents the
  "Warten auf Freigabe" card (all with links to login/signup/profile).

- **`src/components/StatusBadge.tsx`** — localized status names
  (`issueStatus.*`: Neu/Angenommen/In Bearbeitung/Erledigt/Abgelehnt),
  status values never localized.

- **`src/components/VisibilityChip.tsx`** — community/private chip with
  localized label + hint (rendered where the role sees the field:
  the Beirat on board + detail).

- **`src/pages/Signup.tsx`** (`/signup`): react-hook-form + zod
  (`signupSchema`), name/email/password/confirm, explains the approval
  workflow up front; on success: `users.create` →
  `requestVerification(email)` (PocketBase's own confirmation mail; a
  failure is not fatal — see deviations) → success panel describing
  "Schritt 1: E-Mail bestätigen / Schritt 2: Freigabe durch den Beirat".
  Login page links to signup and vice versa; nav link for guests.

- **`src/pages/ProfileSettings.tsx`** (`/profile`, any authenticated
  user): name, `notify_new_issues` checkbox ONLY for
  hausmeister/hausverwaltung, password change
  (`oldPassword/password/passwordConfirm` via own-record update), email
  change via `requestEmailChange` (PB's confirm-link flow), and a
  re-send-verification-mail button for unverified accounts. After name
  saves the page calls `authRefresh()` so the auth store follows.
  `role/approved/verified` are never rendered as inputs and never appear
  in any payload (hint text states they are managed by Beirat/admin).

- **`src/pages/IssueBoard.tsx`** (`/issues`, inside RequireBoardAccess):
  - `getFullList()` of `issues` and a Leaflet map (OSM tiles +
    attribution, `subdomains="abc"` like MapPicker) with one
    status-colored `CircleMarker` per issue (click → detail, tooltip =
    title + status). Marker positions use `lat_exact/lng_exact` when the
    viewer's record carries them (beirat/HM/HV) and the rounded
    `lat/lng` otherwise — residents never receive exact fields at all
    (verified live below).
  - The server returns only what the role may see — the page does NOT
    filter anything away; the status/category **filters are pure
    client-side display filters** (documented choice in the page
    comment + below): the realtime subscription keeps ONE authoritative
    list, filter changes are instant, and no privilege-relevant
    filtering happens client-side.
  - **Realtime**: `pb.collection("issues").subscribe("*", handler)` —
    create prepends (sorted), update replaces in place, delete removes;
    the returned `UnsubscribeFunc` is invoked on unmount. Proof below.
  - Board order (documented): pending first, then newest decision first,
    keyed on the hook-owned `decided_at` — the M1 collection has NO
    `created`/`updated` autodate fields, so server-side sorting on
    `created` is impossible (my first attempt answered 400; see
    deviations).

- **`src/pages/IssueDetail.tsx`** (`/issues/:id`, inside
  RequireBoardAccess):
  - Fields: title, description, category, rounded coordinates (the
    rounded `lat`/`lng` are shown to everyone — exact values are only
    used for the board map markers of beirat/HM/HV), `decided_at` /
    `resolved_at` (localized), StatusBadge, VisibilityChip (beirat).
    The **submitter email is NOT shown** — `issue_metas` is Beirat-only
    and not expandable; the page never requests it.
  - Photos (protected files) via `FileTokenRefresher` +
    `buildFileUrl(...{token, thumb: "600x0"})`, with the single
    forced-retry-on-error described above.
  - Status change buttons ONLY for the transitions
    `issueTransitionsFor(role, status)` returns; beirat on a pending
    issue additionally gets the visibility `<select>` (accept refuses
    client-side + the deviation-free server check remains the hook).
    After a transition the record is re-read (the response updates the
    hook-owned timestamps). Errors: 400 → localized
    "server refused" + the English hook message in parentheses.
  - The open detail page also subscribes to ITS record id and updates
    live (small extra, see deviations).

- **`src/types.ts`**: `PortalIssue` extended (`photos`, `decided_at`,
  `resolved_at`, optional `lat_exact`/`lng_exact`); `created`/`updated`
  deliberately NOT added (the collection has no autodate fields, M1).

- **Routes/nav**: `/signup`, `/profile`, `/issues`, `/issues/:id` wired in
  `App.tsx` (the public `issues/new` route keeps precedence);
  `Layout.tsx` gets board/profile nav links and a signup link for
  guests. `Login` links to signup.

- **Locales**: full de/en additions (`signup.*`, `profile.*`, `gate.*`,
  `board.*`, `issueStatus.*`, `issueVisibility.*`, `issueDetail.*`,
  `validation.passwordTooShort/passwordMismatch`, `nav.*`,
  `login.toSignup`); the existing key-parity test (locales.test.ts)
  still passes. No German strings outside the locale files.

- **CSS** (`base.css`, tokens only, mobile-first): status badge colors
  (info/warning/success/danger surfaces), visibility chips,
  `.board-filters` (flex, fits 375 px), `.board-map` (leaflet canvas
  look + `isolation: isolate` so tile panes never overlap the sticky
  header), `.board-list`/`.board-item`, detail card/actions/photos,
  `.photo-placeholder`, `.section-title` + gap between stacked profile
  forms.

## Manual role run-through (performed — headless Chromium, 375×812)

Throwaway instance (NOTHING in the repo touched; rate limits are disabled
in the fixture settings, see test_pb_data/README.md):

```sh
make build
rm -rf /tmp/weg-m9-pb && cp -r test_pb_data /tmp/weg-m9-pb
./weg-portal serve --http 127.0.0.1:8094 --dir /tmp/weg-m9-pb
# stop with: pkill -x weg-portal
```

Driver: `playwright-core` (installed in `/tmp/weg-m7-e2e`, NOT in the
repo) + `/usr/bin/chromium`, script `/tmp/weg-m7-e2e/m9-runthrough.js`,
viewport 375×812. **61/61 checks PASS:**

```text
PASS  guest /issues shows login-required gate
PASS  HM board lists accepted incl. private issues
PASS  HM board hides pending/rejected issues
PASS  HM board count is 6
PASS  HM API list: exact coords ARE unhidden (enrich hook)
PASS  HM API list: 6 records
PASS  HM sees only open->in_progress button – ["Bearbeitung starten"]
PASS  HM transition open->in_progress works
PASS  HM then MAY resolve (in_progress->resolved button appeared)
PASS  HM transition in_progress->resolved works
PASS  375px no horizontal overflow (HM issue detail) – scrollWidth=375, clientWidth=375
PASS  HV board lists accepted incl. private issues
PASS  HV detail is read-only (no status change section)
PASS  resident board lists accepted community issues – open community + in_progress community + resolved community
PASS  resident board hides pending/rejected/private issues
PASS  resident board count is 3
PASS  375px no horizontal overflow (resident board) – scrollWidth=375, clientWidth=375
PASS  resident API list: no lat_exact/lng_exact anywhere
PASS  resident API list: 3 records
PASS  resident API list: rounded coords present on records – lat=51.123, lng=7.456
PASS  status filter Erledigt narrows to the resolved community issue – ["Brunnen repariert"]
PASS  category filter matches (all fixture issues are 'test')
PASS  category filter without match shows the empty state
PASS  board renders the leaflet map
PASS  board map shows 3 markers (resident) – 3 path elements
PASS  resident detail shows rounded location only – rounded 51.123/7.456, exact 52.0 not shown
PASS  resident detail shows NO status change section
PASS  resident detail does NOT show a submitter email
PASS  resident detail photos load (file token) – naturalWidth checks: [true]
PASS  photo URL is a token-protected /api/files URL
PASS  375px no horizontal overflow (resident issue detail) – scrollWidth=375, clientWidth=375
PASS  detail back-link returns to the board
PASS  beirat PATCH open->in_progress accepted by server
PASS  REALTIME: board updates to In Bearbeitung without reload – badge changed live
PASS  beirat PATCH private in_progress->resolved accepted
PASS  REALTIME: private update does not appear for the resident
PASS  REALTIME end state: board still lists the 3 community issues
PASS  beirat board lists ALL issues incl. pending/rejected/private
PASS  beirat board shows visibility chips – 10 chips
PASS  beirat pending detail shows the visibility select
PASS  beirat pending detail has no chip mismatch
PASS  beirat detail shows the VisibilityChip
PASS  accept without visibility shows the localized hint
PASS  beirat pending->open (community) works from the detail page
PASS  beirat detail no longer shows action buttons (open -> in_progress only is next)
PASS  375px no horizontal overflow (beirat issue detail) – scrollWidth=375, clientWidth=375
PASS  beirat pending->rejected works from the detail page
PASS  unapproved resident sees the waiting-for-approval page
PASS  unapproved gate hides all board content
PASS  signup success panel explains the approval workflow – workflow steps shown
PASS  unverified new account sees the confirm-email page
PASS  375px no horizontal overflow (unverified gate) – scrollWidth=375, clientWidth=375
PASS  profile shows readonly hint + no notify checkbox for residents
PASS  profile name change saves
PASS  profile keeps the new name after authRefresh + reload
PASS  profile password change works
PASS  email change request handled gracefully – no crash without SMTP (error or success message shown)
PASS  375px no horizontal overflow (profile page) – scrollWidth=375, clientWidth=375
PASS  password change verified by re-login and verified account shows waiting gate
PASS  approved new account sees the board (full signup lifecycle)
PASS  375px no horizontal overflow (new resident board) – scrollWidth=375, clientWidth=375

==== M9 manual run-through: 61 PASS / 0 FAIL ====
```

**What appeared for the roles (summary):**

- **Resident** (`resident@portal.test`): board lists exactly the 3
  accepted community issues, map shows 3 markers, API responses contain
  ONLY rounded coordinates (`lat/lng` 51.123/7.456, `lat_exact`/`lng_exact`
  absent from every item — asserted on the byte level over the whole JSON),
  no private/pending/rejected titles anywhere; status/category filters
  work; detail shows fields + token-loaded photo and NO status buttons and
  NO submitter email.
- **Hausmeister** (`hm@portal.test`): 6 accepted issues incl. private,
  `lat_exact` present in the API responses; on a still-open private issue
  exactly one button ("Bearbeitung starten") → status "In Bearbeitung" →
  then "Als erledigt markieren" → "Erledigt" (open→in_progress→resolved
  proven end to end in the UI).
- **Hausverwaltung** (`hv@portal.test`): same 6 accepted issues, detail
  WITHOUT any status-change section (read-only).
- **Beirat** (`beirat@portal.test`): all 10 issues incl. pending/rejected
  and private, visibility chips; pending issue detail offers the
  visibility select + Annehmen/Ablehnen; accepting without a visibility
  shows the localized refusal hint, with a visibility the accept works
  (pending→open), reject works (pending→rejected).
- **Unapproved resident** (`unapproved@portal.test`): the board route
  shows the "Warten auf Freigabe" card instead of any board content.

**Realtime proof (subscribed while the board was open):** with the
resident's board open, `curl`-style PATCHes were sent as the Beirat
(NOT in the browser):

- `open → in_progress` on a community issue: the resident's board list
  changed the badge "Angenommen"→"In Bearbeitung" live, no reload;
- `in_progress → resolved` on a PRIVATE issue: nothing changed for the
  resident (boards stay at 3 items, no private title) — the rule-filtered
  realtime channel (same read rule as REST, M2) never delivers the record.

The reverse direction (unsubscription and rule filtering for guests) is
covered by the M2 API tests; the unsubscribe path is exercised implicitly
by every page transition in the run-through (no leaked subscriptions → no
stale badge updates in later sections, which each re-visit the board).

## Not done / deviations from plan.md (with reason)

- **No server-side sort / no created-updatedAt columns**: the `issues`
  collection from M1 is a bare base collection WITHOUT autodate fields,
  so `?sort=-created` answers 400 and no "Gemeldet am" timestamp exists.
  The board therefore sorts client-side: pending first (they wait for a
  decision), then newest `decided_at` (hook-owned) first, tie-broken by
  id; IssueDetail shows `decided_at`/`resolved_at` but no created row.
  No backend changes were made (out of scope). See open question 1.
- **Client-side status/category filters** (milestone: your choice,
  document): fetching the full visible set once + live subscription keeps
  one authoritative list; filtering is instant and cannot leak anything
  (the server already restricted WHAT arrives).
- **Signup verification mail**: SMTP is configured via env only
  (plan.md), so on the test instance `requestVerification` could not
  actually deliver; the call is made and a failure is caught — the
  success panel shows a neutral step text either way, and the profile
  page can re-trigger the mail. Account+approval flow was completed via
  a superuser `PATCH verified=true` (documented above) and the Beirat's
  /users page.
- **Email change**: same SMTP situation — the request is wired
  (requestEmailChange → confirm-link to the new address); without a mail
  transport the UI surfaces a localized error and stays functional.
- **Gate states**: besides `approved=false` (waiting page) the gate also
  has a "confirm your email" page for `verified=false` residents —
  required for consistency: the read rule needs approved AND verified,
  and only verified users enter the Beirat's approval queue (M7).
- **Realtime on IssueDetail** (small extra beyond the milestone's
  board requirement): the open detail page subscribes to its record id so
  e.g. a Beirat member sees another member's accept without a reload.
  Same rules; un- and resubscription keyed on the id.
- **File-token refresh**: the ~2/3-TTL proactive refresh and single
  retry on image 404 are unit-tested with a fake clock; a live 200 s
  wait was not performed (no behavior gap expected —
  `FileTokenRefresher` is clock-injected and covered by tests).
- Board visibility chips are shown to the Beirat only; HMs/HVs may see
  private issues but the chip exists to answer "why can everyone see
  this?" — for them the plan's read scope is private anyway. Can be
  extended if the reviewer wants.

## Open questions for the reviewer

1. The M1 `issues` collection has no `created`/`updated` autodate fields
   (TODO(Beirat) also affects notifications ordering). Should a migration
   add them (a REAL plan.md change → reviewer decision), or is the
   decided_at-based board order acceptable?
2. The approval gate follows the auth store to stay cheap: a freshly
   approved resident must log in again / reload before the board appears
   (the waiting page is truthful about the stored record; the server side
   takes effect immediately because rules read the DB, per plan.md).
   Should the gate additionally authRefresh when it renders the waiting
   state? (I kept it simple; the login page pulls the fresh record.)
3. The Beirat may accept a pending issue from BOTH the moderation queue
   (M7) and the detail page (M9) with identical semantics (visibility in
   the same request). Duplicate surface, intentional for convenience — OK?
4. Email change + verification mails can never be end-to-end tested in
   CI without an SMTP sink. OK to consider the M11 deployment drill
   (docs/deploy.md) the place to verify them once?

## Acceptance command output

`cd ui && npm ci && npm test`:

```text
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.

 Test Files  7 passed (7)
      Tests  113 passed (113)
   Start at  14:16:59
   Duration  467ms (transform 350ms, setup 0ms, collect 616ms, environment 4ms, prepare 821ms)
```

`cd ui && npm run lint`:

```text
> weg-portal-ui@0.1.0 lint
> eslint .
```

(exit 0, no output — no warnings, no errors)

`cd ui && npm run build`:

```text
> tsc --noEmit && vite build

vite v6.4.6 building for production...
✓ 180 modules transformed.
rendering chunks...
dist/index.html           0.52 kB
dist/@assets/index.css  34.02 kB
dist/@assets/index.js   735.70 kB
✓ built in 1.74s
```

`make build`:

```text
go build -o weg-portal ./base
```

`go test ./... -count=1` (backend untouched, still green):

```text
ok  	weg-portal	1.842s
?   	weg-portal/base	[no test files]
?   	weg-portal/fixturegen	[no test files]
?   	weg-portal/hooks	[no test files]
?   	weg-portal/migrations	[no test files]
?   	weg-portal/ui	[no test files]
?   	weg-portal/ui/node_modules/flatted/golang/pkg/flatted	[no test files]
```

(UI unit tests: 113 total — per file: validation.test.ts 56 (of which 23
new: signup/profile schema+payload builders, the full role×status
transition matrix incl. `open→resolved`/`resolved→*` refusals,
visibility-required accept), fileToken.test.ts 11 new (URL builder, TTL
constants, single-flight, 2/3-TTL refresh with fake clock, forced 404
retry, invalidate, failure-retry), auth.test.ts 8 (of which 5 new gate
tests); all pre-existing tests unchanged and green; `go test` untouched,
no backend files modified.)
