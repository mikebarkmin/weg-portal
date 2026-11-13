# M11 handoff

## Done

- `Dockerfile` — multi-stage, pinned base images:
  1. `docker.io/library/node:22-alpine` — `ui/package.json` + `package-lock.json` → `npm ci` → copy `ui/` → `npm run build` → `ui/dist`;
  2. `docker.io/library/golang:1.27-alpine` — `go mod download`, copy source, copy the fresh `ui/dist` over the checked-in placeholder, `CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /weg-portal ./base` (modernc.org/sqlite, pure Go — no CGO);
  3. runtime `docker.io/library/alpine:3.21`, non-root user `nonroot` (uid 10001, `-D -H`), `ca-certificates` + `tzdata` (SMTP/S3 TLS, cron timezones), `WORKDIR /app`, only the binary copied, `/app/pb_data` pre-created + chowned, `EXPOSE 8080`, `HEALTHCHECK` against `GET /api/health` (busybox wget), `ENTRYPOINT ["/app/weg-portal"]`, `CMD ["serve", "--http=0.0.0.0:8080"]` (port decision based on `base/main.go`: the `serve` subcommand accepts `--http`; PB default 8090 was deliberately replaced with the conventional 8080 which is also used by the Caddy reverse_proxy upstream).
- `.dockerignore` — `pb_data`, `test_pb_data`, `ui/node_modules`, `ui/dist` (fresh from the node stage), `.git`, env files (`portal.env`, `caddy.env`), compose/Caddy files, `*.zip`, binaries.
- `compose.yaml` — services:
  - `portal`: `build: .` (image `weg-portal:latest`), `restart: unless-stopped`, `env_file: portal.env`, named volume `pb_data:/app/pb_data`, `expose 8080` (internal only — Caddy is the only ingress);
  - `caddy`: `docker.io/library/caddy:2-alpine`, `restart: unless-stopped`, `env_file: caddy.env`, ports 80/443 (overridable via `HTTP_PORT`/`HTTPS_PORT` for rootless podman, see below), mounts `./Caddyfile` read-only, named volumes for caddy data/config (stable internal CA + OCSP stapling cache), `depends_on: [portal]`;
  - named volumes `pb_data`, `caddy_data`, `caddy_config`.
- `portal.env.example` — documents the `PORTAL_MIN_LAT/MAX_LAT/MIN_LNG/MAX_LNG` bounding box (`hooks/submitIssue.go`), that **SMTP and S3 backup settings are deliberately NOT consumed from env** (configured by a superuser in `/_/`, matching migrations 1795000102/1795000103), and that superuser credentials are never set via env (created via CLI, see deploy.md).
- `caddy.env.example` — `WEG_SITE_ADDRESS`, `WEG_ADMIN_BASIC_USER`, `WEG_ADMIN_BASIC_HASH` (bcrypt hash, generated with `caddy hash-password`; hash only, never the plaintext). Placeholder hash in the example matches nothing.
- `Caddyfile` — site block `{$WEG_SITE_ADDRESS:localhost}`:
  - `tls internal` for the container-local default; commented-out **PRODUCTION VARIANT** (real domain, `tls { protocols tls1.2 tls1.3 }`, optional LE staging CA against rate limits);
  - HSTS: `Strict-Transport-Security "max-age=31536000; includeSubDomains"` plus `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` on all routes;
  - `handle /_*` → **basic_auth** (documented alternative: commented `remote_ip` allowlist variant, layering possible);
  - `reverse_proxy portal:8080` with `flush_interval -1` on **both** proxy blocks (SSE/realtime not buffered);
  - found + fixed during acceptance: after basic_auth, Caddy forwarded the `Authorization: Basic ...` header to PocketBase, which tried to parse it as a superuser token and answered `/_/` with a 401 JSON. Fixed with `header_up -Authorization` in the `/_/` block.
  - static asset caching stays with the app's own handler (plan.md), untouched by Caddy.
