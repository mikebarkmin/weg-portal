# M9 review — Issue board, accounts, realtime

Reviewed by: reviewer (per milestones.md) — branch `m9-work`.
Impl commit: `df599c3` ("M9: Issue board, accounts, realtime").
Fix commit: `7796302` ("M9: review fixes").

**Verdict: APPROVED** (after three small fixes, applied by the reviewer and
re-verified live below).

## Authorship / topology

- `git merge-base m9-work main` = `721d187` (= `main` HEAD, `b8cf574`-lineage).
- `git diff 721d187..m9-impl --stat`: 21 files, ONLY `ui/src/**` (App, Layout,
  RequireBoardAccess, StatusBadge, VisibilityChip, base.css, auth*, fileToken*,
  validation*, locales, IssueBoard, IssueDetail, Login, ProfileSettings,
  Signup, types) + `reviews/M9-handoff.md`. **No Go, no migrations, no
  test_pb_data changes.** The `b8cf574..m9-impl` range also contains the M8
  wave — topology artifact of earlier milestones, as expected.

## Acceptance (re-run by reviewer)

- `ui npm ci` → clean (only `npm warn install-scripts` notes for esbuild)
- `ui npm test` → `Test Files 7 passed (7), Tests 113 passed (113)`
- `ui npm run lint` → exit 0, no output
- `ui npm run build` → `✓ 180 modules transformed … ✓ built` (0.52/34.02/735.9 kB)
- `make build` → `go build -o weg-portal ./base` OK
- `go test ./... -count=1` → `ok weg-portal` (backend untouched)
- Post-fixes the same suite was re-run: 113 tests, lint, build, `make build`,
  `go test` all green (fixes touch only `ui/src`; `ui/dist/index.html` keeps
  the committed cache-bust `?v=` unchanged, matching the repo convention —
  assets are unhashed + no-store by design, see ui/vite.config.ts).

Paper trail in handoff: 61/61 manual run-through checks — plausible given what
I reproduced below.

## Checklist (milestones.md, binding) — all ticked

- [x] **Residents' map uses rounded `lat`/`lng`; `lat_exact` only for beirat/HM/HV.**
  Two layers make this hold:
  1. Server: `lat_exact`/`lng_exact` are schema-hidden
     (migrations/1795000100_collections.go:127) and un-hidden only for
     beirat/hausmeister/hausverwaltung (hooks/issueEnrich.go:26); enrich also
     runs for realtime — verified live (below) and covered by
     api_issues_test.go (no `lat_exact` in any resident response, incl. view +
     realtime paths; `?filter=lat_exact>0` answered 400 for a resident).
  2. Client: the board map positions were value-gated only (`"if present"`)
     — `ui/src/pages/IssueBoard.tsx` `positionOf()` used exact coords for
     ANY record carrying them, without checking the viewer's role. The
     milestone wording allowed this, but the binding review requirement is
     stricter: *no path renders exact coords for a resident even if the API
     ever included them*. **Fixed (finding F1):** `positionOf` now takes the
     viewer's role (`SEES_EXACT_COORDS` = beirat/HM/HV,
     IssueBoard.tsx:35–48, 71, 234). `IssueDetail` always prints rounded
     `lat.toFixed(3)`/`lng.toFixed(3)` (no exact values anywhere in the DOM).
- [x] **File tokens refreshed before expiry.**
  `lib/fileToken.ts`: TTL 300 s mirrored from
  `users.FileToken.Duration` (migrations/1795000102_settings.go);
  `FILE_TOKEN_REFRESH_AFTER_MS` = 2/3 TTL (fileToken.ts:8–13);
  `FileTokenRefresher` single-flight with injectable clock/fetcher
  (get() reuses a cached token < 200 s, shares ONE in-flight request,
  404-path `get(true)` forced refresh, `invalidate()`,
  released in-flight slot on failure — fileToken.ts:48–101; 11 unit tests).
  **Fixed (finding F3):** the page wired `get()` only on `record?.id`
  changes, so a long-lived open detail page never re-checked the token and
  the "proactive refresh" was only theoretical (the one-shot 404 retry
  caught it afterwards — reactive, not proactive). IssueDetail.tsx now
  re-checks the refresher on every incoming record state (mount + realtime
  updates), skipping photo-less records (IssueDetail.tsx:76–80). Photos are
  rendered with `{ token, thumb }` only; before the token arrives a
  placeholder is shown — **no photo URL without `?token=` can ever be
  issued** (verified live: tokenless photo URL → 404 even WITH a valid
  Authorization header; token-URL loads).
