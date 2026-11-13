# M2 review

**Verdict: approved.**

`m3-approved`-gate is open; no test or access rule had to be weakened; no code
fixes were needed (hence no "M2: review fixes" commit).

## Acceptance re-run (reviewer)

```
go build ./...    → exit 0, no output
go vet ./...      → exit 0, no output
go test ./... -count=1
ok  	weg-portal	1.282s        (also re-run: 1.259s / 1.321s)
?  	weg-portal/base	[no test files]
?  	weg-portal/fixturegen	[no test files]
?  	weg-portal/hooks	[no test files]
?  	weg-portal/migrations	[no test files]
?  	weg-portal/ui	[no test files]
```

Extra: `go test . -count=1 -race` → `ok 14.778s` (parallel tests + token cache
are race-clean).

Fixture integrity: `go run ./fixturegen` onto a wiped `test_pb_data/` succeeded
and the full test suite passes against the freshly generated DB. I dumped the
rule columns (`listRule/viewRule/createRule/updateRule/deleteRule`) of all 7
app collections from (a) the committed `test_pb_data/data.db` and (b) the
freshly regenerated one — byte-identical, and character-for-character the
rules from plan.md. Rules were not hand-weakened in the committed fixture.
(Working tree restored to the committed fixture afterwards; clean.)

## Findings

1. **`migrations/1795000101_portal_settings_record.go:17` was changed after
   M1 approval without being mentioned in the handoff.** The only change in
   `migrations/` vs `m1-approved` is the added `record.Set("id", "portsettings000")`
   so the singleton record gets a deterministic id for the tests. It is
   *not* a rule/field/index change and does not affect access (verified against
   the DB dumps above). Nothing is deployed yet, so editing the seeding
   migration (instead of adding a follow-up migration) is harmless. Accepted,
   but such post-approval migration edits must be disclosed in the handoff.
   No action required.

2. **Coverage matrix is representative, not literally 6 identities × 5
   operations per collection** (see the count below). `users`, `events`,
   `issues` (and `suggestions` on list/create) cover all six identities;
   `issue_metas`, `notes`, `portal_settings` use one representative per
   identical rule class. I verified the abbreviation is safe: the M1 rule
   strings (pinned by my DB dump) only ever consult the predicates
   `role` (beirat/hausmeister/hausverwaltung), `approved`/`verified`, and
   auth-vs-guest — and for every collection+operation the distinct outcomes
   of these predicates are each pinned by at least one scenario. The missing
   cells are provably identical to tested cells, e.g. `portal_settings` has
   `null` rules (no predicate at all → every identity 403/404); `notes` is
   beirat-only (resident ≡ unapproved ≡ HM ≡ HV); the `APPROVED`-sensitive
   behavior (the only place `unapproved` can differ from `resident`) is fully
   covered on `issues` and `users`. Not requesting changes — the informative
   cells are all present — but M3+ tests should keep the same rule: pin every
   distinct identity-predicate outcome per rule, not fewer.

3. **Known, planned gap to close in M3 (reminder):** `users.createRule` is
   public with no restriction on `role`/`approved` yet, and
   `hooks/usersCreate.go` (which forces `role=resident`, `approved=false`)
   is an M3 task. Today a guest can therefore create an account with
   `"role":"beirat","approved":true` (the M2 tests don't and must not assert
   otherwise — the rule is per plan). Not an M2 defect (nothing deployed
   until M11), but the M3 review must confirm the hook and a test that this
   attempt fails. Same for the beirat-side Go hook that rejects `role`
   changes outside update-rule coverage.

4. **Minor (accepted):** a few negative list tests assert `"totalItems":0`
   where a sibling scenario additionally asserts `NotExpectedContent` of the
   submitter email (e.g. `api_suggestions_test.go` "unapproved resident" /
   `api_issue_metas_test.go` "hausverwaltung"). Since the email can only
   travel inside a record, `totalItems:0` already proves absence. No change
   requested.

5. **Confirmed handoff PB-behavior notes** (all correct and, importantly,
   reported rather than worked around): filters on schema-hidden fields are
   rejected with 400 (see checklist item 5); `ApiScenario{}` with nil
   `ExpectedContent` expects an empty body; deletes return 204; expanding
   `issue_metas` from `issues` is silently ignored; upload names get random
   suffixes. The hausmeister `open → resolved` direct jump is rule-permitted
   and deliberately not asserted (it becomes invalid via the M4 transition
   hook) — agreed with the handoff's reasoning; M4 must deliver that test.

## Answers to the open questions

1. **Token caching in `getAuthToken` — OK to keep.** The fixture DB carries a
   committed token secret and `NewTestApp` clones the pristine directory for
   every scenario, so a cached token's embedded record state always matches
   the fresh clone, and the cache lives only for the current test process.
   Measured effect: full suite in ~1.3 s vs. one extra app boot per scenario.
   Caveat for future milestones: if a test mutates `users` records within a
   single scenario sequence and then re-auths, it must mint a fresh token
   (`getFileToken` pattern) instead of using the cache.

