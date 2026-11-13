# M11 review

**Reviewer:** reviewer agent · **Branch:** `m11-work` · **Verdict: approved**
(with small fixes applied directly as `M11: review fixes`, commit `3db9331`)

## Scope check (`git diff m7-approved..m11-impl --stat`)

Caveat on the suggested command: `m11-impl` == `m11-work` (4bcef8d) is a child
of the merge `b8cf574` whose **first-parent lineage already contains M5/M6
application code**; `m7-approved` (9f558bb) sits on the parallel `m7-work`
branch. The raw range therefore shows `hooks/retention.go`, `hooks/ical.go`,
`api_*_test.go` etc. — but those are **pre-existing main-lineage files,
byte-identical to their already-approved states**, not M11 authorship.

The M11 commit itself (`git diff b8cf574..m11-work --stat`) adds **exactly the
allowed files and nothing else**:

```
.dockerignore, .gitignore, Caddyfile, Dockerfile, caddy.env.example,
compose.yaml, docs/deploy.md, portal.env.example, reviews/M11-handoff.md
9 files changed, 651 insertions(+)
```

No application code touched by M11. ✅

## Acceptance (re-run in full by the reviewer, rootless podman/podman-compose)

Env: `caddy.env` (untracked) with a hash **I generated myself** via the
documented path — `podman run --rm docker.io/library/caddy:2-alpine caddy
hash-password --plaintext 'm11-review-acceptance'` →
`$2a$14$fJc6sJFX1prEGFBsWZoitOtcbfTQsFKwdpw19XzRMKDzD8dGcWo3q` (throwaway).
Ports via gitignored `.env`: `HTTP_PORT=8081`, `HTTPS_PORT=8443`.

**Build** — `docker compose build` ok (all three stages; images
node:22-alpine, golang:1.27-alpine, alpine:3.21, caddy:2-alpine pre-pulled).

**Secret scan of image** — `podman history` layer list matches the Dockerfile
instruction-for-instruction (no stray COPY/RUN), `Config.Env` is only `PATH`,
`Config.User` is `nonroot:nonroot`; `grep` inside the image for bcrypt
prefixes/password markers: no hits; `/app` contains only the binary + empty
`chown`ed `pb_data/`. Repo: `portal.env`/`caddy.env` gitignored (verified with
`git status --ignored`); example files contain only an invalid placeholder
hash. ✅ **No secrets in repo or image.**

**Curl checks through Caddy** (`curl -k`, internal CA):

```
GET  /                     -> HTTP/2 200
   strict-transport-security: max-age=31536000; includeSubDomains
   content-security-policy: default-src 'self'; style-src 'self' 'unsafe-inline';
     img-src 'self' https://*.tile.openstreetmap.org data: blob:; ...
GET  /@assets/index.js     -> 200, text/javascript, 529 kB (real Vite bundle;
                              served index.html != checked-in placeholder =>
                              build-stage copy works, not the stub SPA)
GET  /_/  (no auth)        -> 401 + www-authenticate: Basic realm="restricted"
GET  /_/  (wrong creds)    -> 401
GET  /_/  (-u portal:m11-review-acceptance) -> 200, <title>PocketBase</title>
GET  /api/health           -> {"message":"API is healthy.",...}
```

Admin reachable only with the correct hash → reaches PB admin UI. ✅

**Container security**

- `podman image inspect`: `Config.User = nonroot:nonroot`; `podman exec
  portal id` → `uid=10001(nonroot) gid=10001` — non-root actually used. ✅
- `podman port portal` → no bindings (`expose` only); 8080 is *not* published
  to the host; Caddy publishes 8081→80 / 8443→443 (env-overridable, production
  default 80/443). ✅
- `pb_data` mounted exclusively as the **named volume**
  `weg-portal-m11_pb_data` → `/app/pb_data` (compose.yaml:30); caddy data in
  named volumes `caddy_data`/`caddy_config`; `Caddyfile` mounted `ro`
  (`rw=false` verified via `podman inspect`). Portal container is not
  `read_only:` — correct, SQLite must write into the volume; the container
  filesystem itself stays image-overlay. ✅

