# M1 review

Reviewer: re-read `plan.md` ("Collections and access", "Users: updates and approval",
"Issue read rule", "Issue update rule", "Public submission routes", "Retention"),
the M1 section of `milestones.md`, `reviews/M1-handoff.md`, and
`git diff m0-approved..m1-impl`.

## Verdict

**Approved** — after one small fix applied directly by the reviewer (see finding 1),
committed as `M1: review fixes` and tagged `m1-approved`.

## Acceptance commands (re-run by reviewer)

- `go build ./... && go vet ./...` → exit 0, no output.
- Fresh `pb_data`: `go run ./base migrate up` →

  ```
  Applied 1795000100_collections.go
  Applied 1795000101_portal_settings_record.go
  Applied 1795000102_settings.go
  ```

  exit 0, no error. (The `invalid key path - missing key "role"...` lines in the output
  are the benign DEBUG fallbacks from open question 3, see below.)
- `serve` on that fresh `pb_data`: root page `curl -sI` → `200` with
  `Content-Security-Policy: default-src 'self'; ...; img-src 'self' https://*.tile.openstreetmap.org data: blob:; ...`;
  boot log contains 0 `ERROR` lines. Server stopped by PID and the created `pb_data` deleted afterwards.
- Extra probes (guest, no auth):
  - `POST /api/collections/suggestions/records` with `status:"pending"` → `200` (public create rule works);
  - same with `status:"accepted"` → `400` (create rule blocks non-pending);
  - `POST /api/collections/issues/records` → `403 "Only superusers can perform this action."` (`createRule = null`);
  - `POST /api/collections/events/records` → `400` (`createRule = B` blocks guests);
  - rate limit: see finding 1 (before fix: 7 requests all `200`; after fix: 5× `200`, then `429`).

## Rule-string verification

I dumped the rules fresh (`sqlite3 pb_data/data.db` with `.nullvalue <NULL>` to
distinguish `null` from `""`) and compared the dump with a file containing the
helpers (`B`, `STAFF`, `APPROVED`) expanded inline, exactly as `plan.md` defines
them: `diff` reports no differences — all rule strings are character-for-character
identical to the plan, and every `null`/`""` distinction matches the plan's table:

| Collection | create | list/view | update | delete |
|---|---|---|---|---|
| users | `""` (public) | own \|\| B | self \|\| Beirat-approval composite | null |
| events | B | `""` (public) | B | B |
| suggestions | pending-only body rule | B | B | null |
| issues | null | read rule | update rule | null |
| issue_metas | null | B | null | null |
| notes | `B && @request.body.author = @request.auth.id` | B | B | B |
| portal_settings | null | null | null | null |

The issues read/update rules stored in the DB expand `B`/`STAFF`/`APPROVED`
correctly (verified textually, no helper shorthand stored).

## DB spot checks (re-verified by reviewer)

- `issues.lat_exact` / `issues.lng_exact`: `hidden: true`; `photos`: `protected: true,
  maxSelect 5, maxSize 5242880, mimes jpeg/png/webp, thumbs ["100x100","600x0"]` — as claimed.
- Indexes: `idx_events_date_start`, `idx_suggestions_status`, `idx_issues_status`, and
  `CREATE UNIQUE INDEX idx_issue_metas_issue ON issue_metas (issue)` — all present.
- `issue_metas.issue`: `cascadeDelete: true` — confirmed.
- `portal_settings` record (per column name, not column order): 90/90/90/365 — confirmed.
- `portal_settings` fields: number, `onlyInt`, min 1, max 3650 — confirmed.
- `users.FileToken.Duration = 300` s — confirmed in the stored collection options.
- Rate limits: enabled, PB defaults (`*:auth` 2/3s, `*:create` 20/5s, `/api/batch` 3/1s,
  `/api/` 300/10s — byte-identical to `core/settings_model.go:180-183` in PB v0.42.2)
  plus the two submission rules — confirmed after the fix in finding 1.
- PB version pinned to v0.42.2, identical to `../bugstage/go.mod` — confirmed.

## Findings

1. **Fixed by reviewer (small, obviously correct)** — the suggestions rate-limit rule
   never matched. `migrations/1795000102_settings.go` used the label
   `"POST /api/collections/suggestions/records"`. But PB unbinds the global
   rate-limit middleware for the collection record routes
   (`apis/record_crud.go:28`) and rate-limits them only via
   `checkCollectionRateLimit` (`apis/middlewares_rate_limit.go:81`), which scans the
   labels in the order `["suggestions:create", "*:create", "POST <path>", "<path>"]`;
   `FindRateLimitRule` returns the *first* match
   (`core/settings_model.go:601`). `*:create` (20/5s) therefore always shadowed the
   5-requests/10-min rule, and the plan's "5 requests / 10 min / IP on these two
   endpoints" was **not** enforced on suggestions (empirically: 7 guest creates, all
   `200`). Fix applied: label changed to `"suggestions:create"` (the tag format PB
   documents in `core/settings_model.go:694-702`). Re-verified: 5× `200`, then `429`.
   The `"POST /api/portal/issues"` label is correct for the M3 custom route (custom
   routes do keep the global middleware; only the `/api/collections/{collection}/records`
   group unbinds it) — M3 should prove this with a 429 test.

