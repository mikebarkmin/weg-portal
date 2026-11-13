# M6 handoff

## Done

- `ui/`: Vite 6 + React 19 + TypeScript scaffold (`package.json`,
  `package-lock.json`, `tsconfig.json`, `vite.config.ts`, ESLint flat config
  `eslint.config.js`, `npm run lint` passes; `npm run dev` available).
  Build conventions follow `../bugstage/ui/vite.config.js`: unhashed
  `@assets/index.js|css` + version query strings for cache busting
  (committed `dist/index.html` never references stale hashed names),
  `reportCompressedSize: false`, no `@` alias (relative imports are enough
  at this size).
- `src/lib/pbClient.ts`: PocketBase JS SDK (`^0.29.0`, same as BugStage)
  against same-origin (`window.location.origin`). Includes
  `currentUserRole()` helper with a comment: role must be read from
  `pb.authStore.record`, never decoded from the JWT.
- `src/lib/i18n.ts`: i18next + react-i18next, German default, en available,
  language detection from localStorage (`weg-portal-lang`) → navigator → de.
  All strings live in `src/locales/de.json` / `en.json`; a vitest test
  enforces key parity between both files. No German strings outside
  `locales/` (the only German hard-coded string is the `<title>` in
  `index.html`, which is replaced by `t("app.title")` on mount).
- `src/lib/recurrence.ts` (+ 22 vitest unit tests in
  `recurrence.test.ts`): `parsePBDate`, `parseRule` (RFC 5545 summary),
  `expandOccurrences`, `expandAll` (day-key index).
  - Calendar loading per plan.md: the calendar page queries non-recurring
    events by visible range **plus all events with `rrule != ''`** in one
    filter and expands recurrences client-side with the `rrule` package.
    A weekly series started 2025-06-02 appears in every month (unit test +
    browser smoke test with real data confirm).
  - Multi-day events appear on every covered day (clipped to the range);
    occurrence search looks back by the event duration so occurrences
    that start before the range but overlap it are found.
  - Malformed rules degrade to a single event instead of crashing the page.
- `src/lib/ical.ts`: `buildIcalUrl()` → `GET /api/portal/calendar.ics`
  against the current origin (route lands in M5; link is just a URL
  builder, unit tested). Linked as **iCal abonnieren** button in the
  calendar toolbar.
- `src/lib/dates.ts`: Intl-based localized date/time/month/weekday
  formatting (`i18n.language` as locale, de default).
- Design tokens `src/css/tokens.css` derived from
  `../bugstage/ui/src/css/vars.css` (trimmed to what the portal needs;
  primary/surface/info/success/warning/danger + alt/txt variants, accent
  set, input/border, selection, shadows, spacing, radii, font sizes).
  No component library — hand-rolled `src/css/base.css` (mobile-first,
  flex + CSS grid).
- Router (react-router-dom, `App.tsx`): `/` PublicCalendar,
  `/events/:id` and `/events/:id/:day` EventDetail, `/events` redirect,
  `*` NotFound. `Layout.tsx` (sticky header, title link, language switch)
  + `LangSwitch.tsx` component.
- `PublicCalendar`: month grid (Monday-first, 6 fixed weeks, weekday
  headers localized via Intl), prev/today/next navigation, event chips
  (max 2 + "+N weitere" per day cell), plus a month list below the grid
  for readability on phones. Loading/error/empty states via i18n.
- `EventDetail`: description, location, time (or "Ganztägig"), category,
  recurrence info (freq label, interval, BYDAY weekday names, COUNT,
  UNTIL, series hint, first occurrence). `:day` route param resolves the
  concrete occurrence (recurring or multi-day) clicked in the grid.
- `ui/public/favicon.svg` (self-hosted, CSP-compatible). Committed built
  output: `ui/dist/index.html` (references `/@assets/index.js|css?v=…`);
  the rest of `ui/dist/` stays gitignored per the existing
  `.gitignore` rules (`/ui/dist/*`, `!/ui/dist/index.html`,
  `/ui/node_modules/` already present — no new ignore rules needed).

### How to configure the token set / dark mode

- `:root` in `src/css/tokens.css` holds the light values; dark values are
  defined twice — once inside `@media (prefers-color-scheme: dark)` for
  `:root:not([data-color-scheme="light"])` (automatic) and once for
  `:root[data-color-scheme="dark"]` (manual override). This mirrors
  BugStage's `[data-color-scheme="dark"]` convention but additionally
  works with zero JS: automatic dark via the OS preference, forced light
  via `<html data-color-scheme="light">`, forced dark via
  `<html data-color-scheme="dark">`. Deliberately **no inline script**
  sets the attribute because the served CSP allows only
  `script-src 'self'` (no `unsafe-inline`). A theme **toggle** UI would
  be M9 territory (ProfileSettings) — the attribute hook is already
  there.
- Add/adjust tokens by editing `:root` (light) and both dark blocks
  (keep them in sync); components consume `var(--…)` like in BugStage.
