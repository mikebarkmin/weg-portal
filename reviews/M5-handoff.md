# M5 handoff

## Done

- `hooks/retention.go` — daily retention cron `app.Cron().MustAdd("retentionCleanup", "0 3 * * *", ...)`
  implementing the plan.md retention table:
  - suggestions `rejected` after `decided_at` older than `retention_suggestions_rejected_days`;
  - suggestions `accepted` after `decided_at` older than `retention_suggestions_accepted_days` (the `events` record created on accept stays — retention never touches `events`);
  - issues `rejected` after `decided_at` older than `retention_issues_rejected_days`;
  - issues `resolved` after `resolved_at` older than `retention_issues_resolved_days`;
  - all deletions go through `app.Delete`, so PocketBase removes the issue
    photos and the `issue_metas` cascade with the record (proven by
    `TestRetentionIssueCascade`: meta count 1→0, photo storage dir gone);
  - periods are read from the `portal_settings` record on EVERY run; if the
    record is missing/unreadable the run logs an error and deletes NOTHING
    (`TestRetentionMissingSettingsDeletesNothing`; also verified with the
    registered job, not just the seam). A settings record with an invalid
    period (< 1, possible only via direct DB edits) is treated the same:
    error, nothing deleted. There are no hard-coded days anywhere in the
    cron — no fallback path exists that could delete;
  - every run logs one `Info` line with the deleted counts of all four
    categories (also for zero), plus per-failure `Error` lines.
  - Test seam: the cron body is the exported `hooks.RunRetentionAt(app, now)`
    (the cron job itself just calls it with `time.Now()`). The boundary
    assertions need a FIXED clock — with a live clock a record "exactly at
    the threshold" is by necessity already older when the run starts. All
    other retention tests invoke the registered cron job directly
    (`app.Cron().Jobs()` → id `retentionCleanup` → `job.Run()`).
- `hooks/portalSettings.go` — single-record invariant:
  - `OnRecordCreateRequest("portal_settings")` rejects a create while a
    record exists (400 "Only a single portal_settings record is allowed."),
    creating the first record when none exists is allowed;
  - `OnRecordDeleteRequest("portal_settings")` always rejects the delete
    (400 "The portal_settings record cannot be deleted.");
  - superusers are the only ones who reach these endpoints at all (all
    rules null) and they get the errors.
