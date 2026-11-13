# M0 review

**Reviewer:** reviewer agent, 2026-11-13
**Scope reviewed:** `git show m0-impl` (81b64a9, initial commit — no prior tag exists)
**Reference:** `plan.md`, `milestones.md` → M0, `../bugstage` (bugstage.go, base/main.go, go.mod)

## Verdict

**Approved.** No blocking findings. No fixes were necessary, so no fix commit was
created.

## Acceptance commands (re-run by the reviewer)

`go build ./... && go vet ./...`:

```
(no output, exit 0)
```

`go run ./base serve` on a fresh `pb_data`, then `curl -sI --max-time 10 localhost:8090/`:

```
HTTP/1.1 200 OK
Accept-Ranges: bytes
Cache-Control: no-store
Content-Length: 274
Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://*.tile.openstreetmap.org data: blob:; connect-src 'self'; script-src 'self'; frame-ancestors 'none'
Content-Type: text/html; charset=utf-8
Cross-Origin-Opener-Policy: same-origin
Vary: Origin
Vary: Accept-Encoding
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
X-Xss-Protection: 1; mode=block
Date: Fri, 13 Nov 2026 10:08:11 GMT
```

Status 200 and a `Content-Security-Policy` header are present, matching the
handoff. The fresh `pb_data` created by the run was deleted afterwards and the
server was stopped (confirmed by a second curl failing to connect).

## Checklist (milestones.md, M0)

- [x] **No jsvm, no self-update, no ssh code.**
  `base/main.go` imports only `migratecmd` and `osutils`; a
  `grep -rniE "jsvm|selfupdate|self-update|update\.MustRegister|ssh" --include="*.go" .`
  over the whole tree returns no matches. `portal.go` registers only the SPA
  route, gzip, and cache/CSP headers.
- [x] **PocketBase version pinned and identical to BugStage's.**
  `go.mod:5` requires `ganigeorgiev.com/pocketbase/pocketbase v0.42.2`;
  `../bugstage/go.mod` pins the same version (`dbx v1.13.0`,
  `ozzo-validation/v4 v4.4.1` also match).
- [x] **CSP allows OSM tile images.**
  `portal.go:33`: `img-src 'self' https://*.tile.openstreetmap.org data: blob:`
  — includes both `https://*.tile.openstreetmap.org` (covers the
  `a–f.tile.openstreetmap.org` tile subdomains used by default Leaflet/OSM)
  and `blob:` (needed for the canvas-re-encoded photo blobs in M8). Verified
  live in the served header above. The deliberate narrowing from BugStage's
  `img-src *` (and dropping `media-src`) is an improvement and is the right
  call; the checklist only demands the narrower policy.

## Findings

None blocking. Observations (no action required):

- `Makefile:15-21` — `ui-build`/`ui-test` targets exist in addition to the
  required `build`, `run`, `test`. Trivially correct and needed from M6; accepted.
- `base/main.go:43-45` — the `TemplateLangJS` fallback only applies to
  migrations created via CLI on a **built** binary. All project migrations are
  hand-written Go files under `migrations/`, registered through the package
  import in `portal.go:9`, so this cannot affect them. Deviation as documented
  in the handoff; accepted.
- Working-tree file modes: several files (`portal.go`, `Makefile`, `plan.md`,
  `.gitignore`) are mode 600 in this checkout. Git tracks only the exec bit, so
  a clone is unaffected; cosmetic only.
- `migrations/migrations.go` is an empty package placeholder (blank-imported in
  `portal.go:9`) so the import resolves before M1 adds real migrations — as
  described in the handoff.

## Answers to open questions (M0-handoff.md)

**Module/path naming:** Acceptable — keep it. A Go import path does not need to
end in the package name; `base/main.go` importing `weg-portal` and getting
package `portal` is idiomatic and imports keep working unchanged. BugStage uses
exactly the same pattern (module `ganigeorgiev.com/bugstage/bugstage`, root
package `bugstage`, imported as that path). No rename needed.

## Consequences

- Tag `m0-approved` created on the final M0 commit.
- M1 may start.
