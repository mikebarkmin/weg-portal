# WEG-Portal

Community portal for a German Wohnungseigentümergemeinschaft (WEG, owners'
association): a public event calendar, a moderated issue reporter with
locations on property plans and photos, and internal tools for the Beirat
(elected advisory board) — all in a single self-hosted binary.

## Features

- **Public calendar** usable by any resident without an account, with a form
  for suggesting entries that a Beirat member accepts or rejects; recurring
  events and an iCal feed.
- **Issue reporting**: public form for reporting community issues with a
  location inside the property (area, floor and a pin on a plan) and photo
  attachments; issues are moderated (pending → accepted/rejected) by the
  Beirat before becoming visible. The Beirat manages areas and plan images
  (`/bereiche`) and can share a location with Hausmeister/Hausverwaltung.
- **Issue board and internal notes** for the Beirat; accepted issues are
  read-only visible to logged-in community members.
- **Owner portal** with account data for logged-in submissions.
- **Role and account management** inside the app (`/admin`) — users, roles
  (`resident`, `beirat`, `hausmeister`, `hausverwaltung`, `admin`), approvals,
  password resets; the Beirat never needs the PocketBase admin UI.
- **Bilingual UI** (German default, English via i18next).
- **Editable legal pages** (privacy policy etc.).

## Stack & architecture

Single static Go binary, no Docker:

```
Caddy (TLS termination, HSTS)
  └── weg-portal (Go binary under systemd)
        ├── PocketBase core   API, auth, files, rate limits, backups (SQLite)
        ├── hooks/            Go hooks + custom routes (one file per concern)
        ├── migrations/       Go migrations (collections, rules, indexes)
        └── ui/dist           built React SPA, embedded via go:embed
```

- [PocketBase](https://pocketbase.io) **as a Go library** (SQLite backend,
  no JS frontend involved)
- React 19 SPA: Vite, TypeScript, react-router, react-hook-form + zod,
  Leaflet (self-hosted plan images, no external tile server)
- Mail templates in `hooks/templates/`, backups via PocketBase (local zip
  and optional S3 offsite)

## Repository layout

```
weg-portal/
├── portal.go          static SPA handler (CSP, cache headers) + hook registration
├── base/main.go       main(): flags, migrations, app.Start()
├── hooks/             one exported func per concern; templates/ = mail templates
├── migrations/        Go migrations; legal_defaults.go seeds legal texts
├── ui/                Vite + React app (ui/embed.go embeds dist/)
├── api_*_test.go      tests.ApiScenario tests against test_pb_data/
├── deploy/            Caddyfile, systemd unit, server-setup.sh, weg-portal-ctl
└── docs/              deploy.md, betriebshandbuch.md (German)
```

## Development

Requirements: Go, Node.js/npm.

```sh
cp portal.env.example portal.env   # set the portal time zone (PORTAL_TIMEZONE)
make run                           # dev server
make test                          # Go tests
make ui-build                      # build the React UI into ui/dist
make ui-test                       # UI unit tests (vitest)
make build                         # versioned production binary
```

On first start, superusers are created interactively — see `docs/deploy.md`
("Ersteinrichtung: Superuser anlegen").

## Deployment

Production runs as a hardened systemd service behind Caddy on Debian 12 /
Ubuntu 24.04, managed by `deploy/weg-portal-ctl` (deploy, backup, restore,
rollback). SMTP and S3 backup settings are maintained by a superuser in the
PocketBase admin UI (`/_/`), not via environment variables.

See `docs/deploy.md` (deployment, German) and `docs/betriebshandbuch.md`
(operations manual for the Beirat, German).

## License

[MIT](LICENSE)
