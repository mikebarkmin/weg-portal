# M0 handoff

## Done

- `git init`, `.gitignore` (pb_data/, ui/node_modules/, ui/dist/* except the
  checked-in placeholder, binaries, test_pb_data runtime artifacts).
- `go.mod` module `weg-portal`, PocketBase pinned to
  `ganigeorgiev.com/pocketbase/pocketbase v0.42.2` — identical to
  `../bugstage/go.mod` (also dbx v1.13.0, ozzo-validation/v4 v4.4.1).
- `portal.go` with `New()`/`NewWithConfig()`/`bindAppHooks()` modeled on
  `../bugstage/bugstage.go`: `apis.Static(ui.DistDirFS, true)` SPA handler with
  implicit index fallback, `apis.Gzip()`, cache headers (`/@static/` →
  1 week + SWR, everything else `no-store`), CSP header.
- `base/main.go` modeled on `../bugstage/base/main.go` with **only**
  `migratecmd` (Go templates under `go run`); no jsvm, no self-update plugin,
  no SSH server, no extra flags.
- `ui/embed.go` (`//go:embed all:dist`) and placeholder `ui/dist/index.html`
  so the binary builds before the React app exists.
- `migrations/migrations.go` — empty package placeholder so the import in
  `portal.go` resolves; first real migration lands in M1.
- `Makefile` with `build`, `run`, `test` (plus `ui-build`/`ui-test` for M6+).

## Not done / deviations from plan.md

- CSP: BugStage's `img-src * data: blob:` was narrowed to
  `'self' https://*.tile.openstreetmap.org data: blob:` and `media-src` was
  dropped (portal serves no media). This is what the M0 review checklist
  requires, so it is a deliberate derivation from the BugStage default,
  not from plan.md.
- The migratecommand fallback for non-`go run` binaries uses
  `TemplateLangJS` (BugStage default); all real migrations are Go files, so
  this only affects the `migrate history` CLI behavior.

## Open questions for the reviewer

- Package name at module root is `portal` (module path `weg-portal`), so
  `base/main.go` imports it as `weg-portal`. Confirm this is acceptable
  versus renaming the module to e.g. `weg-portal/portal`.

## Acceptance command output

`go build ./... && go vet ./...`:

```
(no output, exit 0)
```

`curl -sI localhost:8090/` against `go run ./base serve --http=127.0.0.1:8090`
on a fresh pb_data:

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
Date: Fri, 13 Nov 2026 10:05:24 GMT
```

Review checklist status (self-assessed):

- [x] No jsvm, no self-update, no ssh code.
- [x] PocketBase version pinned and identical to BugStage's.
- [x] CSP allows OSM tile images (`img-src` includes
  `https://*.tile.openstreetmap.org` and `blob:`).