2. **Generic `OnRecordEnrich()` with the collection check inside — OK to
   keep.** PocketBase dispatches tagged and untagged enrich hooks through the
   same record path; the in-hook `e.Record.Collection().Name != "issues"`
   guard makes it exactly equivalent to `OnRecordEnrich("issues")` for
   behavior, and it matches the BugStage hook style (which also uses the
   generic form). No leak to other collections is possible: the hook touches
   only `issues` records, and only the two exact-coordinate fields.

## Checklist M2

- [x] **Each identity × operation × collection actually exists as a scenario
  (counted).** 187 scenarios total (matches the handoff): users 41, events 27,
  suggestions 24, issues 41, issue_metas 14, notes 20, portal_settings 8,
  security 12. All five operations exist per collection. Identity coverage
  per collection and operation (g = guest, u = unapproved, r = resident,
  b = beirat, m = hausmeister, v = hausverwaltung, S = superuser):

  ```
              list        view        create       update       delete
  users        g u r b m v g u r b m v g u r b m v   g u r b m v  g r b m
  events       g u r b m v g u r b m v g u r b m v   g r b v      g r b m
  suggestions  g u r b m v g   r b m   g u r b       g   r b m    g r b
  issues       g u r b m v g u r b m v g r b m v     g r b m v    g r b m
  issue_metas  g   r b m v g r b m   g   b           r b          b
  notes        g   r b m v g r b     g   r b m      g   r b      g r b m
  portal_set.  g r b S     g         g              r            b
  ```

  Operations whose rule uses no auth predicate (null / beirat-only /
  public-create) are pinned by one representative identity per class; see
  finding 2 for why the missing cells are rule-equivalent to tested ones.
  The collections where identity actually discriminates (`users`, `issues`,
  `events`, `suggestions`) have the full six on the disc listing/topology.

- [x] **Negative tests assert absence.** Resident/unapproved issue list and
  view scenarios assert `NotExpectedContent` of `lat_exact`, `lng_exact`,
  `submitter@example.com` and of every private/pending/rejected fixture id
  (`api_issues_test.go:41ff, 85ff`); likewise for suggestions
  (`api_suggestions_test.go:19`) and issue_metas lists and the expand probes
  (`api_security_test.go:65ff`). See finding 4 for the `totalItems:0` variant.

- [x] **Filter-probing test is meaningful.** `fixturegen/main.go` sets
  `lat_exact` of community issues to 51…59 (>50) and of private/pending/
  rejected ones to 10–19 (<50). The resident probe `?filter=(lat_exact<50)`
  (`api_security_test.go:23`) would shrink the resident list from 3 to 0 if
  hidden-field filtering were applied — fixture values sit on both sides of
  the filter threshold. PocketBase answers 400, the plan's "errors" branch,
  which cannot narrow results. (The `lng_exact=7.456789` variant is not
  discriminating on its own — all issues share that value — but it documents
  the same 400 and the lat test carries the semantic.)

- [x] **No rule was changed relative to M1.** `git diff m1-approved..m2-impl
  -- migrations/` contains exactly one added line
  (`record.Set("id", "portsettings000")`, finding 1) — no rule, field, index
  or hidden/protected flag touched. Cross-checked against the live fixture DB
  and a fresh regeneration: rule strings identical to M1/plan.md.

- [x] **Unhide / hidden-field filtering behaves as plan.md assumes; nothing
  was worked around.** `Unhide` in the enrich hook restores `lat_exact`/
  `lng_exact` for beirat/HM/HV (proven positively in list/view scenarios),
  hidden fields never appear for residents, and filters on hidden fields are
  rejected (400) — the stronger of the two outcomes plan.md allows ("no
  effect or errors"). All of this was reported in the handoff's PB-findings
  section, not silently accommodated. plan.md needs no change.

## Enrich hook sanity (`hooks/issueEnrich.go`)

- Unhides only for `beirat`, `hausmeister`, `hausverwaltung`
  (hooks/issueEnrich.go:23-26) — verified by positive and negative API tests.
- Only on the `issues` collection (hooks/issueEnrich.go:17-19); other
  collections are passed through untouched, so no field can leak elsewhere.
- Safe defaults: `e.RequestInfo == nil` or no auth → no unhide.
- Registered exactly once in `bindAppHooks` (portal.go) and bound the same way
  in `setupTestApp`, so realtime shares the logic; the websocket transport is
  covered by the documented manual script `test_pb_data/REALTIME_CHECK.md`
  (allowed by the milestone wording), which includes the positive beirat case
  and a private/pending negative case.

## Small fixes applied

None — nothing met the "small, obviously correct" bar; there is no
`M2: review fixes` commit.
