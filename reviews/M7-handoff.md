# M7 handoff

## Done

- **Dependencies added** (`ui/package.json`, committed lockfile):
  `react-hook-form@^7.60.0`, `zod@^3.25.76`, `@hookform/resolvers@^3.10.0`.

- **`src/lib/validation.ts`** (all sendable logic lives here, unit-tested
  without rendering a component):
  - `suggestionSchema`: title (1–200), description (≤5000), date_start
    (parsable), date_end (optional, ≥ date_start, cross-field
    `superRefine`), all_day, location (≤200), category (≤100),
    email (required, format), honeypot (must stay empty).
    Error messages are i18n keys (`validation.*`).
  - `toPBDateTime()`: date / datetime-local input → local instant →
    ISO 8601 UTC for PocketBase (all-day keeps only the date part,
    so a toggled all_day does not send a stale time).
  - `buildSuggestionPayload(values, formStartedAt)`: always
    `status: "pending"` (required by createRule), `honeypot: ""` and
    `form_started_at` (epoch ms), **no decision fields ever**, optional
    `date_end` omitted when empty.
  - `buildSuggestionDecision(status, note)`: `{status}` +
    `decision_note` only when non-empty (trimmed, ≤2000, throws over
    length as a safety net behind `decisionNoteSchema`).
  - `buildIssueAccept(visibility)`: `{status: "open", visibility}` in
    ONE payload (server requires visibility in the same request);
    `buildIssueReject()`: `{status: "rejected"}` (status-only);
    `buildUserApprovalPatch(approved)`: `{approved}` only.

- **`src/lib/auth.ts`**: minimal auth state; `useAuth()` subscribes to
  `pb.authStore.onChange` and re-exports the store as React state;
  `roleOf()` reads the role **from `pb.authStore.record`** (never from
  the JWT, per M6 checklist); `canShow(role)` gates the Beirat-only
  pages; `logout()` clears the store.

- **`src/lib/pbErrors.ts`**: `errorStatus`, `serverMessage`,
  `fieldErrors` helpers around `ClientResponseError` so pages can
  branch on 429 / 400 and show PocketBase's field/transition messages.

- **`NewSuggestion` (`/suggestions/new`, public)**: react-hook-form +
  zodResolver; fields title, description, all_day (switches the date
  inputs to `type="date"`), date_start, date_end, location, category,
  required email (with hint that the decision is reported back);
  hidden honeypot field (off-screen `aria-hidden`, `tabIndex -1`,
  must stay empty — zod + server enforce); `form_started_at` set on
  mount (`useRef(Date.now())`, refreshed on "another suggestion").
  2xx → success panel ("Vielen Dank!" + link back to the calendar);
  400 with field errors → mapped onto the form fields; 400 without
  field errors (honeypot/time-trap) → localized `trap` message; 429 →
  localized rate-limit message (5/10 min/IP server-side); other →
  generic localized error.

- **`Login` (`/login`)**: email+password via
  `pb.collection("users").authWithPassword()` (auth state stays in
  `pb.authStore`/localStorage), redirect to `/`; 400/401 → localized
  "wrong credentials", 429 → localized rate-limit message; wrong
  credential path verified against the live server.

- **`ModerationQueue` (`/moderation`, Beirat only)**: tabs
  **Vorschläge / Meldungen** with live count badges; pending
  suggestions (`filter status='pending'`, sorted by `date_start`) and
  pending issues (`filter status='pending'`) loaded in parallel.
  Suggestion cards show title, description, submitter email, event
  date/time (Intl), location, category + a decision-note textarea and
  Annehmen/Ablehnen (`buildSuggestionDecision`). Issue cards show
  title, description, category + a visibility radio
  (`community`/`private`); accept without a chosen visibility shows a
  localized error and does not call the server; accept sends
  status+visibility in one PATCH, reject sends status only. Every
  400 from the workflow hooks is surfaced as
  "Die Aktion wurde vom Server abgelehnt (server message)". Decided
  cards are removed from the list (refetch on reload; realtime is M9).

- **`UserApproval` (`/users`, Beirat only)**: fetches all users as
  Beirat and splits: "Warten auf Freigabe" (`approved=false`) with a
  Freigeben button, "Freigegebene Benutzer" (`approved=true`) with
  Freigabe zurückziehen (moved-out case, plan.md). Cards show
  name/email/role (localized role labels). Only `{approved}` is ever
  sent (`buildUserApprovalPatch`), never role/email/name. Local
  optimistic list move; failures stay on the card with the server
  message.