**Restore drill — RE-RUN, not trusted** (my own records, throwaway passwords):

1. Two superusers via documented CLI (`superuser upsert admin1/admin2`) ✅
2. Superuser token via public auth route; created probe record in
   `events` (`zb09dje7jxna32d`, "M11 Review Restore-Probe"), readable
   unauthenticated through Caddy ✅
3. `POST /api/backups {"name":"m11-review.zip"}` → 204; zip contains
   `data.db` (245 760 B) + `auxiliary.db`; copied out via `podman cp` ✅
4. `docker compose down` (no `-v`); volume wiped incl. dotfiles
   (`rm -rf .[!.]* *`), restored from zip, `chown -R 10001:10001` ✅
5. `up -d`; **probe record `zb09dje7jxna32d` verified present** via
   public GET through Caddy, admin1 auth-with-password → 200, backups dir
   empty (fresh volume state) ✅
6. **Negative test reproduced** (validates the deploy.md warning): restored
   *without* `chown` → portal exits with `attempt to write a readonly
   database (8)`, Caddy answers 502. The documented `chown` step is
   load-bearing, not cargo-cult. ✅ **Restore drill actually performed.**

**Realtime/SSE** — `flush_interval -1` verified in Caddyfile on *both* proxy
blocks (lines 54, 61). Dynamic test (single shell; background curl killed by
PID afterwards): `GET /api/realtime` → `event:PB_CONNECT` immediately
(13 ms after connect); subscription via `POST /api/realtime {"clientId":…,
"subscriptions":["events"]}` → 204; then record created at 13:46:00.452 →
`event:events` with `action:create` arrived at **13:46:00.465, 13 ms later,
while the connection stayed open**. No buffering by Caddy; progressive
streaming confirmed end-to-end (PocketBase also sets `X-Accel-Buffering: no`
itself, realtime.go). ✅

## Review of the deployment files

- **Dockerfile** — multi-stage (node:22-alpine → golang:1.27-alpine →
  alpine:3.21), tags pinned at minor level with `docker.io/` prefix,
  matching `go.mod` (`go 1.27.3`; no digest pinning — noted, acceptable for
  this setup). CGO disabled, `-trimpath -ldflags "-s -w"`. `USER nonroot`
  (uid 10001, `-D -H`), `pb_data` pre-created + chowned. No
  `--mount=type=cache` (no cache-mount leak risk). Alpine runtime (allowed
  choice, needs `wget` for the healthcheck anyway). ✅
- **`.dockerignore`** — excludes `pb_data`, `test_pb_data`, `ui/node_modules`,
  `ui/dist` (rebuilt in stage 1), `.git`, env files, `*.zip`, binaries. ✅
- **compose.yaml** (after review fixes) — `restart: unless-stopped` on both
  services; json-file log rotation 10 m × 3 (compose.yaml:24,40 — previously
  missing, see Findings); compose-level `healthcheck` (compose.yaml:18)
  mirrors the Dockerfile probe; `caddy depends_on: portal: condition:
  service_healthy` (compose.yaml:55) — verified working under podman-compose
  (portal reports `(healthy)`, Caddy starts after) **and** under Docker spec.
  Port 8080 internal only. ✅
- **Caddyfile** — HSTS (line 33) + X-Content-Type-Options/Referrer-Policy/
  X-Frame-Options on all routes; `admin off`; `/_*` basic-auth'd with
  `header_up -Authorization` (line 52 — prevents the Basic header from
  being parsed as a bogus superuser token by PocketBase); SSE not buffered
  on both blocks; production LE variant and IP-allowlist variant written
  out as comments. ✅
- **docs/deploy.md** — covers two superusers (§2.3), MFA enabling
  (§2.4, password + email OTP, "für beide Superuser"), restore drill incl.
  the empirically-found `chown` (§3), update-against-copy procedure with
  rollback note (§4), env reference (§5). Honesty about untestables was
  implicit before (§7 title only); now explicit via new §8 (LE TLS, S3,
  cron timing, HEALTHCHECK under Docker) — added in review fixes. The M11
  acceptance (§7) I reproduced step-by-step. ✅

