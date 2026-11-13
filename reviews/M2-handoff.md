# M2 handoff

## Done

- `hooks/issueEnrich.go`: `OnRecordEnrich` hook, unhides `lat_exact`/`lng_exact`
  for beirat/hausmeister/hausverwaltung; registered in `portal.go`'s
  `bindAppHooks`. Enrich also runs for realtime events, so subscriptions are
  covered by the same logic.
- `fixturegen/`: migration-backed script that wipes and rebuilds
  `test_pb_data/` deterministically (fixed record ids, fixed submitter
  email, one issue per status x visibility, one photo + meta per issue,
  2 events incl. rrule, 3 suggestions, 2 notes, one superuser). Fixture
  settings disable rate limits (per the M1 review decision).
- `test_pb_data/` committed, `README.md` documents identities, ids and the
  regeneration procedure; `REALTIME_CHECK.md` documents the manual realtime
  smoketest (websocket transport is not exercisable via `tests.ApiScenario`;
  rules + enrich are identical for REST and realtime).
- API tests per collection with all six identities (guest, unapproved,
  resident, beirat, hausmeister, hausverwaltung) x list/view/create/update/
  delete, plus the explicit security tests from the milestone:
  - `api_users_test.go` — 41 scenarios. Own-record/beirat rules, no
    self-elevation of role/approved/verified, beirat only flips
    approved/notify_new_issues, delete superuser-only (403).
  - `api_events_test.go` — 27. Public read for all, write beirat-only.
  - `api_suggestions_test.go` — 24. Queue beirat-only (0 items for others,
    NotExpectedContent of submitter email), public create forced to
    `status=pending` (pre-accepted / injected decision_note / decided_at -> 400).
  - `api_issues_test.go` — 41. Read rule per identity (0 / 0 / 3 / 10 / 6 / 6),
    exact coords only via enrich hook (NotExpectedContent `lat_exact` for
    residents), create 403 for everyone, hausmeister status-only update
    whitelist (no visibility/title/photos/coords, no pending/resolved work),
    hausverwaltung no update, delete 403.
  - `api_issue_metas_test.go` — 14. Metas + submitter email beirat-only,
    create/update/delete 403 for everyone (null rules).
  - `api_notes_test.go` — 20. Beirat-only; author cannot be spoofed (400).
  - `api_portal_settings_test.go` — 8. 403 for all non-superuser identities
    across all operations; superuser sees the single record.
  - `api_security_test.go` — 12. Filter probing (400 on hidden lat/lng_exact,
    NotExpectedContent), expand probing (200 without metas leak),
    protected photos (no token 404; Authorization header alone 404;
    resident file token: community 200, private/pending 404; beirat 200).
- `api_test_helpers_test.go`: `setupTestApp` (binds app hooks), `getAuthToken`
  (cached per email - fixture signs tokens with a stable secret), `authHeader`,
  `getFileToken`, `fixturePhotoName` (PocketBase randomizes stored upload
  names, e.g. `photo_t1pcbp2ttq.png`, so tests read the filename from the fixture).

## Not done / deviations from plan.md (with reason)

- Realtime is a documented manual check script
  (`test_pb_data/REALTIME_CHECK.md`), not an automated test: PB's websocket
  transport cannot be driven through `tests.ApiScenario`, and realtime
  applies the same rules + enrich hook as REST (plan.md explicitly allows
  "test or documented manual check script").
- PB behavior findings that the tests had to encode (plan-conformant, but
  worth knowing):
  - `ApiScenario` with nil `ExpectedContent` expects an **empty body**, so
    every scenario states content explicitly.
  - filters on schema-hidden fields are **rejected (400)** rather than
    ignored - the stronger of the two "no effect or errors" outcomes.
  - `?expand=issue_metas` from issues is silently ignored (200, no data),
    metas leak nothing.
  - delete success returns **204 with empty body**, not 200.
  - file field stores use a randomized suffix; `photo.png` becomes e.g.
    `photo_t1pcbp2ttq.png`.
- The hausmeister `open -> resolved` direct jump is allowed by the *rule*
  (record ok + body status ok) and therefore untested here; the transition
  hook (M4) will reject it with 400 - that test lands in M4, deliberately
  not asserted now (asserting 200 would be asserting intended-invalid
  behavior).

## Open questions for the reviewer

1. `getAuthToken` caches tokens per email in a package-level `sync.Map`.
   Rationale: the fixture DB is immutable and signs tokens with a stable
   secret, so a token minted in one app instance is valid in all others;
   without caching every scenario would boot two app instances (BugStage's
   approach, noticeably slower). OK to keep?
2. The enrich hook binds a single `OnRecordEnrich` and filters by collection
   name inside (rather than `OnRecordEnrich("issues")`): the tagged hook
   variant exists, but the generic form matches BugStage's hook style and
   keeps one hook for the realtime+REST logic. Both are equivalent; confirm
   acceptable.

## Acceptance command output

`go test ./... -count=1`:

```
ok  	weg-portal	1.282s
?   	weg-portal/base	[no test files]
?   	weg-portal/fixturegen	[no test files]
?   	weg-portal/hooks	[no test files]
?   	weg-portal/migrations	[no test files]
?   	weg-portal/ui	[no test files]
```

`go build ./... && go vet ./...`: exit 0, no output.

Scenario counts per collection: users 41, events 27, suggestions 24,
issues 41, issue_metas 14, notes 20, portal_settings 8, security 12
(34 test functions, 187 scenarios total). Test run ~1.3 s.
