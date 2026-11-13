# M3 review

**Verdict: approved** (with small fixes applied directly by the reviewer, see below).

Diff reviewed: `git diff m2-approved..m3-impl`
(`hooks/{trap,submitIssue,suggestionCreate,usersCreate}.go`, `api_submission_test.go`,
minor updates to `api_users_test.go`, `api_suggestions_test.go`, `portal.go`,
`go.mod` — `github.com/gabriel-vasile/mimetype` promoted from indirect, same
version PocketBase already pins; no migration or rule changes ✓).

## Review checklist (M3)

- [x] Issue + meta created in one `RunInTransaction`; files saved inside it
  (hooks/submitIssue.go:135–159, `issue.Set("photos", photoFiles)` at :145–147).
  Rollback proven by `TestSubmitIssuePersistence` (DB level) and — added in this
  review — `TestSubmitIssueRollbackCleansFiles` (file level, storage dir
  unchanged after a submission whose photo was already uploaded).
- [x] Client-supplied `status`, `visibility`, `lat_exact`, `lng_exact`, `id`
  etc. are ignored server-side: the route only reads a fixed field list and
  sets the record fields itself (hooks/submitIssue.go:135–159);
  `TestSubmitIssuePersistence` step 2 proves the spoof values never land.
- [x] Rounding to 3 decimals happens on the server
  (hooks/submitIssue.go:140–141, `math.Round(lat*1000)/1000`); exact coords kept
  in `lat_exact`/`lng_exact` (:142–143); test asserts `51.412337 → 51.412`.
- [x] Response contains no id/email/record: exactly `{"ok":true}`
  (hooks/submitIssue.go:166, literal-equality assertion in
  `TestSubmitIssuePersistence` step 1); suggestion create never echoes the
  email (hooks/suggestionCreate.go:34 `e.Record.Hide("email")`,
  `NotExpectedContent` in tests).
- [x] Rate-limit rule covers `POST /api/portal/issues` (M1 settings rule,
  proven by `TestSubmitIssueRateLimit`: 5×200 then 429) and suggestion create
  stays covered by the `suggestions:create` rule from M1 — verified in this
  review and pinned down by the new `TestSuggestionCreateRateLimit`
  (5×200 then 429).

## Answers to the handoff's open questions

1. **Rely on PocketBase cleaning up uploaded photos on transaction rollback?**
   Yes — and it is now pinned down by a test. PB defers the model
   after-success/error hooks to the *end* of the transaction
   (`core/db.go` registers them via `txInfo.OnComplete`); on rollback the
   file-field interceptor's `InterceptorActionAfterCreateError` branch
   (`core/field_file.go:362`) calls `deleteNewlyUploadedFiles`, and the empty
   record dir is removed too. Verified empirically: a submission with a photo
   whose meta save fails inside the tx leaves the storage directory byte
   identical (`TestSubmitIssueRollbackCleansFiles`).
2. **Is `mail.ParseAddress` + whitespace rejection sufficient for unverified
   submitter addresses?**
   Yes. Display forms (`Bob <x@y.com>`) contain whitespace and are rejected by
   the route; comment-decorated forms (`x@y.com(c)`) pass the route but are
   then rejected by PB's own email-field validation at meta save time → 400
   via rollback, nothing stored. Both paths probed; no form outside a plain
   addr-spec can reach the DB. (Suggestion emails go through PB's schema
   validation directly and are covered the same way — probed:
   `validation_is_email` 400.)
   Recommendation only: in M4 mail-merge, compare the stored email against
   the parsed address before sending, as defense in depth.

## Findings (all small, fixed by the reviewer in commit "M3: review fixes")

1. **Honeypot type confusion (suggestions)** — hooks/suggestionCreate.go:20 (old):
   `honeypot, _ = v.(string)` silently treated any non-string JSON value
   (`"honeypot":123`, `true`, `null`, …) as an *empty* honeypot, so a bot
   could bypass the trap without filling it. Project-scoped but minimal fix:
   a honeypot key that is present and not an empty string is a filled trap
   → 400. Regression scenario added (`honeypot as number is still a filled
   trap`). (For the multipart issue route this cannot happen — multipart
   values are always strings.)
