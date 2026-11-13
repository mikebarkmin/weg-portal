# test_pb_data

Fixture database for the role-matrix API tests (`api_*_test.go`).
`tests.NewTestApp("./test_pb_data")` clones this directory for every test,
so nothing here is modified by a test run.

## Regenerating

The directory is fully generated - never edit it by hand. To regenerate after
changing `migrations/` or `fixturegen/main.go`:

```
go run ./fixturegen
```

The script wipes and recreates the directory: it applies all migrations
(PocketBase core + app migrations) and seeds the deterministic records below.
Commit the result when the fixture changes deliberately.

Note: rate limits are **disabled** in the fixture settings (tests hammer the
API from localhost). Rate-limit behavior is tested separately against a
non-fixture instance (see M3).

## Identities (users collection)

| email                   | id               | role          | approved | verified | password     |
|-------------------------|------------------|---------------|----------|----------|--------------|
| unapproved@portal.test  | userunapproved0  | resident      | false    | true     | passwort123  |
| resident@portal.test    | userresident000  | resident      | true     | true     | passwort123  |
| beirat@portal.test      | userbeirat00000  | beirat        | true     | true     | passwort123  |
| hm@portal.test          | userhausmeister  | hausmeister   | true     | true     | passwort123  |
| hv@portal.test          | userhausverwalt  | hausverwaltung| true     | true     | passwort123  |
| admin@portal.test       | useradmin000000  | admin         | true     | true     | passwort123  |

Plus one superuser (`super@portal.test`, `passwort123`).
"Guest" (no account) is used via requests without Authorization header.

Since M4 the hausmeister opts into new-issue mails
(`notify_new_issues = true`), the hausverwaltung does not (`false`), so both
branches of the M4 staff notification are testable against the fixture.

## Other records

- events: `eventsimple0001` (single, timed), `eventrecurring1` (all-day
  with rrule FREQ=DAILY;COUNT=30), `eventallday0001` (single all-day,
  no date_end), `eventallday0002` (all-day over 3 days, date_end 2026-08-16),
  `eventescapes001` (title/description/location with `,` `;` `\` and a
  newline plus a long description - the iCal escaping/folding cases)
- suggestions: `suggpending0001`, `suggaccepted001`, `suggrejected001`
  (one per status), each with submitter email `submitter@example.com`
- issues: `issue<status><visibility>000001` for each status
  (p=pending, o=open, i=in_progress, r=resolved, j=rejected) x visibility
  (com=community, prv=private) - e.g. `issueocom000001` is open+community.
  All have the rounded coords lat=51.123, lng=7.456, the exact
  `lat_exact`/`lng_exact` (distinct per issue; community issues use values
  >50, others <50, so filter-probing tests can detect a leak), one
  protected photo `photo.png` (1x1 px PNG), and one `issue_metas` record
  (`imeta...000001`) with the submitter email.
- notes: `notesnormal0001`, `notespinned0001` (author = beirat)
- portal_settings: single record `portsettings000` (90/90/90/365)

## Realtime manual check

Realtime subscriptions are covered by the same list/view rules and the same
`OnRecordEnrich` hook as the REST API, but the websocket transport cannot be
exercised with `tests.ApiScenario`. `REALTIME_CHECK.md` documents the manual
check script that is run after deployments.