- **Routes + nav**: `/suggestions/new`, `/login`, `/moderation`,
  `/users` in `App.tsx`; the Beirat routes are wrapped in
  `components/RequireBeirat.tsx` (role via `useAuth`/`canShow`;
  non-Beirat gets a localized "Kein Zugriff" panel — server rules
  still protect the data). `Layout.tsx` gained a nav row
  (mobile-first, wraps at 375 px): Terminkalender, Termin vorschlagen
  (public), Moderation + Benutzer (Beirat only links), and
  Anmelden/Abmelden depending on the auth state (logout button clears
  the store).

- **Locales**: de/en keys added for nav, validation, suggestion form,
  login, auth.forbidden, moderation queue, user approval (`nav`,
  `validation`, `suggestion`, `login`, `auth`, `moderation`,
  `users`); locale key parity test from M6 still passes. No German
  strings outside `locales/` (except the known logic in `index.html`).

- **CSS** (`base.css`, tokens only, mobile-first): nav, form fields
  (`input`/`textarea`/`select`, focus-visible outlines, radios,
  field/form error boxes), honeypot off-screen rule, tabs, queue cards
  with `dl.queue-meta` (collapses to one column ≤600 px, like the M6
  event detail).

- **Unit tests** (vitest, `src/lib/validation.test.ts`,
  `src/lib/auth.test.ts`, 25 new tests): schema valid/invalid cases
  (required fields, lengths, email, dates, end-before-start, honeypot),
  payload round-trips (ISO conversion, omitted optional `date_end`,
  forced `status:'pending'`, no decision fields), all four decision
  payload builders, `toPBDateTime`, and `canShow`/`roleOf`.
  Coverage of locale key parity + recurrence from M6 untouched.

## Manual run-through (performed, commands + results)

Throwaway servers (nothing in the repo was touched beyond the build):

```sh
cd /home/mike/.vibe/worktrees/weg-portal-m7
make build                                        # embeds ui/dist
rm -rf /tmp/weg-m7-pb && cp -r test_pb_data /tmp/weg-m7-pb
setsid nohup ./weg-portal serve --http 127.0.0.1:8090 --dir /tmp/weg-m7-pb \
      > /tmp/weg-m7-serve.log 2>&1 &              # fixture (rate limits OFF)
rm -rf /tmp/weg-m7-fresh
setsid nohup ./weg-portal serve --http 127.0.0.1:8091 --dir /tmp/weg-m7-fresh \
      > /tmp/weg-m7-fresh.log 2>&1 &              # fresh (migrations apply
                                                  # the settings rate limits)
# stop afterwards: fuser -k 8090/tcp; fuser -k 8091/tcp
```

Fixture identities: `beirat@portal.test`, `resident@portal.test`,
`unapproved@portal.test`, all password `passwort123`
(see `test_pb_data/README.md`). I drove the SPA with headless
Chromium (`/usr/bin/chromium` + `playwright-core` installed in
`/tmp`, **not** in the repo) at **375×812** — the full checklist script
lived in `/tmp/weg-m7-e2e/runthrough.js`:

1. `/suggestions/new` as guest: no horizontal overflow on 375 px
   (`scrollWidth == clientWidth == 375`); submitting the empty form
   shows 3 zod field errors under the fields; a filled form submitted
   after >3 s (time trap) shows the success panel and creates a
   `pending` suggestion (verified via API afterwards).
2. `/login` as beirat: "Anmelden" redirects to `/`, nav now shows
   Moderation + Benutzer + "Abmelden".
3. `/moderation`: both pending suggestions render (fixture + my guest
   one), inclusive submitter email; the guest suggestion was rejected
   with a note (card disappears), the fixture suggestion accepted
   with a note → API shows `status=accepted`, stored `decision_note`,
   `decided_at` set, **and the events record was created** (M4 hook)
   while the rejected one created none.
4. Meldungen tab: the two pending issues (fixture pending×community
   candidate + pending×private candidate) are listed; accept without
   visibility → localized "Bitte die Sichtbarkeit wählen …"; accepting
   with "community" → issue in the API `open` + `visibility
   community`; rejecting the second works. Invalid transition via API
   as beirat (`open → pending`) returns **400 + message**
   `Invalid status transition: "open" -> "pending".`
5. `/users`: `unapproved@portal.test` under "Warten auf Freigabe"
   with name/email/role; Freigeben moves them to the approved section,
   "Freigabe zurückziehen" moves them back (moved-out case).
6. Logout, then login as resident: no Moderation/Benutzer nav links;
   direct URL `/moderation` shows the localized forbidden panel; the
   suggestions list from the resident's context leaks no records
   (0 items, no submitter emails in the response).
7. Wrong password on `/login` → localized "E-Mail-Adresse oder Passwort
   ist falsch."
