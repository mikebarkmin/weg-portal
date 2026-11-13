# M4 handoff

## Done

- `hooks/issueWorkflow.go` — server-side transition validation for EVERY
  `issues` update (including superusers), second gate behind the M2 rules:
  - `pending -> open` (accept): allowed only when `visibility` is set to
    `community`/`private` in the SAME request (checked via the submitted
    request body, not the stored value - the fixture pending issues already
    carry a visibility, and accepting without resubmitting it still fails
    with 400);
  - `pending -> rejected`; `open -> in_progress`; `in_progress -> resolved`;
  - everything else (incl. beirat attempts like `resolved -> pending`,
    `open -> resolved`, `in_progress -> open`) -> 400;
  - updates WITHOUT a status change pass through (beirat may edit accepted
    issues);
  - the hook sets `decided_at` (accept/reject) and `resolved_at` (resolve)
    before save. Comparison basis: `e.Record.Original().GetString("status")`
    vs. `e.Record.GetString("status")` in `OnRecordUpdateRequest` (fires
    before save).
- `hooks/suggestionWorkflow.go`:
  - `pending -> accepted` / `pending -> rejected` valid, everything else
    (e.g. `accepted -> pending`, `accepted -> rejected`, `rejected -> *`) -> 400;
    non-status edits pass through;
  - `decided_at` is set on accept and reject;
  - on `pending -> accepted` the `OnRecordUpdateExecute` hook wraps the
    suggestion persist AND the created `events` record in one
    `RunInTransaction` (PB pattern from `core/collection_model.go`): the
    event copies title, description, date_start, date_end, all_day, location,
    category and leaves `rrule` empty. A failing event insert rolls the
    suggestion back to pending.
- `hooks/mail.go` + `hooks/templates/*.html` — all triggers from plan.md
  "Notifications and email", sent via `routine.FireAndForget` (BugStage
  pattern) from `OnRecordAfterCreateSuccess` / `OnRecordAfterUpdateSuccess`
  and ONLY when `status` actually changed (`Original()` compared):
  - new suggestion -> mail to all beirat users (`beirat_new_suggestion.html`);
  - new issue -> mail to all beirat users (`beirat_new_issue.html`);
  - suggestion accepted / rejected -> mail to the submitter with fixed German
    text + decision + the trusted `decision_note`
    (`suggestion_submitter.html`);
  - issue accepted / rejected / status changed -> mail to the submitter
    address looked up in `issue_metas` by issue id (`issue_submitter.html`);
  - issue accepted -> additional mail to hausmeister/hausverwaltung users
    with `notify_new_issues = true` (`staff_new_issue.html`), skipped
    silently if none;
  - templates: German, `html/template` (via PB's `tools/template` registry,
    which wraps html/template), embedded from `hooks/templates/` with a
    shared `layout.html`; staff/beirat mails may contain the issue content,
    submitter mails contain NO user-supplied text (title, description,
    name are neither in subject nor body - only fixed text, the decision
    and the Beirat-authored `decision_note`).
- Registered `IssueWorkflow`, `SuggestionWorkflow`, `Mail` in
  `portal.go` `bindAppHooks`.
- `fixturegen/main.go`: the hausmeister fixture user now opts in with
  `notify_new_issues = true`, the hausverwaltung stays opted out, so both
  branches are testable; `test_pb_data/` regenerated with
  `go run ./fixturegen` (README restored + updated with the new flag).