- `hooks/ical.go` — `GET /api/portal/calendar.ics` rendering all `events`
  as VEVENTs:
  - CRLF line endings, folding at 75 octets (continuation lines: CRLF +
    space; fold points never split multi-byte UTF-8 sequences);
  - TEXT escaping of `,` `;` `\` and newlines (encoded as literal `\n`);
  - all-day events use `DTSTART;VALUE=DATE:`/`DTEND;VALUE=DATE:` with an
    exclusive DTEND = stored (`inclusive`) date_end + 1 day, DTEND omitted
    when `date_end` is empty; timed events get `DTSTART`/`DTEND` with
    trailing `Z`;
  - per the M6 review decision: UTC wall-clock semantics, NO `TZID`
    anywhere (asserted by test);
  - stable `UID:<record id>@weg-portal.test`, fresh `DTSTAMP` per export;
  - `RRULE` passed through exactly as stored;
  - `Content-Type: text/calendar; charset=utf-8`, route is public like the
    events list rule.
- `migrations/1795000103_settings_updates.go` — backup settings:
  `Backups.Cron = "0 2 * * *"`, `Backups.CronMaxKeep = 5`; S3 stays
  disabled (zero value) and is configured at deployment time (M11 env /
  `/_/` by a superuser) — documented in the migration comment; nothing
  secret is committed. Verified by serving on a fresh throwaway `pb_data`:
  `_params.settings.backups` = `{"cron":"0 2 * * *","cronMaxKeep":5,"s3":{"enabled":false,...}}`.
- Registered `PortalSettings`, `Retention`, `ICal` in `portal.go` `bindAppHooks`.
- Fixture: added three events to `fixturegen/main.go` —
  `eventallday0001` (single all-day, no date_end),
  `eventallday0002` (all-day 14.–16.08.2026, multi-day exclusive-DTEND
  case) and `eventescapes001` (title/description/location with `,` `;` `\`
  + newline, description long enough to force folding);
  `test_pb_data/` regenerated with `go run ./fixturegen` (photo filenames
  are randomized on each regeneration — expected churn), new events
  documented in `test_pb_data/README.md`.
- Tests (`api_retention_test.go`, `api_ical_test.go`, additions to
  `api_portal_settings_test.go`):
  - `TestRetentionCronRegisteredDaily`: job registered with `0 3 * * *`;
  - `TestRetentionCronDeletesOldRecords`: end-to-end via `job.Run()` —
    400-day-old rejected suggestion/issue deleted, 10-day-old rejected
    suggestion and 100-day-old resolved issue kept;
  - `TestRetentionPeriodBoundaries`: per category, a record EXACTLY at the
    threshold (now − N days) is kept and one second older is deleted; the
    kept resolved issue has a deliberately ancient `decided_at` (400 days)
    to prove resolved issues key on `resolved_at`, not `decided_at`;
  - `TestRetentionPendingNeverDeleted`: fixture pending records plus
    pending records with bogus ancient `decided_at`/`resolved_at` all
    survive;
  - `TestRetentionIssueCascade`: metas + photo files removed with the issue;
  - `TestRetentionSettingsChangeAppliedOnNextRun`: reducing
    `retention_suggestions_rejected_days` 90→20 deletes a 30-day-old
    rejected suggestion on the next run while the accepted-suggestion
    period (90) is untouched;
  - `TestRetentionMissingSettingsDeletesNothing`: with the record removed
    (direct DB delete, bypassing the API guard on purpose) neither the
    fixed-clock run nor the registered job deletes anything, including
    4000-day-old records;
  - `TestPortalSettingsSingleRecordInvariant`: superuser create rejected
    (400), superuser delete rejected (400), create allowed when no record
    exists (200);
  - `TestICalendarExport`: guest + resident, full RFC 5545 validation —
    CRLF-only line endings, every physical line ≤ 75 octets, no `TZID`,
    valid `DTSTAMP` per event, 5 VEVENTs, and per-event assertions for the
    single timed event (`DTSTART:20261201T180000Z`, `DTEND...Z`), single
    all-day (`DTSTART;VALUE=DATE:20260704`, no DTEND), multi-day all-day
    (`DTEND;VALUE=DATE:20260817` = stored +1), recurring
    (`RRULE:FREQ=DAILY;COUNT=30` as stored, `VALUE=DATE`), escaped
    summary/description/location folded and unfolded-compare exact;
  - `TestICalendarUIDStable`: two requests export identical UID lists.
- Test totals: **58 test functions / 261 passing subtest scenarios**
  (pre-M5 baseline on this branch: 48 functions / 254 subtests
  [includes the fixture-growth adjustments below];
  +10 M5 test functions, +7 M5 subtest scenarios plus the +1 totalItems
  adjustment kept scenarios identical).

## Not done / deviations from plan.md (with reason)

- The retention schedule is `0 3 * * *` (03:00 UTC). plan.md says "daily
  cron" without a time; 03:00 keeps it clear of the 02:00 backup cron and
  of evening usage.
- Boundary semantics: "older than N days" = `decided_at < now − N*24h`
  (strictly older), i.e. exactly N days is kept, one second older is
  deleted — as specified in the milestone task.
- `TestEventsList` (`api_events_test.go`) expected `"totalItems":2` →
  updated to 5 because the fixture grew by three events. The scenarios
  (all six identities, same URLs) are unchanged; only the public list count
  was updated. No rule, scenario or expectation was weakened — the events
  role matrix still covers guest…hausverwaltung on the same endpoints.
- The iCS export contains ALL events (no date range/limiting): plan.md
  says the iCal export "renders `events`"; a subscription calendar should
  include the full calendar, and the SPA-side range logic is a display
  concern. If a cap is wanted later (e.g. only from today−90d), it is a
  one-line filter change.
- The UID domain is a constant (`weg-portal.test`) since no deployment
  domain exists anywhere yet (no settings field/env for it); UIDs are
  stable per record id regardless (see open question 2).
- `python3 -I -c "import icalendar"` was NOT available system-wide. I
  validated the export with the Python `icalendar` library (installed into
  a throwaway venv under /tmp, deleted afterwards, nothing touched in the
  project or the system): served the app against a COPY of `test_pb_data`
  (originals untouched), fetched `/api/portal/calendar.ics`, parsed it
  with `icalendar.Calendar.from_ical` — parses cleanly (VERSION 2.0,
  escaping round-trips: `SUMMARY: 'Keller, Waschkeller; 2. OG'`,
  `VALUE=DATE: 20260704`, `RRULE: b'FREQ=DAILY;COUNT=30'`,
  `DTEND: 20260817` for the multi-day all-day event, `DTSTAMP` in `Z`
  form). Full output pasted into the acceptance section below.
- Retention logging asserts only via behavior (deleted/kept records), not
  by asserting log lines — the TestApp logger sinks to test stdout; the
  four `deleted` counts are logged by code (single `Info` line, verifiable
  in the source).

## Open questions for the reviewer

1. Retention at 03:00 UTC (vs. any other hour) — acceptable?
2. Should the iCal UID domain be configurable (env) or come from
   `settings.Meta.AppURL` once a production URL exists, instead of the
   constant `weg-portal.test`? UIDs stay stable either way as long as the
   domain constant is not changed after rollout.
3. All-day `DTEND` = stored inclusive `date_end` + 1 day (RFC 5545
   exclusive end) so a subscription calendar shows the same days as the
   SPA (`expandAll` indexes through the stored end date). Timed events
   emit `DTEND` as stored. Matching the M6 behavior was the goal — OK?
4. The retention cron reads ALL records of each category (small data
   model, `FindAllRecords` with a status filter) and compares timestamps in
   Go. If the board ever grows large this should become a SQL range query;
   I kept the comparison in Go for exact timestamp semantics and boundary
   testability. OK for this scale?

## Acceptance command output

`go build ./... && go vet ./...`:

```
$ go build ./... && go vet ./... && echo OK
OK
```

`go test ./... -count=1`:

```
ok  \tweg-portal\t1.860s
?   \tweg-portal/base\t[no test files]
?   \tweg-portal/fixturegen\t[no test files]
?   \tweg-portal/hooks\t[no test files]
?   \tweg-portal/migrations\t[no test files]
?   \tweg-portal/ui\t[no test files]
```

`go test ./... -count=1 -shuffle=on` (run once per the milestone, plus a
`-count=2` rerun of the new M5 tests):

```
ok  \tweg-portal\t2.082s
?   \tweg-portal/base\t[no test files]
?   \tweg-portal/fixturegen\t[no test files]
?   \tweg-portal/hooks\t[no test files]
?   \tweg-portal/migrations\t[no test files]
?   \tweg-portal/ui\t[no test files]
```

Test totals (`go test . -count=1 -v`): 58 test functions passed, 261
subtest scenarios passed, 0 failures (`awk` count over the output).

Live ICS validation with the `icalendar` library (throwaway venv) against a
copy of the fixture DB (curl headers + parsed properties):

```
HTTP/1.1 200 OK
Content-Type: text/calendar; charset=utf-8
...
calendar: 2.0 | -//WEG Portal//Calendar//DE | GREGORIAN
- eventallday0001@weg-portal.test
  DTSTART: b'20260704' | DTEND: None | RRULE: None | DTSTAMP: b'20261113T115836Z'
  SUMMARY: 'Gartenfest'
- eventallday0002@weg-portal.test
  DTSTART: b'20260814' | DTEND: b'20260817' | ...
- eventescapes001@weg-portal.test
  DTSTART: b'20260912T090000Z' | DTEND: b'20260912T120000Z' | ...
  SUMMARY: 'Keller, Waschkeller; 2. OG'
  DESCRIPTION: 'Der Keller, die Waschkueche sowie das 2. OG muessen geputzt werden. ...'
  LOCATION: 'Keller; neben dem Fahrstuhl, 1. OG'
- eventrecurring1@weg-portal.test
  DTSTART: b'20261101' | RRULE: b'FREQ=DAILY;COUNT=30' | ...
- eventsimple0001@weg-portal.test
  DTSTART: b'20261201T180000Z' | DTEND: b'20261201T200000Z' | ...
```

Validator used: Python `icalendar` library (pluggable from PyPI; not
preinstalled on this machine) in a throwaway `/tmp` venv.