2. **Observation, plan-conformant, no action** — `users.role` is `Required: true` and
   `users.createRule = ""`. Until M3's `hooks/usersCreate.go` ("force `role=resident`,
   `approved=false`") lands, a public signup must submit `role` and could submit
   `role='beirat'`, which `B` does not additionally constrain (it reads only
   `@request.auth.role`). The milestone sequencing is per plan.md; no deployment
   happens before M11, so the interim exposure is dev-only. But it must be closed in
   M3 (a test "signup cannot set a role other than resident" belongs in M3), and M2's
   role-matrix tests should already pin the update-side rules (`role` not settable via
   PATCH by self or beirat).

3. **Observation** — the plan table's `issue_metas` delete value "cascade" is correctly
   implemented as `deleteRule = null`: metas are removed by the cascade delete of
   their issue; a direct delete is superuser-only. This matches the intent
   ("issue_metas is removed by cascade delete").

4. **Accepted deviations (handoff-itemized, no plan.md change needed)**:
   - `category` as free text (max 100) — plan.md defines no value list; acceptable.
   - File token duration 300 s — plan.md names "file-token settings" without a value.
   - Down migrations `nil` — plan.md does not require down migrations, BugStage pattern.
   - `notes.author` has `Presentable: true` (not in plan.md) — harmless, only affects
     admin-UI relation autocompletion.
   - `settings.Meta.HideControls = true` and an accent color (not in plan.md) —
     harmless cosmetics; HideControls hides the restart/shutdown controls in `/_/`,
     which is even in the spirit of "the Beirat never uses the admin UI".
   - Migration timestamps share the `17950001xx` block — build order is what matters.

## Answers to the handoff's open questions

1. **Update-rule semantics — confirmed correct.** In PB v0.42.2
   (`apis/record_crud.go:391-453`): submitted data (with modifiers resolved) replaces
   `requestInfo.Body`, then the record is **refetched from the DB** with the rule
   compiled into the refetch query. Unqualified `status` therefore resolves as a SQL
   column against the *current stored row*, while `@request.body.*` resolves against
   the *submitted* keys. So the issues update rule means exactly: "the record is
   currently open/in_progress AND the PATCH sets `status` to in_progress/resolved AND
   touches none of the listed fields" — as plan.md intends. Your source reading is right.
2. **Rate limits in M2 tests — decision: disable them in the fixture DB.** The M2
   fixture-creation script should set `rateLimits.enabled = false` in
   `test_pb_data`'s settings and document it in `test_pb_data/README.md`. Rationale:
   API tests hammer one IP; the `/api/` 300/10s rule and the later 5/600 submission
   rules make the suite non-deterministic. Rate-limit behavior itself is better
   proven by one dedicated in-test rule (the way PB's own
   `middlewares_rate_limit_test.go` does it), e.g. in M3 alongside the submission
   429 checklist item. This touches only the test fixture, not `migrations/` — the
   M2 checklist item "no rule was changed relative to M1" (collection rules) remains
   enforceable.
3. **Startup DEBUG lines — benign, agreed.** `core/record_field_resolver.go:306-321`:
   during static (request-less) rule resolution, missing `@request.body.*` key paths
   are logged at Debug level and resolve to NULL (`:isset` → FALSE). It happens when
   PB inspects rules outside a request (e.g. optimizer/hidden-field setups at boot).
   No action needed.

## M1 review checklist

- [x] Every rule string matches plan.md character-for-character after expanding
      helpers (scripted `diff` of the fresh sqlite dump against the expanded plan
      strings; `null` vs `""` verified via `.nullvalue`).
- [x] `issues` and `issue_metas` have `createRule = null`.
- [x] Users self-update rule blocks `role`, `approved`, `verified` (and the Beirat
      branch blocks `role`, `email`, `name`).
- [x] Hidden + protected flags set (`lat_exact`, `lng_exact` hidden; `photos` protected).
- [x] Cascade delete on `issue_metas.issue` (+ unique index `idx_issue_metas_issue`).

## Review fix applied

`migrations/1795000102_settings.go`: rate-limit label for the suggestions create
endpoint changed from `"POST /api/collections/suggestions/records"` to
`"suggestions:create"` (finding 1), with a code comment explaining why the plain path
label can never match. Verified empirically (429 after 5 requests). No rule, test,
or access right was weakened; no change to `plan.md` was necessary.
