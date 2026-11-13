# M6 review

**Verdict: approved.**

Reviewed `git diff m3-impl..m6-impl` (everything outside `ui/` is only
`reviews/M6-handoff.md`), re-ran all acceptance commands myself, and verified
the 375 px claim live in headless Chromium against a throwaway `pb_data` with
seeded fixture events. No code fixes were needed, hence no
"M6: review fixes" commit.

## Acceptance re-run (reviewer)

```
cd ui && npm ci          → 264 packages installed
cd ui && npm test        → 3 files, 26 tests passed (ical, locales, recurrence)
cd ui && npm run lint    → exit 0, no output
cd ui && npm run build   → tsc --noEmit ok; vite: 103 modules, built in 1.15s
make build               → exit 0 (37 MB binary)
go test ./... -count=1   → ok weg-portal 1.415s (insurance; diff has no Go files)
```

Runtime smoke test: `./weg-portal serve --dir /tmp/weg-m6-review-pbdata --http
127.0.0.1:8097`:

- `GET /` → **200** with the embedded SPA; headers include
  `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' https://*.tile.openstreetmap.org data: blob:; connect-src 'self';
  script-src 'self'; frame-ancestors 'none'`,
  `X-Content-Type-Options: nosniff`, `Content-Type: text/html; charset=utf-8`.