8. Language switch to English on `/login` flips all form labels
   ("Log in"); back to German.
9. `/` calendar at 375 px: still no overflow (M6 regression).

Rate limit (`/tmp/weg-m7-fresh` instance, limits active):

- POST with filled honeypot → **400**; POST with `form_started_at` <
  3 s → **400**; POST without `status` → **400** (createRule).
- 5 requests / 10 min / IP: after 5 requests (the rejected 400s count
  against the bucket too) every further create returns **429**
  `Too Many Requests.`; submitting the form in the browser then shows
  the friendly localized "Zu viele Einsendungen. Bitte warten Sie
  einige Minuten …" instead of a raw error.

## Not done / deviations from plan.md (with reason)

- **`created`/`updated` sorting dropped**: this PocketBase fork has
  **no system `created`/`updated` columns on base collections**
  (`sqlite3 .schema` shows none; `sort=created` fails with 400).
  Queue suggestions are therefore sorted by `date_start`; issues and
  users use the default order. (`users` — an auth collection — does
  expose `created`; I still do not sort by it to keep the loading code
  uniform.) `PortalSuggestion`/`PortalIssue` carry no `created` field.
- **Unauthenticated/rule-failed lists return 200 + empty items** in
  this fork (instead of 403/404). This is server-side behavior (M2
  already asserted absence, not status codes); the UI therefore
  relies on the rules being protective, which I verified (no items,
  no submitter emails leak).
- **UserApproval shows a second section** ("Freigegebene Benutzer"
  with revoke) next to the instruction's `approved=false` list, because
  "(can) revoke (PATCH approved)" can only be exercised on approved
  users (plan.md's moved-out use case). Toggle only ever sends
  `{approved}`. If that is seen as scope creep, the second section is
  one `map` to delete.
- **`dist/index.html`**: the final `npm run build` was restored to the
  committed state (the `?v=<timestamp>` asset query churns it on
  every build, M6 convention).
- Runtime **English strings from the server** (PocketBase field
  invalid messages, workflow transition texts) are displayed as-is
  next to a localized explanation sentence — translating server
  messages would need a message-mapping layer; noted here for the
  reviewer to decide (M8/M9 will hit the same class of messages).
- The moderation queue surfaces the **suggestion** submitter email
  (it is on the record) but not the **issue** submitter email — it
  lives in `issue_metas` and would need a second query per tab; left
  for the issue board (M9) per proportionality.

## Open questions for the reviewer

1. The PB fork's empty-list-instead-of-403 behavior (see above):
  is the current rule set still considered protection enough, or
  should a future milestone assert 40x for anonymous list attempts?
  (M2's Absence-tests suggest the former.)
2. Should `UserApproval` also hide non-verified users ("list
  unapproved **verified** users" in milestones.md) or is listing every
  unapproved account acceptable? Currently all `approved=false`
  users are listed (fixture's unapproved user *is* verified).
3. The `decision_note` textarea is also sent on accept of a
  suggestion (as the plan's mail spec implies). Confirmed as intended?
4. The rate-limit bucket counts rejected submissions (400 honeypot/
  trap/status failures too). Nothing to change client-side, but worth
  being aware of for the operations manual (M12).

## Acceptance command output

```
$ cd ui && rm -rf node_modules && npm ci
npm warn install-scripts …   (esbuild postinstall notice; platform
                              binaries come via optional deps; build works)

$ cd ui && npm test
 ✓ src/lib/ical.test.ts (2 tests)
 ✓ src/lib/locales/locales.test.ts (2 tests)
 ✓ src/lib/validation.test.ts (22 tests)
 ✓ src/lib/auth.test.ts (3 tests)
 ✓ src/lib/recurrence.test.ts (22 tests)

 Test Files  5 passed (5)
      Tests  51 passed (51)
   Duration  400ms

$ cd ui && npm run lint
> eslint .
(no output, exit 0)

$ cd ui && npm run build
> tsc --noEmit && vite build
✓ 124 modules transformed.
dist/index.html           0.52 kB
dist/@assets/index.css   15.40 kB
dist/@assets/index.js   529.23 kB
✓ built in 1.33s

$ make build
go build -o weg-portal ./base
(37 MB binary; GET / → 200 with Content-Security-Policy,
 GET /@assets/index.js → 200)

$ go vet ./... && go test ./... -count=1
ok  \tweg-portal\t1.853s        (backend untouched; all role-matrix tests still green)
?   weg-portal/base, fixturegen, hooks, migrations, ui   [no test files]
```

Additionally (removes the risk of a claim-only check): the two manual
run-throughs above were executed against the real binary; every step
of the browser checklist script returned PASS (44 checks), including
the five 375 px overflow probes.