- Tests (`api_workflow_test.go`):
  - issue transitions: 14 scenarios (valid accept/reject/progress/resolve,
    accept-without-visibility 400, invalid visibility value 400, backward
    and skipped transitions 400 for beirat, direct `open -> resolved` by
    hausmeister 400, non-status beirat edit 200);
  - issue timestamps stateful test (`decided_at`/`resolved_at` per transition);
  - suggestion transitions: 7 scenarios (+ re-accept as no-op 200);
  - `TestSuggestionAcceptEvent`: event created with all copied fields and
    empty `rrule`, repeated accept adds no second event, reject adds no
    event but sets `decided_at`, and atomicity - a failing event insert
    (injected via a failing events create hook) leaves the suggestion
    pending with `decided_at` rolled back and no event in the collection;
  - workflow mails with `app.TestMailer` (`waitTestMailerMails` helper
    because of FireAndForget):
    - accepted issue -> exactly 2 mails: submitter (`submitter@example.com`,
      subject "Ihre Meldung im WEG-Portal wurde angenommen") + opted-in HM
      (`hm@portal.test`); opted-out HV (`hv@portal.test`) gets nothing;
      beirat gets no update mail; submitter mail contains no title/
      description/name, staff mail contains the title;
    - rejected issue -> exactly 1 mail (submitter), same content rules;
    - `open -> in_progress` (by HM) and `in_progress -> resolved` -> exactly
      1 mail each (submitter, status-specific subject, no title in HTML);
    - non-status updates and invalid transition attempts -> 0 mails;
    - new issue (public route) -> exactly 1 mail to the beirat member;
    - suggestion accepted/rejected -> exactly 1 mail to the submitter with
      the decision note rendered and no title/description echoed; still no
      additional mail on a later non-status edit;
    - new suggestion (public guest create) -> exactly 1 mail to the beirat.
- Test totals: 45 test functions / 246 passing subtest scenarios
  (M3: 35 functions; +10 M4 functions).

## Not done / deviations from plan.md (with reason)

- `routine.FireAndForget` goroutines can outlive a test app instance
  (ApiScenario-based scenarios clean their app up immediately). The
  wrapper `notifyAsync` skips sending when the app is already
  uninitialized (`IsBootstrapped()` guard) and `FireAndForget` recovers
  any residual panic; scenario tests never assert mails anyway. If you
  dislike the guard, it can be dropped - it exists only to keep the test
  output clean, not to change production behavior (the app is long-lived
  in production).
- The submitter mails are HTML-only (no plain-text part), same as the
  BugStage notification mails. plan.md does not require a text part.
- `mail.Address.Name` for beirat/staff recipients is the `users.name` value;
  mails to unverified submitter addresses use the bare address only.
- The "new suggestion" mail deliberately includes the submitter email
  (the Beirat needs it to react and is entitled to see it anyway) and
  beirat/staff mails include the content; both allowed per plan.md.
- The issue-accepted staff mail contains the issue title + rounded
  coordinates (content allowed for staff accounts), not the beirat's own
  mail (which is only informed about NEW issues, i.e. on submit, per plan).

## Open questions for the reviewer

1. On accept I demand `visibility` in the request body even when the record
   already has one (the fixture pending issues carry a visibility as the
   pre-M4 fixtures' documentation of the decision). plan.md says "must set
   visibility" (on accept) - I read that as "the same request that accepts
   must decide/set it". OK?
2. A repeated accept (`status` submitted equal to the stored status) is a
   no-op (200, no mail, no second event), same as any beirat edit without
   a status change - the transition diagram only prohibits status CHANGES
   outside the allowed arrows. OK?
3. `app.Settings().Meta.SenderAddress` is empty until a superuser sets it
   in `/__/` (fixture/test mailer does not care). Should the migration
   set a placeholder `SenderAddress`/`SenderName` so production mails are
   not attempted with an empty From before SMTP setup? I did not add one
   (settings migration is M1/M5 scope; plan says SMTP via env).

## Acceptance command output

`go build ./... && go vet ./...`: exit 0, no output.

`go test ./... -count=1`:

```
ok  \tweg-portal\t1.935s
?   \tweg-portal/base\t[no test files]
?   \tweg-portal/fixturegen\t[no test files]
?   \tweg-portal/hooks\t[no test files]
?   \tweg-portal/migrations\t[no test files]
?   \tweg-portal/ui\t[no test files]
```

Also run twice with `-shuffle=on`: `ok weg-portal` both times, no
flakiness and no recovered-panic noise in the output.
