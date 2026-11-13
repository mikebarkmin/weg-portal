# M4 review

- Reviewer scope: `git diff m3-impl..m4-impl` on branch `m4-work`
  (worktree `weg-portal-m4`), plus hooks/tests re-read in full after the fixes.
- Verdict: **approved** (after two reviewer fixes, commit `11152ef`
  "M4: review fixes").

## Acceptance re-run (after fixes, in this worktree)

```
$ go build ./... && go vet ./... && echo OK
OK

$ go test ./... -count=1
ok  \tweg-portal\t2.012s
?   \tweg-portal/base\t[no test files]
?   \tweg-portal/fixturegen\t[no test files]
?   \tweg-portal/hooks\t[no test files]
?   \tweg-portal/migrations\t[no test files]
?   \tweg-portal/ui\t[no test files]

$ go test ./... -count=1 -shuffle=on   (three consecutive runs)
ok  \tweg-portal\t2.057s
ok  \tweg-portal\t2.004s   (+ a -run Workflow subset: 0.745s)
```

No failures, no flakiness, no recovered-panic noise. Also re-run once on the
pre-review tree (`m4-impl`): identical result.

## Review checklist (milestones.md M4)

- [x] **No user-supplied text in any mail to a submitter address.** Both
      submitter templates (`hooks/templates/issue_submitter.html`,
      `suggestion_submitter.html`) contain only fixed German text, the
      decision and (suggestions) the Beirat-authored `decision_note`.
      Subjects are fixed strings (`issueSubmitterSubject`,
      `mail.go:385-401`) and recipients are bare addresses
      (`[]mail.Address{{Address: submitter}}`, no `name` reflection).
      `html/template` escaping applies. Content-bearing mails
      (`beirat_new_issue`, `beirat_new_suggestion`, `staff_new_issue`) go
      only to beirat / hausmeister / hausverwaltung accounts — allowed per
      plan.md. The `decision_note` cannot be set by the guest
      (create rule forces `decision_note:isset = false`, update is `B`).
- [x] **Mail only on actual status change.** Both update hooks compare
      `e.Record.Original().GetString("status")` vs `e.Record.GetString("status")`
      (`mail.go:108-112` suggestions, `mail.go:149-153` issues); beirat
      non-status edits and failed transitions send nothing (tested).
- [x] **Invalid transitions return 400 for beirat too** — resolved→pending,
      resolved→open, rejected→pending, open→resolved direct, in_progress→open,
      pending→in_progress (`hooks/issueWorkflow.go:58-74`); tested incl. the
      hausmeister open→resolved jump. Verified in the PocketBase source that
      `form.Load(data)` applies the body to `e.Record` before
      `OnRecordUpdateRequest` fires, so the hook really sees the submitted
      status (`apis/record_crud.go:392-512`, forms `RecordUpsert.Load`).
- [x] **Event creation and suggestion accept are atomic.**
      `OnRecordUpdateExecute` wraps persist + event insert in one
      `RunInTransaction` (`hooks/suggestionWorkflow.go:66-93`, PB pattern
      from `core/collection_model.go`). The crashing-events-hook test proves
      rollback of status AND `decided_at`, and PB triggers
      `OnRecordAfterUpdateSuccess` (the mail hook) only after the
      transaction commits (`core/db.go:368-445`), so no orphan mail either.
- [x] Checklist item of the M1/M2 kind re-verified: `pending -> open`
      requires `visibility` in the same request (`requireVisibility`), and
      the hausmeister cannot smuggle anything: the M2 collection rule is
      the first gate, the hook the second; `/api/batch` replays the same
      route handlers, so hooks apply there too.
- [x] Fixture change consistent: `fixturegen/main.go` sets
      `notify_new_issues = true` for the hausmeister, `test_pb_data/data.db`
      contains it (hm=1, hv=0, verified via SQLite), and
      `test_pb_data/README.md` documents it.
- [x] Timestamps `decided_at` / `resolved_at` are set by the hook, not the
      client (see finding 2 — this was NOT true in the submission).

## Milestones "Rules for the reviewer" wider checklist (task brief)

