# M1 handoff

## Done

- `migrations/1795000100_collections.go`: `users` (fields role/approved/
  `notify_new_issues`, rules per plan), `events`, `suggestions`, `issues`,
  `issue_metas`, `notes`, `portal_settings` with the rule strings, indexes and
  field flags from plan.md. Written as typed Go migrations
  (`core.NewBaseCollection` + struct-literal fields), not a JSON snapshot.
- `migrations/1795000101_portal_settings_record.go`: inserts the single
  `portal_settings` record with defaults 90/90/90/365.
- `migrations/1795000102_settings.go`: app name "WEG Portal", HideControls,
  rate limiter enabled with PB defaults + two public-submission rules
  (5 req / 600 s / IP on `POST /api/portal/issues` and suggestions create),
  `users.FileToken.Duration = 300` s.
- Removed the M0 placeholder `migrations/migrations.go`.

## Rule strings as stored (sqlite dump of `_collections`)

| Collection | create | list/view | update | delete |
|---|---|---|---|---|
| users | `""` (public) | `@request.auth.id = id \|\| @request.auth.role = 'beirat'` | `(@request.auth.id = id && @request.body.role:isset = false && @request.body.approved:isset = false && @request.body.verified:isset = false) \|\| (@request.auth.role = 'beirat' && @request.body.role:isset = false && @request.body.email:isset = false && @request.body.name:isset = false)` | NULL |
| events | B | `""` (public) | B | B |
| suggestions | `@request.body.status = 'pending' && @request.body.decision_note:isset = false && @request.body.decided_at:isset = false` | B | B | NULL |
| issues | NULL | read rule (see below) | update rule (see below) | NULL |
| issue_metas | NULL | B | NULL | NULL |
| notes | `B && @request.body.author = @request.auth.id` | B | B | B |
| portal_settings | NULL | NULL | NULL | NULL |

`B` = `@request.auth.role = 'beirat'`. Issues read rule (also used as view):

```
@request.auth.role = 'beirat' || (@request.auth.id != "" && @request.auth.approved = true && @request.auth.verified = true && status != 'pending' && status != 'rejected' && (visibility = 'community' || @request.auth.role = 'hausmeister' || @request.auth.role = 'hausverwaltung'))
```

Issues update rule:

```
@request.auth.role = 'beirat' || (@request.auth.role = 'hausmeister' && @request.auth.approved = true && @request.auth.verified = true && (status = 'open' || status = 'in_progress') && (@request.body.status = 'in_progress' || @request.body.status = 'resolved') && @request.body.title:isset = false && @request.body.description:isset = false && @request.body.category:isset = false && @request.body.visibility:isset = false && @request.body.lat:isset = false && @request.body.lng:isset = false && @request.body.lat_exact:isset = false && @request.body.lng_exact:isset = false && @request.body.photos:isset = false)
```

Both are character-for-character the plan.md rules with `B`/`STAFF`/`APPROVED`
expanded (whitespace collapsed to single spaces).

## Not done / deviations from plan.md

- `category` fields (events, suggestions, issues) implemented as free **text**
  (max 100), plan.md does not define a value list. The frontend will offer
  predefined choices; deviating only if you want a select field.
- File token duration set to 300 s (plan.md names "file-token settings" without
  a value; default was 180 s).
- Down migrations are `nil` (irreversible), following BugStage's settings
  migration pattern. plan.md does not require down migrations.
- Notes migration timestamps use 1795000100-102 (build order is what matters).

## Open questions for the reviewer

1. Rule semantics check: I verified in PB source (apis/record_crud.go
   `recordDataFromRequest`, core ReplaceModifiers) that in update rules
   unqualified `status` resolves against the *current* row during the rule
   filter refetch, while `@request.body.*` resolves against the submitted
   (modifier-resolved) keys only. So the issues update rule means "record is
   open/in_progress AND the PATCH sets status to in_progress/resolved AND
   touches nothing else" — as plan.md intends. Please sanity-check this reading.
2. Rate limits are enabled globally in settings (`*:create` 20/5s etc.). The M2
   fixture DB inherits them; API tests hammer the same IP and may trip rules.
   Propose: fixture creation script disables rate limits (or sets them very
   high) in `test_pb_data`. Decide now or in M2.
3. Serve on fresh pb_data logs DEBUG lines
   `resolveStaticRequestField graceful fallback: invalid key path - missing key "role"...`
   — PB resolves rules once at startup without a request body; missing
   `@request.body.*` keys fall back to NULL. No action needed, confirming you
   agree this is benign.

## Acceptance command output

`go build ./... && go vet ./...`: exit 0, no output.

`go run ./base migrate up` (fresh pb_data):

```
Applied 1795000100_collections.go
Applied 1795000101_portal_settings_record.go
Applied 1795000102_settings.go
```

`go run ./base serve` (fresh pb_data, port 8091): `curl -sI` → `200`, all three
migrations applied during boot (log), server reachable; `grep -c "ERROR"` → 0.

DB spot checks (sqlite3 on pb_data/data.db):
- `issues`: `lat_exact`/`lng_exact` hidden=1; `photos` protected=1,
  maxSelect=5, maxSize=5242880, mimes jpeg/png/webp, thumbs `100x100`,`600x0`.
- Indexes: `idx_events_date_start`, `idx_suggestions_status`, `idx_issues_status`,
  `CREATE UNIQUE INDEX idx_issue_metas_issue ON issue_metas (issue)`.
- `issue_metas.issue`: cascadeDelete=1.
- `portal_settings` record: 90/90/90/365 (verified per column name).
- settings: rateLimits enabled, rules incl. `POST /api/portal/issues` 5/600s.
