# M8 handoff

## Done

- **Dependencies added** (`ui/package.json`, committed lockfile):
  `leaflet@^1.9.4`, `react-leaflet@^5.0.0`, `@types/leaflet` (dev).

- **`src/lib/exifStrip.ts`** (EXIF strip + downscale, unit-tested):
  - `cappedDimensions(w, h, maxEdge=2000)`: pure dimension math, longest
    edge capped at 2000 px, aspect ratio preserved, small photos left
    untouched.
  - `reencodePhoto(file)`: `createImageBitmap(file,
    {imageOrientation: "from-image"})` (plain `createImageBitmap` retry
    for engines without the option) → `OffscreenCanvas` (+ fallback to
    `canvas`/`toBlob`) → re-encoded **JPEG** (quality 0.9) at the capped
    dimensions. The original file NEVER leaves the browser: on any
    decode/encode failure the function **throws** (the photo is then not
    attached at all) — there is no fallback returning the input blob.
  - `hasExifApp1(bytes)`: JPEG segment walker that finds an Exif APP1
    segment in the header area (stops at SOS, so `0xFF 0xE1` inside
    entropy-coded data is not counted).

- **`src/lib/exifStrip.test.ts`** (12 vitest tests, node env): fixtures are
  **crafted byte arrays** (SOI + APP0/APP1/DQT/SOF0/SOS segments; the
  APP1 payload carries a minimal TIFF "II*\0" header), covering
  - EXIF APP1 detected in a crafted JPEG, APP1-without-Exif (XMP) NOT
    counted, entropy-data `0xFF 0xE1` NOT counted, PNG/garbage → false;
  - dimension math: 4000×3000 → 2000×1500, 3000×4000 → 1500×2000,
    ≤2000 untouched, cap never exceeded by rounding, aspect ratio
    preserved, invalid dimensions throw;
  - `reencodePhoto` with mocked `createImageBitmap`/`OffscreenCanvas`:
    canvas gets the capped dimensions, output ≠ input blob, output scanned
    by `hasExifApp1` → **no EXIF segment**, bitmap closed, decode failure
    rejects (never returns the original).

- **`src/lib/validation.ts`** additions (same style as M7):
  - `ISSUE_BOUNDS` = 51.0–51.5 / 7.0–7.5 — the backend defaults
    (hooks/submitIssue.go), `isWithinIssueBounds()`, `MAX_PHOTOS = 5`.
  - `issueSchema`: title 1–200 / description ≤5000 / category ≤100 /
    name ≤200 (issue_metas schema limit), lat/lng as **strings** that
    must parse to finite numbers inside the box (bounds incl.),
    email required, `photos: Blob[]` max 5, honeypot empty, and a
    `superRefine` that requires `photo_consent` **only when photos are
    attached** → error i18n key `validation.consentRequired`.
  - `buildIssueFormData(values, photoBlobs, formStartedAt)`:
    multipart/form-data payload for the custom route — exactly the
    contract of hooks/submitIssue.go (`title, description, category, lat,
    lng, email, name?, photo_consent` [only with photos], `photos[]`
    named `photo-<n>.jpg`, `honeypot`, `form_started_at` epoch ms);
    never any decision/exact-coordinate fields.
  - unit tests added to `validation.test.ts` (22 → 33 tests): schema
    happy/invalid cases, bounds incl. boundary values, photo count,
    consent coupling, honeypot, `isWithinIssueBounds`, and the payload
    builder (field names/values, omitted optional name, no consent
    without photos, no status/visibility/lat_exact).