- `/@assets/index.js`, `/@assets/index.css` → 200.
- `/api/collections/events/records` as guest → 200 (M1 rule `"").
- Server stopped by PID, `/tmp/weg-m6-review-pbdata` and all temp files deleted.

Seeded via the superuser API into the throwaway DB: a weekly `rrule` series
(`FREQ=WEEKLY;BYDAY=MO`, `date_start` 2025-06-02), a single all-day event
(2026-11-18), a single timed event (2026-11-25), and a multi-day event
(2026-11-29 → 2026-12-02).

### 375 px verification (headless Chromium, playwright-core 1.56.1 + /usr/bin/chromium)

| Check (viewport 375×812) | Result |
|---|---|
| `/` `documentElement.scrollWidth <= clientWidth` | 375 == 375 **OK** |
| Event detail page 375 px | 375 == 375 **OK** |
| Extreme 320 px | 320 == 320 **OK** |
| `prefers-color-scheme: dark` | tokens flip (body `rgb(23,23,23)` / `rgb(235,235,235)`) |
| German default | `html.lang=de`, month title `November 2026`, `Wöchentlicher (jeden Mo)` |
| EN switch | `November 2026`, `Current month`, `localStorage.weg-portal-lang=en` survives reload |
| Requests on calendar + detail page | host `127.0.0.1:8097` only (7 requests) — third-party free |

## Review checklist

- [x] **Recurring events that started before the visible range appear.**
  Unit tests pin it (`ui/src/lib/recurrence.test.ts:139-167`: weekly series from
  2025-06-02 expanded into Feb 2026; monthly from 2025-03-10; COUNT partly
  consumed before the range; UNTIL before the range). The loading strategy
  fetches `rrule != ''` events unfiltered (`ui/src/pages/PublicCalendar.tsx:74-77`)
  so the range can't hide a series. Live check: the series started 2025-06-02
  renders 5 Monday chips in Nov 2026 *and* in Dec 2026 after month navigation.
  Multi-day events appear on every covered day, including across the month
  boundary (Nov 29–Dec 2 event visible in both views, found via the
  `date_end >= start` branch).
- [x] **No hard-coded German strings outside `locales/`.**
  Grep over `ui/src` (excluding `src/locales`) for umlauts/ß and common German
  words: none. The `<title>WEG-Portal</title>` in `ui/index.html` is the brand
  name and is replaced with `t("app.title")` on mount
  (`ui/src/components/Layout.tsx:13-15`). The dynamic keys
  `t(\`lang.${lng}\`)` and `t(\`recurrence.${freq}\`)` resolve to keys that
  exist in both locale files (enforced by the key-parity test).
- [x] **Role is read from `pb.authStore.record`, never decoded from the JWT.**
  `ui/src/lib/pbClient.ts:10-15`: `currentUserRole()` reads
  `pb.authStore.record` directly; grep for `atob`/`jwt`/`decode` finds only the
  explanatory comment. No auth screens exist yet (per scope), so the helper is
  currently unused — nothing to regress from anyway, and the pattern matches
  plan.md.
- [x] **Calendar page is third-party free.**
  Network capture in headless Chromium: only requests to `127.0.0.1:8097`
  (document, assets, the one XHR to `events`). The served CSP allows exactly
  OSM tiles as the only non-self source (img-src, needed in M8); `connect-src
  'self'` structurally prevents third-party APIs even if a dependency tried.
- [x] **i18n de default + en.** `ui/src/lib/i18n.ts`: `defaultLanguage = "de"`,
  detection localStorage → navigator → de; verified live (German default,
  English switch + persistence).
- [x] **Calendar loading strategy: single filter acceptable.** Plan.md describes
  semantics ("range query for non-recurring + all `rrule` events"), not a
  specific number of HTTP requests. The single filter in
  `ui/src/pages/PublicCalendar.tsx:74-77` implements exactly those semantics in
  one request; expansion happens client-side in `lib/recurrence.ts` with 22 unit
  tests. Accepted.

## Findings (all minor, none blocking)

1. **Unused locale keys.** `nav.*` (whole section), `calendar.heading` and
   `calendar.retry` exist in `de.json`/`en.json` but no component uses them
   (grep over `t(...)` calls). Same category as the unused `EVENT_CATEGORIES`
   export the handoff already discloses: scaffold groundwork for M7+
   (nav links / retry button). The key-parity test keeps the two files honest.
   Nit — left in place deliberately.
2. **Day-span guard.** `ui/src/lib/recurrence.ts:192` caps the per-day indexing
   loop at 400 iterations, so a single (non-recurring) event spanning more than
   ~13 months would be silently clipped. Defensive cap against runaway spans;
   for the portal's event horizon this is fine. Note only.
3. **Month-boundary hour skew (root cause = the TZ open question).**
  `pbDateLiteral` (`ui/src/lib/dates.ts:18-29`) labels local month boundaries
  with a UTC literal, so an event at 00:30 CET on Dec 1 is fetched for the
  November view and its local day key places it there; December would not show
  it. Up to a one-hour skew at exactly one boundary per month, which follows
  directly from PocketBase's UTC storage and is subsumed by open question 1
  below. Also explains why the grid shows a Monday weekly series correctly:
  18:00 UTC is evening in Germany year-round, so no day flip — fine at these
  event times, would need revisiting only together with TZID support.
4. **Accepted deviations**, already justified in the handoff: `locales/` under
   `src/` (matches the plan's tree), `/events/:id/:day` detail route (needed for
   occurrence context), `tsc --noEmit` as part of `npm run build`, committed
   `ui/dist/index.html` replacing the placeholder (open question 3 below).
5. My acceptance rebuild churned the `?v=` timestamp in the committed
   `ui/dist/index.html`; restored to the committed state afterwards so the
   approval tag points at exactly the reviewed tree.

## Open questions submitted → decided

1. **Timezone semantics of recurrence expansion (DST/UTC) — decision for M5's
   iCal work:** keep **UTC wall-clock semantics** end-to-end and stay on them
   consistently. Storing and expanding naive/UTC times is the current behavior
   of DB, `lib/recurrence.ts` and (once it exists) must be of the M5 export:
   `hooks/ical.go` must emit `DTSTART`/`DTEND` in **UTC form (trailing `Z`)**,
   pass `RRULE` through unchanged (so `UNTIL` values also stay in `Z` form), and
   **not** emit `TZID` — otherwise external calendars display times that don't
   match the SPA. Consequence (accepted): a recurring occurrence shifts by 1 h
   in local wall time across a DST boundary (single/all-day events are
   unaffected; see also finding 3). Revisit only if M7+ event forms demand
   local-time semantics — and then as an end-to-end change (input, storage,
   export *and* client expansion), never client-only. Does not block M6.
2. **Fixed 6-week grid (42 cells):** accepted. Stable grid height, the quiet
   extra week in 5-week months is standard calendar behavior.
3. **Committed built `ui/dist/index.html`:** accepted as-is. Unhashed
   `@assets/index.js|css` names mean a rebuilt dist can never strand stale
   references, the `?v=` query busts the cache, and fresh clones fall back to
   the M0 placeholder mechanism (`make ui-build && make build` before first
   real deployment). No revert to the placeholder required.

## Result

No review fixes were necessary; the checklist is fully ticked. Approval tag:
`m6-approved` (tree clean on `m6-work`).
