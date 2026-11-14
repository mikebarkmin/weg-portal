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

The script wipes and recreates the directory (the `*.md` files are kept): it applies all migrations
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
  (p=pending, o=open, i=in_progress, r=resolved, a=archived, j=rejected) x
  visibility (com=community, prv=private) - e.g. `issueocom000001` is
  open+community. `issueacom000001` (archived, community, resolved before
  archiving) was reported by the resident account like `issueiprv000001`
  (the reporter keeps their own archived entry in "Meine Einreichungen").
  All have one protected photo `photo.png` (1x1 px PNG), one `issue_metas`
  record (`imeta...000001`) with the submitter email and one
  `issue_locations` record (same id as the issue): community issues are in
  "Haus 79" on floor "1. OG" (no pin), private ones in "Keller" with a pin
  at x=0.25, y=0.75. The location is `shared` with staff for the pending
  and open issues only. `issueiprv000001` was reported by the resident
  account (`issue_metas.user`).
- issue_areas: `areahouse790000` ("Haus 79", floors EG / 1. OG / 2. OG, no
  plan), `areakeller00000` ("Keller", protected plan `plan.png`),
  `areainactive000` ("Alter Bereich", inactive)
- notes: `notesnormal0001`, `notespinned0001` (author = beirat)
- portal_settings: single record `portsettings000` (90/90/90/365)

## Realtime manual check

Realtime subscriptions are covered by the same list/view rules and the same
`OnRecordEnrich` hook as the REST API, but the websocket transport cannot be
exercised with `tests.ApiScenario`. `REALTIME_CHECK.md` documents the manual
check script that is run after deployments.