- `docs/deploy.md` (German, audience: deployment/ops) — prerequisites, env files, first start, creating the **two superusers** (`docker compose exec portal /app/weg-portal superuser upsert …`, deliberately NOT via env), enabling superuser **MFA** (password + email OTP in `/_/`, requires SMTP), SMTP + S3 configuration in `/_/`, **restore-from-backup drill** (backup → `docker compose down` → wipe volume incl. dotfiles → unzip backup → **`chown -R 10001:10001`** (runtime uid) → `up -d` → verify known record + superuser login), update procedure (test against a **copy** of pb_data in a separate volume first, then production, rollback note), env var reference table, Caddy variants (basic auth vs IP allowlist, local internal CA vs production LE), local verification runbook for the compose stack.
- `.gitignore` — added `/portal.env`, `/caddy.env`, `/.env` (compose port overrides), `*.zip` (local backup drill artifacts). All real secrets live only in the untracked env files; the repo contains **no** passwords/hashes (the example file has an invalid placeholder hash).

## Not done / deviations from plan.md (with reason)

- **No Go/app code changed** (no exception needed).
- `https://localhost:443` → `https://localhost:8443`: rootless podman cannot bind ports < 1024 (no DNS/VPS here). `compose.yaml` therefore publishes `"${HTTP_PORT:-80}:80"` / `"${HTTPS_PORT:-443}:443"` — production defaults unchanged (80/443), local verification uses a gitignored `.env` with `HTTP_PORT=8081`/`HTTPS_PORT=8443`. Documented in deploy.md §7.
- Docker/podman emits `HEALTHCHECK is not supported for OCI image format and will be ignored` — podman (crun, OCI) does not execute image healthchecks. The HEALTHCHECK stays in the Dockerfile (applies under real Docker in production); health was verified manually via `GET /api/health`.
- Restore step needs `chown -R 10001:10001` after unzip (files land root-owned; the runtime user is `nonroot` uid 10001). This was found by actually running the drill (portal exited with "attempt to write a readonly database") and is now part of the documented procedure.
- Image HEALTHCHECK uses busybox `wget` — no curl in alpine.
- Untestable in this environment (documented in deploy.md, not silently skipped): real **Let's Encrypt** TLS (no public DNS — the production variant is fully written out in the Caddyfile), **phone** form testing (M8/M9 scope anyway), real **S3** offsite upload (placeholders in portal.env.example; PB S3 settings are configured in `/_/` at deployment), and the nightly backup **cron timing** itself (backup triggered on demand via the superuser API; cron is set by migration 1795000103).
- Note for the reviewer: this worktree's branch is based on `m7-approved` (M8–M10 not merged here). M11 does not depend on their UI work; the image simply embeds whatever `ui/dist` the current branch builds. Tag `m11-impl` points at this milestone on `m11-work`. If this ordering is wrong per the milestone rules, flag it — deployment files are orthogonal and merge cleanly.

## Open questions for the reviewer

