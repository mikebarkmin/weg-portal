# M5 review

- Reviewer scope: M5-only changes = the single milestone commit `f3b0428`
  "M5: Retention, iCal, settings" on branch `m5-work` (worktree
  `weg-portal-m5`). The merges below it brought in the already-approved
  M4 (`m4-approved` = `cd47240`) and M6 lines; `git show f3b0428 --stat`
  yields exactly the expected files: `hooks/retention.go`,
  `hooks/portalSettings.go`, `hooks/ical.go`,
  `migrations/1795000103_settings_updates.go`, tests, `fixturegen/main.go`,
  fixture updates, `reviews/M5-handoff.md`. `portal.go` changed only by
  the three hook registrations (`hooks.PortalSettings/Retention/ICal`);
  no collection-rule migration was touched (`1795000103` modifies backup
  settings only).
- Verdict: **approved** (after one reviewer fix, commit "M5: review fixes").

## Acceptance re-run (after the fix, in this worktree)

```
$ go build ./... && go vet ./... && echo OK
OK

$ go test ./... -count=1          (3 consecutive runs)
ok  weg-portal  2.003s / 1.997s / 2.019s   (+ all packages [no test files])

$ go test ./... -count=1 -shuffle=on     (3 consecutive runs)
ok  weg-portal  2.030s / 1.984s / 1.983s

$ go test . -count=1 -v
59 test functions passed (58 pre-review + the new adversarial regression
test), 0 failures.
```

The very first pre-fix `go test ./... -count=1` run FAILED (see finding 1);
that flake is now fixed and the previously failing test passed 30/30
consecutive isolated runs and all full-suite/shuffle runs afterwards.

## M5 review checklist (milestones.md)

- [x] **Pending items are never deleted.** `hooks/retention.go` deletes
      only the four categories listed in `retentionSettingFields`
      (`retention.go:33-41`: suggestions `rejected`/`accepted`, issues
      `rejected`/`resolved`); every query filters on that status
      (`retention.go:97`), so `pending` records are never even loaded for
      deletion. Proven by `TestRetentionPendingNeverDeleted` (including
      pending records with bogus ancient `decided_at`/`resolved_at`) and
      the adversarial pass below. The zero-timestamp guard
      (`retention.go:116-121`) additionally keeps decided-at-less legacy
      rejections instead of silently deleting them.
- [x] **Retention uses `decided_at`/`resolved_at`, not `created`/`updated`.**
      The only timestamp fields read are the ones in
      `retentionSettingFields` (`retention.go:33-41`), picked per category
      at `retention.go:113`. The adversarial pass proved the authority of
      `resolved_at` for resolved issues (ancient `decided_at` + recent
      `resolved_at` → kept) and, for the record, this schema has no
      `created`/`updated` columns on `issues` at all.
- [x] **No hard-coded retention days in the cron; no deleting fallback.**
      The periods come exclusively from
      `settings.GetInt(cat.setting)` (`retention.go:60`). Missing/unreadable
      record → one error log line and `return` before anything is loaded
      (`retention.go:48-56`); an invalid value (< 1) → error and `return`
      before the first delete, so a garbage record cannot cause a partial
      cleanup either (`retention.go:61-71`). No default values appear
      anywhere in the cron path (the 90/90/90/365 defaults live only in
      `migrations/1795000101_portal_settings_record.go`).
      `TestRetentionMissingSettingsDeletesNothing` covers the missing-record
      case via both the seam and the registered job; my probe additionally
      confirmed 4000-day-old records survive with the record deleted
      directly on the DB.