- Crafted-request review of `hooks/issueWorkflow.go`: a hausmeister is
  locked by the collection rule (status must be `in_progress`/`resolved`
  on `open`/`in_progress` records; no other field) and by the hook (only
  the diagram arrows). Alternative write paths — `/api/batch` (replays the
  record route incl. rules and both hooks), multipart bodies (same
  `requestInfo.Body`), superuser endpoints (explicitly covered by the hook
  per the handoff, and superusers are trusted) — offer no bypass. No
  reopen/re-pend path exists for any role.

## Findings and fixes (applied by the reviewer, commit `11152ef`)

1. **A repeated accept was a silent no-op (200), including any request that
   merely re-submits the stored status** — `hooks/issueWorkflow.go` and
   `hooks/suggestionWorkflow.go` (pre-review: `if oldStatus == newStatus {
   return e.Next() }`). This is the double-accept open question from the
   handoff; decided AGAINST the implementer's plan reading (answer to open
   question 2 below). Status is workflow-owned: submitting it without a
   valid transition is now a 400 (`"The report is already in the status ..."
   / "The suggestion is already in the status ..."`), while beirat edits that
   do not send `status` at all remain 200. Consequence noted: a superuser
   editing issues through the `/_/` UI (which always resubmits all fields,
   including `status`) gets a 400 — acceptable, since per plan.md superusers
   are setup/roles only and issue content editing must go through the API/SPA.
   plan.md "Issue update rule" updated accordingly (reviewer edit, per
   review rule 6). Tests: new scenarios `beirat repeat accept (same status
   submitted)` in both transition tests; `TestSuggestionAcceptEvent` step 2
   flipped from "200 no-op" to "400".

2. **`decided_at` / `resolved_at` were client-forgeable.** The beirat update
   rule is the unrestricted `B`, so a beirat (or superuser) could set
   arbitrary timestamps in any update — e.g. `resolved_at` in a reject
   request, or `decided_at` in a later title edit — while plan.md says "The
   hook sets `decided_at` / `resolved_at`". Both hooks now restore the
   stored values (`e.Record.Original().Get(...)`) at the top of
   `OnRecordUpdateRequest` before applying a transition, so the two fields
   are hook-owned on every path. plan.md wording extended accordingly.
   Regression tests added (`TestWorkflowTimestampsOwnedByHook`: forged
   timestamps ignored on transitions and on non-status edits, for issues and
   suggestions).

No further findings. Everything else (templates, mail dispatch, atomicity,
fixture changes, portal.go registration) is correct as submitted.

## Answers to the handoff's open questions

1. **`visibility` must be in the accepting request even when the record
   already carries one** — agreed with the implementation. plan.md reads
   "accept (beirat, must set visibility)": the accept request must carry the
   (re)decision; the stored fixture value is not a decision made at accept
   time. Keep as is.

2. **Double-accept no-op** — NOT OK, decided against the implementer's
   reading ("transition diagram only prohibits status CHANGES"). The
   diagram defines the only writes to `status`; re-submitting the stored
   status is at best a client bug (double-clicked moderation button) that
   must surface as an error instead of silently succeeding, and "no-op"
   semantics made `status` partly client-owned. Implemented in this review
   (see finding 1); plan.md updated by the reviewer. Deliverable for the
   implementer: the SPA moderation forms must not send `status` for pure
   content edits.

3. **SenderAddress/SenderName placeholder** — agree with the implementer,
   no placeholder migration. Mails are fire-and-forget with errors logged;
   the superuser sets the (real, SPF/DKIM-aligned) sender during production
   setup (M6 ops, plan.md "SMTP provider for the app domain"). A placeholder
   From would be worse than a logged failure. No change.

The remaining handoff deviations (HTML-only submitter mails, recipient name
for internal mails, submitter email in the beirat new-suggestion mail,
`notifyAsync` bootstrap guard) are all acceptable per plan.md.

## Approval actions

- Working tree on `m4-work` clean at `11152ef`; full acceptance re-run green.
- Tag `m4-approved` created on `m4-work`.
