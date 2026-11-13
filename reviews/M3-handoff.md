# M3 handoff

## Done

- `hooks/trap.go`: shared honeypot + time-trap validation (honeypot must be
  empty, `form_started_at` [epoch ms] must be >= 3 s in the past; accepts
  string or JSON number bodies).
- `hooks/submitIssue.go`: `POST /api/portal/issues` (multipart), exactly per
  plan.md "Public submission routes":
  - field validation (title/description/category lengths, email format,
    lat/lng within the configured bounding box, max 5 photos, ≤ 5 MB each,
    sniffed content mime whitelist jpeg/png/webp - client-specified names
    and content types are not trusted);
  - honeypot + time-trap;
  - `photo_consent` required when photos are attached;
  - `app.RunInTransaction` creates the `issues` record (status `pending`,
    lat/lng rounded to 3 decimals server-side, lat_exact/lng_exact exact,
    protected photos) and its `issue_metas` (email, optional name);
  - response is exactly `{"ok":true}` - no id, no record, no email.
  - bounding box: defaults 51.0-51.5 / 7.0-7.5, overridable via
    PORTAL_MIN_LAT / PORTAL_MAX_LAT / PORTAL_MIN_LNG / PORTAL_MAX_LNG env.
- `hooks/suggestionCreate.go`: honeypot + time-trap on
  `OnRecordCreateRequest("suggestions")` and `e.Record.Hide("email")` so the
  create response never echoes the submitter email.
- `hooks/usersCreate.go`: non-superuser creates are forced to
  `role=resident, approved=false, verified=false`; superuser-created
  hausmeister/hausverwaltung default to `notify_new_issues=true` unless set.
- All three registered in `portal.go` bindAppHooks.
- Tests (`api_submission_test.go`, 24 scenarios + 2 stateful tests):
  - 17 validation scenarios (every failure mode incl. honeypot, too fast,
    missing trap, out-of-bounds lat and lng, 6 photos, text-as-png spoof,
    photo > 5 MB, photos without consent);
  - `TestSubmitIssuePersistence` (single app + mux): valid submission
    (checks status/visibility/rounded+exact coords/photos/meta in DB),
    spoofing attempt (client-supplied status/visibility/id/lat_exact
    ignored), transaction rollback (meta name 201 chars fails only at meta
    save inside the tx - no issue left, earlier submissions untouched),
    read-back via list requests (guest 0, resident 3, beirat 12 items);
  - `TestSubmitIssueRateLimit`: enables the fixture-disabled rate limits,
    proves the `POST /api/portal/issues` rule (5 requests -> 6th is 429);
  - suggestion traps (4 scenarios) incl. "no email echo";
  - users create hook (7 scenarios) incl. beirat/hausmeister escalate
    attempts reverted, superuser keeps explicit roles, HM notify default.
- Updated M2 scenarios that the new hooks intentionally changed
  (documented below).

## Not done / deviations from plan.md (with reason)

- M2 test updates required by the new hooks (intent of the scenarios
  unchanged):
  - `TestSuggestionsCreate/*` bodies now include `honeypot`/`form_started_at`
    (else every public create would be trap-rejected);
  - `TestUsersCreate/guest - missing role` now expects 200 + forced
    `role=resident` (the hook sets the required role, so signup clients
    no longer need to send it - UX win, matches plan "hook forces role").
- Bounding box comes from env vars with placeholder defaults
  (51.0-51.5 / 7.0-7.5). plan.md says "configured bounding box around the
  property" without naming the mechanism; env was the simplest
  deployment-time switch. If you prefer a `portal_settings` field, that is
  a small follow-up.
- The route deliberately does NOT pre-validate the optional meta `name`
  length: the schema limit rejects overlong names inside the submission
  transaction, which is what the rollback test exercises.

## Open questions for the reviewer

1. PocketBase's FileField interceptor cleans up already-uploaded files when
   the save context becomes invalid on rollback
   (core/field_file.go:544, `newContextIfInvalid` cleanup of `succeeded`),
   so a failed submission leaves no orphaned photo behind. The tests cover
   DB-level rollback; file-level cleanup is relied on via this PB behavior.
   OK, or do you want a dedicated test asserting the storage dir after a
   failed photo submission?
2. `mail.ParseAddress` accepts display forms; we additionally reject
   whitespace. Sufficient for unverified submitter addresses?

## Acceptance command output

`go build ./... && go vet ./...`: exit 0, no output.

`go test ./... -count=1`:

```
ok  	weg-portal	1.419s
?   	weg-portal/base	[no test files]
?   	weg-portal/fixturegen	[no test files]
?   	weg-portal/hooks	[no test files]
?   	weg-portal/migrations	[no test files]
?   	weg-portal/ui	[no test files]
```

(198 scenarios total across 35 test functions, run ~1.4 s.)