- **`components/MapPicker.tsx`** (react-leaflet + leaflet, OSM tiles):
  - `TileLayer` with OSM attribution, `subdomains="abc"`
    (`https://{s}.tile.openstreetmap.org/...`, see deviations).
  - click-to-pin, draggable marker (inline-SVG `L.divIcon`, no image
    assets/requests), coordinates handed to the form as strings
    (6 decimals).
  - pan/zoom limited to the bounding box: `maxBounds` +
    `maxBoundsViscosity 1.0`, plus a `MinZoomBounds` child that sets
    `minZoom` to `map.getBoundsZoom(bounds)` on mount/resize, so the
    viewport can never be zoomed out past the whole community box.
  - "Use my location" via `navigator.geolocation` (permission-aware):
    denials/timeouts show a localized hint and fall back to tap-to-pin;
    a position **outside** the box is rejected with a localized hint
    (never silently clamped); an inside position sets the pin and flies
    the map there. `maximumAge: 0` (no stale cached fixes).

- **`components/PhotoInput.tsx`** (max 5, previews):
  - file input `accept="image/jpeg,image/png,image/webp"`, multiple;
    every file goes through `reencodePhoto` — only the re-encoded JPEG
    blob is kept (original never usable for upload); failed decodes show
    a localized note and are NOT attached.
  - previews via `URL.createObjectURL` (revoked on remove and on
    unmount in the page), grid of `aspect-ratio: 1` thumbs, per-photo
    remove button, localized "at most N photos" note when overflowing.

- **`pages/NewIssue.tsx`** (`/issues/new`, public): react-hook-form +
  zod (`issueSchema`), fields title/description/category/location/
  photos(+consent when photos are attached)/email/name(optional),
  hidden honeypot + `form_started_at` (epoch ms, `useRef(Date.now())`,
  refreshed on "Weitere Meldung") — all like NewSuggestion.
  - Submit uses **`fetch()` + `FormData`** (multipart/form-data; the
    PocketBase SDK create would send JSON — `pb` is not involved for
    this call).
  - Handling: 200 `{"ok":true}` → success panel ("Vielen Dank!" +
    "Weitere Meldung" / "Zum Kalender"); 400 → localized
    "issue.error.rejected" plus the server message in parentheses
    (English route text, M7 convention); 429 → localized rate-limit
    message; network/other → localized generic error.
- Route `issues/new` in `App.tsx`; nav link "Meldung" in `Layout.tsx`.
- **Locales**: `nav.newIssue`, `issue.*` (form, map/geolocation states,
  photos, consent, errors, success), `validation.locationRequired`,
  `validation.locationOutside`, `validation.maxPhotos`,
  `validation.consentRequired` — de/en, key-parity test still passes.
- **CSS** (`base.css`, tokens only, mobile-first): `.map-picker`/
  `.map-canvas` (280 px mobile, 400 px ≥900 px), attribution sizing,
  `.photo-input`/`.photo-thumbs` (auto-fill grid that fits 375 px),
  `.field-label`.

## Manual run-through (performed — headless Chromium at 375×812)

Throwaway instances (nothing in the repo touched beyond the build):

```sh
make build
rm -rf /tmp/weg-m8-pb && ./weg-portal serve --http 127.0.0.1:8092 --dir /tmp/weg-m8-pb
#        fresh DB -> migrations apply, LIMITS ACTIVE (5/10 min/IP)
rm -rf /tmp/weg-m8-pb2 && ./weg-portal serve --http 127.0.0.1:8093 --dir /tmp/weg-m8-pb2
#        second fresh DB for the direct rejection-path POSTs
# stop with: fuser -k 8092/tcp; fuser -k 8093/tcp
```

Driver: `playwright-core` (installed in `/tmp/weg-m7-e2e`, NOT in the
repo) + `/usr/bin/chromium`, script `/tmp/weg-m8-e2e/runthrough.js`
(geolocation overridden via the browser context). **26/26 checks PASS**:

1. `/issues/new` at 375 px: no horizontal scroll; nav link "Meldung"
   present; OSM attribution shown.
2. Empty form → zod errors under the fields, nothing sent.
3. Geolocation **outside** the box (Berlin coords): localized
   "außerhalb des Gemeinschaftsbereichs" hint, no pin.
4. Geolocation **inside** the box (51.248812, 7.212223): pin set,
   map flies there.
5. Map click moves the marker; a hard 2000 px pan keeps the tile layer
   alive inside the bounds.