## Findings

All findings were minor; the actionable ones were fixed directly in
`3db9331`.

1. **[fixed]** compose.yaml: `depends_on` was the bare list form — Caddy
   could start before the portal was ready. Milestone text names
   "depends_on with healthcheck". → compose-level `healthcheck` +
   `condition: service_healthy`; side benefit: portall shows `(healthy)`
   even under podman, which ignores the OCI image HEALTHCHECK.
2. **[fixed]** compose.yaml: no logging rotation (Docker json-file grows
   unboundedly in production). → `logging: json-file, 10 m × 3` both
   services; verified podman honors it (`LogConfig: json-file 10MB`).
3. **[fixed]** docs/deploy.md: untestables (LE TLS, S3, cron timing, image
   HEALTHCHECK under Docker) were only implicit in §7 / handoff. → new
   explicit §8 with a "verify at first real deployment" instruction.
4. **[noted, no action]** Duplicate security headers on proxied responses
   (Caddy's `X-Content-Type-Options`/`X-Frame-Options` plus PocketBase's
   own): `x-content-type-options` appears 2× (both `nosniff`),
   `x-frame-options` as `DENY` + `SAMEORIGIN` (handoff open question 3).
   Both values block framing; no security impact; harmonizing would need
   route-scoped Caddy blocks — out of M11 scope, left as-is. Handoff
   question answered: agreed with the implementer's assessment.
5. **[ok]** Handoff question 1: `depends_on` on the caddy service (not
   portal) is the correct direction — portal has no dependency. Milestone
   wording is singular about "depends_on with healthcheck"; satisfied via
   the caddy→portal gate.
6. **[ok]** Handoff question 2: `${HTTP_PORT:-80}`/`${HTTPS_PORT:-443}`
   keeps production semantics and the local rootless workaround declarative;
   `.env` gitignored. Accepted.
7. **[ok]** Handoff's parallel-branch note: M11 built on the pre-m8 merge
   is fine for this review — deployment files are orthogonal, image embeds
   the ui/dist of the reviewed branch at build time.
8. **[observed]** HSTS without `preload` — fine (preload would be a
   policy decision, not required by plan.md).
9. **[observed]** Basic-auth gate covers `/_*` (admin UI). `/api/…`
   superuser endpoints remain reachable directly but require a superuser
   token (plus PB rate limits) — conforms to plan.md, which scopes the
   Caddy restriction to `/_/`. Defense in depth holds.

## Acceptance checklist (from milestones.md)

- `docker compose build && docker compose up -d` — ✅ re-run, both green.
- `curl` checks: HSTS ✅, CSP ✅ (from the SPA handler), `/_/` blocked
  unauthenticated (401) ✅ — need to be reopened ❌ blocked (401) ✅,
  with credentials reaches PB admin API ✅.
- Backup created and restored once — ✅ re-run by reviewer incl.
  verification of a known record after restore.

**Review checklist:**

- [x] No secrets in repo or image. (image layers/config scanned, repo
  examples contain only invalid placeholder hash; env files gitignored)
- [x] Restore drill actually performed. (reproduced by the reviewer,
  incl. the negative case without `chown`)

**Extended checks:**

- [x] non-root runtime user actually used (`image inspect` + `exec id`)
- [x] port 8080 not published to the host (`expose` only, verified)
- [x] `pb_data` only via named volume
- [x] `flush_interval -1` in Caddyfile + SSE progressive delivery measured
- [x] restart policies, logging rotation, `depends_on` + healthcheck
- [x] docs/deploy.md: two superusers, MFA, restore drill, update-against-copy
- [x] untestables documented honestly (new §8)

## Verdict

**Approved.** Everything the milestone required works re-run from scratch;
the three findings worth changing were small and are fixed in `3db9331`
("M11: review fixes"). After acceptance, stack fully torn down
(`docker compose down -v` — no containers, volumes or networks left;
localhost artifacts under /tmp deleted).

Tag `m11-approved` set on the review commit.