2. **`NaN` coordinates passed the bounds check** — hooks/submitIssue.go:
   `strconv.ParseFloat` accepts `NaN`, and `NaN < min || NaN > max` is false,
   so the bounding box check was silently bypassed. No record could be
   created (PB's schema write fails → rollback → 400), so there was no
   security impact, but the input was rejected late with the generic
   "Failed to submit the report" message. Now rejected explicitly
   (`math.IsNaN/IsInf` for lat and lng with the proper error message);
   scenarios `lat NaN` and `lat infinite` added. (Inf/-Inf were already caught
   by the bounds comparison.)
3. **Minor, not changed (noted for the record):**
   - hooks/submitIssue.go:131–133 — an invalid bounding-box env config
     (unparsable or `min >= max`) makes every submission fail with the
     misleading client error "The location must be inside the community
     area" (400) instead of a server-side error/500. Deployment-config issue,
     no security impact; acceptable. If it bites in M11, fail loudly at boot.
   - A far-future `form_started_at` is correctly rejected as "too fast";
     a far-past value (`-1000`) passes, which is fine for a time-trap.
   - Multipart `form.Get` returns the first value for repeated parts; extra
     honeypot/photos parts are ignored. Probed: no way to bypass anything —
     an attacker controlling their own request encoding is the exact actor
     the trap doesn't defend against anyway.
   - Sniffed-mime payloads (PNG magic + trailing HTML) remain theoretically
     possible polyglots, but photos are a protected file field served only
     with a file token, as `image/*` with PB's `X-Content-Type-Options:
     nosniff`; and EXIF stripping happens client-side. Accepted per plan.md
     "Files".

## Adversarial probes run against `POST /api/portal/issues`

All resolving to a safe outcome (details under findings):

- `lat`/`lng` = `NaN`, `Inf`, `-Inf`, hex float, trailing newline →
  400 (bounds/explicit check), nothing stored.
- `form_started_at` as text, as future timestamp, as negative number,
  missing → 400 / 400 / 200 (far past is legitimately "old") / 400.
- Email display form, comment form, quoted local part, with whitespace →
  400; a plain address never reaches the response.
- JSON body to the multipart route → 400 ("Failed to parse the submitted
  form data").
- Extra spoofed fields (`status`, `visibility`, `lat_exact`, `id`) → ignored
  (proven by the persistence test).
- 6 photos → 400; text file with `.png` name → 400 (content sniffing, not
  extension); empty `photos` form field without consent → 200 without photos.
- Request body size: PB's global `BodyLimit` middleware
  (`apis/middlewares_body_limit.go`, 32 MB default) bounds the route; the
  5/10 min/IP rate limit caps per-IP abuse.

## usersCreate verification (hooks/usersCreate.go)

- Non-superuser creates force `role=resident`, `approved=false`,
  `verified=false` (hooks/usersCreate.go:21–26) — including a beirat caller,
  a logged-in resident, crafted `role` arrays/numbers (schema-rejected or
  overwritten), and `approved/verified` booleans together (probed:
  `role:"beirat",approved:true,verified:true` by beirat → stored
  `resident`/`false`/`false`). Forced by hook before rules/validators run.
- Superuser keeps explicit `role`/`approved` (test: superuser creates beirat
  with `approved:true` → kept).
- HM/HV created by superuser default to `notify_new_issues=true` unless the
  body sets it (both branches tested: default, explicit `false`).

## Acceptance (re-run by reviewer on the final state)

`go build ./... && go vet ./...`: exit 0, no output.

`go test ./... -count=1`:

```
ok  	weg-portal	1.413s
?   	weg-portal/base	[no test files]
?   	weg-portal/fixturegen	[no test files]
?   	weg-portal/hooks	[no test files]
?   	weg-portal/migrations	[no test files]
?   	weg-portal/ui	[no test files]
```

(Full suite incl. all new scenarios; ~1.4 s.)

## Notes for the next milestone (no action required)

- Handoff's deliberate deviations accepted: bounding box via
  `PORTAL_MIN/MAX_LAT/LNG` env vars with placeholder defaults (real values
  belong in the M11 deployment env file; note it there), and the changed M2
  scenarios (trap fields in suggestion bodies; guest users-create now 200
  with forced role) — matches the plan intent.
- M4 must enforce `Mail only on actual status change` and
  no-user-text-in-submitter-mails; the meta email is guaranteed a plain
  addr-spec (see open question 2).