- A theme is applied by CSS `color-scheme` per block, so scrollbars and
  form controls follow automatically.

### 375 px check (performed, not just described)

Manual description (for re-checking): build the UI, `make build`, start
the binary, open `http://localhost:8090/` in Chrome DevTools device mode
(iPhone, 375 px), verify `document.documentElement.scrollWidth <=
clientWidth` and that no element sticks out (calendar grid, toolbar with
wrapped buttons, event list, event detail).

I additionally automated this (temporary setup, not committed):
`playwright-core` + `/usr/bin/chromium` against a throwaway `pb_data` in
`/tmp` with one weekly `rrule` event (start 2025-06-02) and single events:

- viewport 375×812, `/`: `scrollWidth 375 == clientWidth 375` (home),
  calendar grid shows the weekly series on all Mondays, month list lists
  all occurrences;
- event detail at 375 px: `scrollWidth 375 == clientWidth 375`;
- extreme 320 px: `scrollWidth 320 == clientWidth 320`;
- `prefers-color-scheme: dark` emulation flips the tokens
  (body `rgb(235,235,235)` on `rgb(23,23,23)`); German default
  (`Monat, 2. November 2026`, `Wöchentlich (jeden Mo)`), title `WEG-Portal`.

## Not done / deviations from plan.md (with reason)

- **Locale directory**: `locales/` lives at `ui/src/locales/` (not
  `ui/locales/`) to match the plan.md frontend tree (`src/ … └── locales/`).
- **`EventDetail` route param**: plan.md's page list has no explicit
  detail route; recurring events need a day context, so I added
  `/events/:id/:day` (day optional, falls back to the base date).
- **Non-recurring range query** uses
  `(date_start <= end && (date_end >= start || date_start >= start))`
  in one PocketBase filter instead of two separate queries — one request,
  same semantics. An event that starts before the month and ends after it
  (rare multi-month event) would still be matched by `date_end >= start`.
- **`npm run build`** is `tsc --noEmit && vite build` (type check +
  build in one command, as required by the acceptance).
- No auth, forms, or other pages — scaffold only, per milestone scope.
- The unused `EVENT_CATEGORIES` export in `src/types.ts` is scaffold
  groundwork for M8/M9 category chips (can be removed if unwanted).

## Open questions for the reviewer

1. **Timezone semantics of recurrence expansion**: PocketBase stores UTC.
   The `rrule` package expands naive/UTC wall-clock times, so a weekly
   event keeps one *UTC* time-of-day — for German viewers the local time
   shifts by 1 h across a DST boundary (only for recurring occurrences;
   single events render correctly at all times). Proper handling needs a
   TZID (e.g. `Europe/Berlin`) end-to-end (admin input, storage, iCal
   export, expansion) — suggested to settle this in M7/M8 when forms
   exist. Not only a client concern: the M5 iCal export would have to
   emit `DTSTART;TZID=…` consistently.
2. **Fixed 6-week grid** (42 cells) keeps the layout stable; months that
   need 5 weeks show a quiet extra week. Acceptable?
3. The commit includes the **built `ui/dist/index.html`** referencing
  `/@assets/*` files that are gitignored — a fresh clone shows the page
  only after `make ui-build && make build` (same was true for the
  placeholder; I did NOT delete the placeholder mechanism, the built
  index.html replaces it). If you'd rather keep the old placeholder
  checked in and only ever serve the real assets locally/on CI, this
  file needs reverting to the placeholder (tell me and I'll redo the
  commit accordingly).

## Acceptance command output

```
$ cd ui && npm ci && npm run build && npm test
added 264 packages in 9s

> weg-portal-ui@0.1.0 build
> tsc --noEmit && vite build

vite v6.4.6 building for production...
✓ 103 modules transformed.
rendering chunks...
dist/index.html           0.52 kB
dist/@assets/index.css   12.59 kB
dist/@assets/index.js   413.08 kB
✓ built in 1.15s

 RUN  v3.2.7 /home/mike/.vibe/worktrees/weg-portal-m6/ui

 ✓ src/lib/ical.test.ts (2 tests) 2ms
 ✓ src/locales/locales.test.ts (2 tests) 4ms
 ✓ src/lib/recurrence.test.ts (22 tests) 13ms

 Test Files  3 passed (3)
      Tests  26 passed (26)
   Start at  12:22:00
   Duration  393ms

$ make build
go build -o weg-portal ./base
(binary 37 MB, serves the built SPA served from the embedded dist:
 GET / → 200 with Content-Security-Policy,
 GET /@assets/index.js → 200)

$ cd ui && npm run lint
(no output, exit 0)
```

Additional (not required, removes the risk of a claim-only 375 px check):
headless Chromium at 375×812 over `http://localhost:8097` with fixture
events: no horizontal overflow on `/` and `/events/:id/:day`
(`scrollWidth == clientWidth == 375`), recurring events started 2025
render in Nov 2026, dark mode flips the token palette.