- [x] **ICS escapes `,` `;` `\` and newlines** (`hooks/ical.go`,
      `escapeICalText` with literal `\n` for CR/LF; tested unfolded-exact
      by `TestICalendarExport` against `eventescapes001`, which carries
      `,` `;` `\` and a newline in title/description/location).
- [x] **All-day events use `VALUE=DATE`** (`DTSTART;VALUE=DATE`, exclusive
      `DTEND` = stored inclusive `date_end` + 1 day, DTEND omitted when
      `date_end` is empty; per the M6 review decision the timed events are
      emitted in UTC with a trailing `Z` and NO `TZID` anywhere
      (asserted by `validateICal`). CRLF-only line endings and the 75-octet
      fold limit (continuation "CRLF + space", fold points never split
      UTF-8 runes via `utf8.RuneStart`) are asserted for every physical
      line; `RRULE` is passed through exactly as stored; `UID` is
      `<record id>@weg-portal.test` and stable across exports
      (`TestICalendarUIDStable`).

## Adversarial pass (reviewer probes, via `hooks.RunRetentionAt`)

Crafted records and one cleanup run at `retentionNow` (2027-06-01 12:00 UTC):

| Probe | Result |
|---|---|
| rejected issue, `decided_at` NULL (unset) | **kept** — `IsZero` guard, never deleted silently |
| rejected issue, `decided_at` far negative (1850) | **deleted** — decision far outside retention, correct |
| resolved issue, `decided_at` 1850, `resolved_at` −10d | **kept** — `resolved_at` is authoritative |
| rejected, `decided_at` exactly at threshold, stored as `+05:30` offset | **kept** — PocketBase normalizes to the absolute instant (`Z` layout, `types.ParseDateTime`/`cast.ToTime`), comparison is clock-independent |
| rejected, `decided_at` one second past threshold, stored as `+01:00` offset | **deleted** — offset semantics confirmed |
| issue with photo + meta exactly one second past threshold | **deleted**; `issue_metas` cascade verified gone (0 records); photo storage dir removed with the record (PocketBase deletes the storage prefix in a background goroutine — see finding 1) |
| pending issue with 1850 `decided_at`+`resolved_at` | **kept** |
| portal_settings: superuser 2nd create | 400 "Only a single portal_settings record is allowed." |
| portal_settings: superuser delete | 400 "The portal_settings record cannot be deleted." |
| portal_settings: superuser create when none exists | 200 (first record allowed), count 1 |
| portal_settings via `/api/batch` (double create / delete / mixed) | **403 "Batch requests are not allowed."**, record count stays 1 — PocketBase ships with `Batch.Enabled = false` and no migration enables it, so the batch surface is closed for every identity |

The valuable cases became a permanent regression test
(`TestRetentionAdversarialTimestamps` in `api_retention_test.go`) and a
batch-403 scenario in `TestPortalSettingsSingleRecordInvariant`.

## M7-relevant fixture claim

`TestEventsList` (`api_events_test.go:22,31,40,49,58,67`) expects
`"totalItems":5` for all six identities (guest…hausverwaltung), and
`test_pb_data/README.md` documents the three new events
(`eventallday0001`, `eventallday0002`, `eventescapes001`). The scenarios
themselves are unchanged — only the count was adjusted for the fixture
growth. Verified.

## Finding and fix (applied by the reviewer, commit "M5: review fixes")

1. **`TestRetentionIssueCascade` was flaky — a real `go test ./... -count=1`
   acceptance failure** (my first run in this worktree failed; isolated
   repetitions failed roughly every 3-5th run). Pre-fix
   `api_retention_test.go:344` asserted `os.Stat(photoDir)` immediately
   after `app.Delete`, but PocketBase deletes the record's storage prefix
   in a **background goroutine** (`core/base.go` `__pbFilesManagerDelete__`
   handler: "optimistic" delete via `routine.FireAndForget`, PB v0.42.2),
   so `app.Delete` can return before the directory is removed. This is a
   test-only race (the production cleanup is correct and eventual — same
   mechanism the cron relies on). Fixed by polling (20 ms interval,
   10 s deadline, hard `t.Fatalf` on timeout) — the assertion is not
   weakened. Post-fix: 30/30 isolated runs green, 3× `count=1`, 3×
   `-shuffle=on` green.

No further findings. The retention code paths, the no-fallback rule, the
portal_settings guards and the ICS generator are correct as submitted.

## Answers to the handoff's open questions

1. **03:00 UTC** — fine. Daily, keeps clear of the 02:00 backup cron, and
   the schedule is only "when", never "how much" (settings are re-read
   every run). Keep.
2. **UID domain** — the constant is acceptable for now because no
   production deployment exists yet. Once a real domain exists (M11), a
   switch to `settings.Meta.AppURL` (or an env var) is a one-line change
   and should be done **before** real subscriptions exist — changing the
   domain later would orphan every subscribed calendar entry. Noted as a
   small M11 task, not an M5 defect.
3. **All-day DTEND = stored inclusive end + 1 day** — correct: RFC 5545
   requires an exclusive DTEND, and it matches both the M6 SPA expansion
   and the `icalendar`-parsed validation output (`20260817` for the
   stored `2026-08-16`). Timed DTEND as stored is fine.
4. **`FindAllRecords` + Go-side timestamp comparison** — OK at this scale
   (a WEG community board has hundreds of records, not millions); it
   buys exact boundary semantics and testability. If the board ever grows,
   a `decided_at < cutoff` SQL filter is the follow-up; no change now.

## Deviations noted (accepted)

- ICS exports all events without a date range — matches plan.md
  ("renders `events`"); a subscription feed should carry the full
  calendar. A later cap is a one-line filter.
- UID domain constant — see answer 2.
- `icalendar` validation in a throwaway /tmp venv against a copy of the
  fixture DB — documented in the handoff; the Go-side
  `TestICalendarExport` assertions are the durable coverage.

## Approval actions

- Review fixes committed on `m5-work` as "M5: review fixes"
  (`api_retention_test.go` flake fix + adversarial regression test,
  `api_portal_settings_test.go` batch scenario, this review file).
- Full acceptance re-run green (see above); working tree clean.
- Tag `m5-approved` created on `m5-work`.