6. A 3000×2000 JPEG crafted **with an EXIF APP1 segment** (canvas
   output + injected APP1, verified EXIF-positive before upload):
   preview renders; submit without consent → zod consent error
   (no server call); adding 6 more photos → only the free slots are
   taken, list capped at 5 with a localized "maximal 5" note.
7. After consent + time trap (≥3 s): submit → **success panel**; still
   no 375 px overflow. Server-side:
   - `sqlite3`: issue `pending`, title/category, `lat=51.25`,
     `lng=7.246` (3-decimal rounding of 51.249914/7.246165),
     `lat_exact`/`lng_exact` stored; `issue_metas` row with
     email + name;
   - photo stored under `pb_data/storage/.../issues/<id>/…`: `file`
     says JPEG 2000×1333 (downscaled from 3000×2000), and a byte scan
     of the **stored file** shows **no EXIF APP1 segment** — only the
     re-encoded blob ever left the browser (48 KB vs the tainted input).
8. "Weitere Meldung" resets the form; submitting within <3 s →
   server 400, UI shows localized rejection + "(Submission was too
   fast, please try again.)"; waiting and resubmitting works
   (2nd record created, verified via sqlite).
9. Language switch DE↔EN flips the page ("Report an issue").
10. Rate limit: after 5 requests, the next form submit shows the
    localized "Zu viele Einsendungen … (Too Many Requests.)".
11. Network log: the **only** third-party requests are
    `a|b|c.tile.openstreetmap.org` tiles (M8 review checklist item).

Direct rejection-path POSTs (fresh 2nd instance, node `fetch`):
`6 photos → 400 "At most 5 photos are allowed."`,
`photos without consent → 400 "Photo consent is required…"`,
`lat 51.6 → 400 "…inside the community area."`, `lng 6.9 → 400` —
exactly 1 record stored. (The Go suite in `api_submission_test.go`
covers these plus honeypot/time-trap/transactional cases; re-verified
live here because M8 UI relies on them.)

Out-of-bounds coordinate at **zod level**: the map's maxBounds makes
devtools-dragging out of the box impossible, so the UI check is the
`issueSchema` bounds refine (unit-tested incl. boundary values) plus
the geolocation-outside hint (live-tested).

## What remains to be tested on a real phone (cannot be done here)

- **iPhone HEIC**: with the `accept` list, iOS is expected to offer an
  automatic HEIC→JPEG conversion in the picker; on devices/flows where a
  HEIC file still comes through, `createImageBitmap` will fail to decode
  and the photo is **not** attached (localized note) — please verify
  which of the two happens on a real iPhone.
- iOS Safari canvas path: iOS <16.4 has no `OffscreenCanvas` → the code
  falls back to `canvas.toBlob`; verify re-encoding + previews work (and
  that orientation from the camera roll is baked correctly, i.e. photos
  do not come out rotated).