1. `depends_on` is on the `caddy` service (it needs `portal` as upstream). The milestone text lists `depends_on` under the portal service; functionally this ordering is the useful one (portal has no dependency). OK?
2. Rootless-port handling via `${HTTP_PORT:-80}`/`${HTTPS_PORT:-443}` in `compose.yaml` keeps the file production-default (80/443). Acceptable, or should the ports stay hard-coded and local testing use an override file?
3. Should `X-Frame-Options: DENY`/`Same-Origin` duplication (x-frame-options appears twice on proxied responses: once from Caddy, once with PB's own `SAMEORIGIN` on API routes) be harmonized (e.g. drop the Caddy header for API routes)? Out of M11 scope, no security impact (DENY same-origin vs SAMEORIGIN both fine here), left as-is.

## Acceptance command output

All commands were run in the worktree; `docker` delegates to podman/podman-compose. Env for the run: `caddy.env` with `WEG_SITE_ADDRESS=localhost`, basic-auth user `portal`, hash of throwaway password `m11-local-drill` (untracked, deleted after the drill).

### docker compose build

```
[3/3] STEP 10/10: CMD ["serve", "--http=0.0.0.0:8080"]
--> Using cache 1a9c76fe74c2bedee9160197709485bf08375e7dc6668df5c1df4510b0a8ef6d
[3/3] COMMIT weg-portal:latest
--> 1a9c76fe74c2
Successfully tagged localhost/weg-portal:latest
1a9c76fe74c2bedee9160197709485bf08375e7dc6668df5c1df4510b0a8ef6d
exit: 0
```

(first full build ran through all three stages: `npm ci` + `npm run build`, `go mod download` + `CGO_ENABLED=0 go build -trimpath -ldflags "-s -w"`, alpine runtime stage.)

### docker compose up -d + ps

```
weg-portal-m11_portal_1
weg-portal-m11_caddy_1

CONTAINER ID  IMAGE                             COMMAND               CREATED             STATUS             PORTS
65218f3f4fa9  localhost/weg-portal:latest       serve --http=0.0...   About a minute ago  Up About a minute  8080/tcp
4cd3d9e0cecb  docker.io/library/caddy:2-alpine  caddy run --confi...   About a minute ago  Up About a minute  0.0.0.0:8081->80/tcp, 0.0.0.0:8443->443/tcp, 2019/tcp, 443/udp
```

### curl checks (via Caddy, internal CA, `curl -k`)

```
=== SPA / ===
HTTP/2 200
content-security-policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://*.tile.openstreetmap.org data: blob:; connect-src 'self'; script-src 'self'; frame-ancestors 'none'
strict-transport-security: max-age=31536000; includeSubDomains
=== /_/ without auth ===
HTTP/2 401
www-authenticate: Basic realm="restricted"
=== /_/ with correct basic auth ===
HTTP/2 200
=== /_/ with wrong credentials ===
401
=== /api/health ===
{"message":"API is healthy.","code":200,"data":{}}
```

The served SPA is the real built UI ((`/@assets/index.js` returns the vite bundle, `cache-control` handling from portal.go) — not the placeholder `ui/dist/index.html`.

### Backup drill (all real runs)

```
docker compose exec portal /app/weg-portal superuser upsert admin1@weg-local.test 'Drill-Accept-1'
Successfully saved superuser "admin1@weg-local.test"!
docker compose exec portal /app/weg-portal superuser upsert admin2@weg-local.test 'Drill-Accept-2'
Successfully saved superuser "admin2@weg-local.test"!

# auth-with-password -> token (223 chars), then superuser creates a probe record:
POST /api/collections/events/records -> {"id":"7pm65dhh32nu7fx", "title":"M11 Backup-Drill Probeevent", ...}
# public (unauthenticated) read through Caddy:
GET /api/collections/events/records/7pm65dhh32nu7fx -> 7pm65dhh32nu7fx M11 Backup-Drill Probeevent

# backup via superuser API:
POST /api/backups {"name":"m11-drill.zip"} -> 204
GET  /api/backups -> [{"modified":"2026-11-13 12:35:11.172Z","key":"m11-drill.zip","size":15481}]

podman cp weg-portal-m11_portal_1:/app/pb_data/backups/m11-drill.zip /tmp/m11-drill.zip
unzip -l: data.db (245760 bytes), auxiliary.db (24576 bytes)

docker compose down                       # volume kept (no -v)
# wipe volume incl. dotfiles, restore from zip, chown to runtime uid:
podman run --rm -v weg-portal-m11_pb_data:/data -v /tmp/m11-drill.zip:/restore.zip \
    alpine:3.21 sh -c 'cd /data && rm -rf .[!.]* * && unzip -q /restore.zip && chown -R 10001:10001 /data'
docker compose up -d

# verification after restore, through Caddy:
GET /api/collections/events/records/7pm65dhh32nu7fx -> 7pm65dhh32nu7fx M11 Backup-Drill Probeevent
POST /api/collections/_superusers/auth-with-password (admin1) -> 200
```

First restore attempt WITHOUT chown failed (portal exited: `attempt to write a readonly database (8)` — root-owned data.db) — reproduced, fixed, documented in deploy.md.

### Teardown

```
docker compose down -v  (through podman-compose)
-> no containers, no volumes (weg-portal-m11_pb_data, caddy_data, caddy_config),
   no network (weg-portal-m11_default) left under the project name
/tmp artifacts deleted; worktree contains only the committed files
(untracked portal.env/caddy.env/.env are gitignored and stay local)
```