- [x] **Status buttons match the transition diagram per role.**
  `lib/validation.ts` (`BEIRAT_NEXT` 411, `HAUSMEISTER_NEXT` 420, `NO_NEXT`
  429, `issueTransitionsFor` 437, `buildIssueStatusUpdate` 457) vs
  `hooks/issueWorkflow.go` + the collection update rule
  (migrations/1795000100_collections.go:155): boundary-for-boundary
  identical. Beirat: pending→[open(+visibility), rejected],
  open→in_progress, in_progress→resolved — **open→resolved never offered**
  (server answers the 400 anyway, verified live). Hausmeister: ONLY
  open→in_progress→resolved. Hausverwaltung/resident: none (`NO_NEXT`).
  24 unit tests pin the matrix.

## Adversarial checks (browser, headless Chromium 375×812, live fixture server)

All against a real server (`./weg-portal serve --dir <fixture copy>`,
rate limits off in fixture). TAMPERING AS RESIDENT (raw fetch in the page
context with the UI's own token):

- `PATCH issues/issueocom000001 {status:"in_progress"}` → **404**
  (rule hides the record; no data returned);
- pending issue view + `?expand=issue_metas.issue` → **404**, no
  `submitter@example.com` anywhere (issue_metas is Beirat-only, and the
  expand silently returns nothing rather than leaking);
- `?filter=lat_exact>0` as resident → 400 (hidden fields not filterable, no
  narrowing);
- board DOM unchanged after all tampering, zero page errors — no broken UI
  state.

Server-side invariant probes (curl): hausmeister `open→resolved` → **400**
("Invalid status transition" from the workflow hook); beirat same-status
PATCH → **400** ("status must only be submitted when it changes"); beirat
`resolved→pending`, `open→resolved` → **400**; accept without visibility →
**400**; forged `decided_at`/`resolved_at` (2001…) → **hook-owned values**
stored (IssueWorkflow restores + sets decided_at/resolved_at); beirat
content edit WITHOUT status → 200 (allowed per plan). UI 400-surfacing: as
beirat with the realtime connection blocked (stale page), the transition
button click answered 400 ("already in the status …") and the detail page
showed the localized `form-error` incl. the hook message, page stayed intact —
graceful, no broken state.

## Unapproved gate vs revoked account mid-session (finding F2 — fixed)

`lib/auth.ts` had `useAuth` re-render on `authStore.onChange`, but
`readState()` doesn't read `approved/verified`, and
`RequireBoardAccess`'s record snapshot only re-synced when
`auth.isAuthenticated` toggled — an `authRefresh` (ProfileSettings) never
reached the gate. Confirmed live pre-fix: Beirat flips `approved=false` while
the resident session runs → resident navigates to `/issues` → **still the
board** (empty list, because rules read the DB and PB list rules filter
silently with a 200/empty body) instead of the waiting page. Server-side
everything was already revoked (list empty, view 404, realtime channel
silent — all verified), so this is a UI-correctness gap, not a data leak —
but the plan promises the waiting state for moved-out residents.

**Fix:** `RequireBoardAccess` now (a) re-reads the record on every
`authStore.onChange` (authRefresh performed anywhere lands in the gate) and
(b) `authRefresh()`es once per mount when authenticated
(RequireBoardAccess.tsx:18–46). Verified live post-fix: revoked resident →
board route shows **"Warten auf Freigabe"** without a re-login; re-approval →
board reappears without a re-login (authRefresh + onChange, both directions).
Caught ClientResponseError from a dead/expired token is swallowed — the
server still refuses all data either way.

## Realtime (re-implemented the live check; Node + PB SDK, 14 checks, all pass)

Fixture copy on a real server, subscriber roles logged in separately:

- resident subscribed on `issues/*`: community `open→in_progress` (PATCHed
  as HM in another session) **arrives live**, and the delivered record has
  NO `lat_exact`/`lng_exact`;
- private-issue update → **nothing** arrives for the resident; the beirat's
  parallel subscription receives it;
- public-route create (pending) → **nothing** for the resident; the beirat
  receives the create;
- revoking the resident mid-session → their OPEN subscription goes
  **silent** (rules re-read per delivery), while the beirat keeps receiving
  the same event — proves per-subscriber rule filtering, not mere channel
  closing;
- `unsubscribe()` → no further events (PageBoard/Detail unmount paths use
  exactly this; the detail page additionally re-subscribes per record id).

Board subscription code (IssueBoard.tsx realtime effect, unsubscribe on
unmount + in-flight guard for unmount-before-connect) is clean.

## Findings (F1–F3 fixed as "M9: review fixes"; smaller notes accepted)

1. **Fixed** — exact coords value-gated per record, not per role
   (`ui/src/pages/IssueBoard.tsx` `positionOf`) → now role-gated
   (`SEES_EXACT_COORDS`).
2. **Fixed** — approval gate not re-validated on authStore changes /
   authRefresh (`ui/src/components/RequireBoardAccess.tsx`) → onChange
   subscription + one authRefresh per mount (also resolves the M7 review
   follow-up "call authRefresh() on boot before rendering role-dependent
   UI" for the board routes).
3. **Fixed** — 2/3-TTL proactive token refresh never triggered on
   long-lived pages (`ui/src/pages/IssueDetail.tsx` effect keyed on
   `record?.id` only) → re-check on every record state; no token fetch for
   photo-less records.
4. **Accepted (note)** — board/roles never re-check the auth record on
   `window focus` (M7 review's optional suggestion). The gate now refreshes
   on every board navigation, which covers the realistic paths; token
   re-login is only needed for opened-on-behalf pages. No change requested.
5. **Accepted (note)** — `ui/dist/index.html` is the only tracked dist
   artifact and its `?v=` cache-bust has been untouched since M6 (builds
   regenerate it, but neither impl nor fixes commit it). Correct per the
   unhashed-filename/no-store design (ui/vite.config.ts comments) — the
   deployment drill (M11) should still confirm the SPA handler's
   `Cache-Control` for `/@assets/*` and index.html.

## Answers to the handoff's open questions

1. **decided_at-based board order — ACCEPTED.** The M1 `issues` collection
   has no autodate fields; adding them now is a schema change that would
   touch migrations + fixturegen + test_pb_data mid-milestone for little
   gain. Client-side order (pending first, then `decided_at` desc, id
   tie-break) is deterministic and hook-owned `decided_at` cannot be forged.
   **Recorded for plan.md follow-up:** a future small migration may add
   `created`/`updated` autodate columns (board hint "Gemeldet am",
   notification ordering TODO(Beirat)); existing rows would start with
   backfilled `decided_at`/migration-time values. Suggested place: bundle
   with the next backend milestone rather than M9.
2. **Gate authRefresh — implemented by this review** (see F2): the gate now
   refreshes on mount; a freshly approved resident needs no re-login
   (verified live both directions).
3. **Duplicate accept surface (moderation queue + detail page)** — OK.
   Both build the identical payload (`buildIssueAccept(visibility)`) and the
   server hook remains the single enforcement point; 400s are surfaced.
4. **SMTP-dependent flows end-to-end in M11 deploy drill — agreed.**
   requestVerification / requestEmailChange are wired with graceful
   localized errors when no SSO/SMTP transport exists (verified in the
   implementer's run-through; nothing to re-prove here).

## Deviations accepted

- Client-side status/category display filters (documented; the server
  already restricts WHAT arrives — no privilege-relevant filtering client
  side, verified live that private/pending records never arrive for HM/resident).
- `decided_at` order instead of `created` (open question 1 above).
- Signup verification mail / email change limited without SMTP (M11 drill).
- Unverified gate page (confirm-email) — required for consistency with the
  read rule (`approved && verified`), good addition.
- Realtime on IssueDetail beyond the milestone's board requirement — small,
  same rules, unsubscribes correctly; keep.

## Result

- Fix commit `7796302` applied by the reviewer ("M9: review fixes"), tree
  clean afterwards.
- All acceptance commands green post-fix; adversarial + realtime checks
  14+13/13 pass; tag `m9-approved` set on `m9-work`.