- Real GPS: permission prompt UX on Safari/Chrome mobile (this run used
  Chromium's geolocation override), accuracy/`enableHighAccuracy`
  behaviour outdoors, and cellular radios' time-to-fix vs the 10 s
  timeout.
- Touch drag of the marker + two-finger pinch/pan bounds behaviour on a
  real device (only mouse was available here); the 280 px map height on
  small phones (e.g. iPhone SE).
- Downscale performance on 48 MP phone photos (5 photos in a row) and
  that the re-encoded blobs stay well under the 5 MB server limit.
- Camera capture: directly shooting a photo (`capture` is deliberately
  NOT set on the input; the OS picker offers it).

## Not done / deviations from plan.md (with reason)

- **Tile URL uses `{s}` subdomains** (`a/b/c.tile.openstreetmap.org`):
  the served CSP allows `img-src https://*.tile.openstreetmap.org`,
  which (CSP wildcard semantics) does NOT match the bare
  `tile.openstreetmap.org` host — I verified those tile requests being
  blocked in the browser. Switching to OSM's official a/b/c subdomains is
  a UI-only fix that satisfies the existing CSP and avoids touching
  `portal.go` (backend changes are out of my scope; see open questions).
- **`dist/index.html`** restored to the committed state
  (`?v=<timestamp>` churns it on every build, M6 convention).
- **`getBoundsZoom` min-zoom clamp** is recomputed on container resize
  only — a mid-session orientation change re-clamps; bounds stay valid.
- The rejection-path POSTs above (6 photos/no consent/OOB) are additional
  verification; plan/go-test coverage existed since M3, nothing changed
  server-side.
- Out-of-bounds submission could not be produced through the UI (the map
  physically prevents it) — covered at zod level + server-level POST;
  a user tampering with the payload still hits the `issueBounds()` check.

## Open questions for the reviewer

1. **Bounding box config is duplicated** client (validation.ts
   `ISSUE_BOUNDS`) and server (hooks/submitIssue.go env-overridable
   defaults). If a deployment overrides the env vars, the UI silently
   mismatches (client zod/map allow the old box; the server rejects the
   new outside). Proposal to decide in/before **M11** (deployment):
   either (a) a public `GET /api/portal/config` returning the bounds
   (tiny, no sensitive data) that the UI fetches on form mount with the
   hardcoded values as fallback, or (b) build-time injection (baked into
   the bundle per deployment). I lean (a) — it also future-proofs other
   deployment-specific settings.
2. **CSP**: should `defaultCSP` in `portal.go` also allow the bare
   `https://tile.openstreetmap.org` (or switch the whitelist to
   `https://tile.openstreetmap.org https://*.tile.openstreetmap.org`)?
   Backend change — your call; the UI works with the a/b/c subdomains
   either way. Also worth noting for M12's Datenschutzerklärung: the tile
   server sees the visitors' IPs (OSM usage policy; production may want
   to review tile usage volume).
3. **Bug found in M7 code** (not fixed, out of M8 scope):
   `NewSuggestion`'s "Weiteren Termin vorschlagen" has the same latent
   bug I fixed in `NewIssue.resetForm` — it never resets the
   `submitted` flag, so the success panel stays and no new form
   appears. One-line fix (`setSubmitted(false)`); reproducing it in the
   M7 e2e is trivial. Request: apply as a small review fix.
4. The "6th submission → 429" call also confirmed (again) that rejected
   400s count against the rate-limit bucket (M7 handoff open question
   still stands; nothing changed client-side).

## Acceptance command output

```
$ cd ui && rm -rf node_modules && npm ci
(added 273 packages — npm warn install-scripts esbuild postinstall,
 platform binaries via optional deps; build works)
 
$ cd ui && npm test
 ✓ src/lib/ical.test.ts (2 tests)
 ✓ src/lib/exifStrip.test.ts (12 tests)        <- new
 ✓ src/lib/locales/locales.test.ts (2 tests)
 ✓ src/lib/validation.test.ts (33 tests)       <- +11 new
 ✓ src/lib/auth.test.ts (3 tests)
 ✓ src/lib/recurrence.test.ts (22 tests)

 Test Files  6 passed (6)
      Tests  74 passed (74)
   Duration  485ms

$ cd ui && npm run lint
> eslint .        (no output, exit 0)

$ cd ui && npm run build
> tsc --noEmit && vite build
✓ 172 modules transformed.
dist/index.html           0.52 kB
dist/@assets/index.css   32.01 kB
dist/@assets/index.js   701.10 kB
✓ built in 1.76s

$ make build
go build -o weg-portal ./base      (37.5 MB binary; GET / → 200 with CSP)

$ go vet ./... && go test ./... -count=1
ok  \tweg-portal\t1.921s        (backend untouched; role-matrix tests green)
?   weg-portal/base, fixturegen, hooks, migrations, ui   [no test files]
```

Plus the manual run-through above: 26/26 browser checks PASS against the
real binary (fresh DB, rate limits active), including a photo submission
whose stored file is EXIF-free, downscaled 2000×1333, with meta email
and pending status verified via sqlite3.
