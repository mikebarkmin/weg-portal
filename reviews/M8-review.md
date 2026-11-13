# M8 review — Issue reporting

**Verdict: approved.**

Reviewed `git diff b8cf574..cb7d54f` (the M8 commit on top of the m5+m7
merge), plan.md (Frontend, Files, Public submission routes), the M8
milestone section, `reviews/M8-handoff.md`, and the changed files
(`exifStrip.ts`, `PhotoInput.tsx`, `MapPicker.tsx`, `NewIssue.tsx`,
`validation.ts`, both test files, locales, `App.tsx`, `Layout.tsx`,
`base.css` against `../bugstage` conventions).

## Authorship check

- `git diff m7-approved..m8-impl --stat` **does include Go files** — but for
  a pre-existing topology reason, not M8 authorship: `m7-work` was branched
  from the post-M6 merge (55b062b) *in parallel* with the M5 line
  (f3b0428 → 43e6d66, tagged m5-approved). `m7-approved` therefore predates
  the M5 merge; the merge commit `b8cf574` (main) unites both lines.
  Nothing for the M8 implementer to fix; noted so future reviews use
  `git diff b8cf574..` (the merge base) for M8.
- The binding check is clean: `git diff b8cf574..cb7d54f --stat` shows
  exactly `ui/**` + `reviews/M8-handoff.md`; a path-limited diff over
  `*.go`/`go.mod`/`migrations/`/`hooks/`/`portal.go`/`test_pb_data/` is
  empty. **Backend untouched.**

## Acceptance commands (re-run by reviewer)

- `cd ui && npm ci` — ok (273 packages).
- `npm test` — 6 files, **74 passed (74)** (exifStrip 12, validation 33 new
  +11, locales parity 2).
- `npm run lint` — exit 0, no output.
- `npm run build` — `tsc --noEmit && vite build`, 172 modules, ok.
- `make build` — go build ok; `go vet ./...` clean; `go test ./... -count=1`
  — `ok weg-portal` (1.85 s), nothing else changed.

## Checklist

- [x] **Original file never uploaded.** `exifStrip.ts` has no path returning
  the input: `decodeBitmap` → `null` → throw (exifStrip.ts:105-108);
  `drawToJpeg` → `null`/error → throw (exifStrip.ts:121-123, 96-101);
  dimension ≤ 2000 is still re-encoded (only the scale factor is 1);
  isolated `createImageBitmap` retry (no `imageOrientation` support) still
  decodes into a canvas. `PhotoInput.addFiles` only pushes re-encoded blobs
  (PhotoInput.tsx:47-53) and drops failed decodes. `NewIssue.submit` uses
  only `photos.map(p => p.blob)` (NewIssue.tsx:113). **Verified
  empirically** — see below.
- [x] **EXIF really gone.** The unit test scans output (not input) bytes
  with `hasExifApp1`, but its mocked canvas returns an already-clean
  fixture — so the reviewer ran the real browser path: a genuinely EXIF
  **tainted** JPEG (real, chromium-canvas-encoded 3000×2000 JPEG + injected
  APP1 segment with TIFF IFD0 + GPS IFD: lat/long RATIONALEs, verified
  `hasExifApp1 == true` on the input) through
  `http://127.0.0.1:8094/issues/new` (fresh DB) in headless Chromium at
  375×812. The captured multipart POST body: photo part is 126 359 B
  (input 189 274 B), **no `Exif\0\0` magic anywhere in the body**, no
  APP1 in the output JPEG, re-encoded (canvas JFIF shape), downscaled to
  **2000×1333**. The **stored server file**
  (`pb_data/storage/.../photo_1_*.jpg`) byte-scanned: no APP1, 2000×1333,
  126 359 B. sqlite: issue `pending`, `lat/lng` rounded to 3 decimals
  (51.249/7.212 from 51.248812/7.212223), `lat_exact`/`lng_exact` stored,
  `issue_metas` email written. The GPS payload never persisted.
- [x] **Map tiles + attribution, no other third parties.** Network capture
  on `/issues/new` (full session): third-party hosts are exactly
  `a|b|c.tile.openstreetmap.org` (27 tile requests), same-origin
  (127.0.0.1:8094) for everything else, no empty-host/odd URLs, no CSP
  console violations, tiles load 200. Attribution
  "Leaflet | © OpenStreetMap contributors" rendered. Marker pin is inline
  SVG `L.divIcon` (MapPicker.tsx:26-35) — no image requests.
- [x] **CSP `{s}` subdomain claim — verified, correct decision.**
  `portal.go:41` serves
  `img-src 'self' https://*.tile.openstreetmap.org data: blob:`. Per CSP
  host-wildcard matching, `*.tile.openstreetmap.org` matches
  `a.tile.openstreetmap.org` but **not** the bare `tile.openstreetmap.org`.
  The UI's `subdomains="abc"` (MapPicker.tsx:107-110) therefore matches the
  existing CSP exactly, 0 violations in the live run.
  **Decision: the UI choice suffices; no `plan.md` or CSP change needed**
  (milestones.md M0 checklist still holds — it names the wildcard, which
  the UI now matches). Adding the bare host to `defaultCSP` is unnecessary
  backend churn; not requested from M9+.
- [x] **Form contract matches `hooks/submitIssue.go` exactly.** Live POST
  fields: `title, description, category, lat, lng, email, photo_consent,
  photos(photo-1.jpg), honeypot, form_started_at` — no `name` when empty
  (optional), no status/visibility/decision/exact fields.
  `photo_consent` only sent with photos (validation.ts:257-261) and server
  rejects photos without consent (submitIssue.go:131-133); zod
  superRefine enforces the same client-side (validation.ts:219-228) — live
  checked by the implementer, unit tests cover both directions.
  `form_started_at` is epoch ms, matching `validateTrap`'s
  `ParseInt`→`UnixMilli` comparison. 400 → localized
  `issue.error.rejected` + server message (M7 convention), 429 → localized
  `issue.error.rateLimited` (NewIssue.tsx:122-135); keys exist in de/en
  (parity test).

## Handoff open questions — answers

1. **Bounding box duplication (client/server):** real, but the defaults
   are consistent today and deployments without env overrides are correct.
   Decision: **defer to M11** (deployment milestone), where per-deployment
   config is in scope anyway; option (a) — a tiny public
   `GET /api/portal/config` with the bounds, UI fetches on form mount
   with the hardcoded values as fallback — is the right shape and
   future-proofs other deployment settings. The existing
   `TODO(M11)` markers in `validation.ts`/`MapPicker.tsx` and M11 tasks
   should pick this up; no M8 action, no plan.md change required
   (plan.md does not pin the mechanism).
2. **CSP bare host:** answered above — UI `{s}` subdomains suffice; keep
   the CSP as-is. The M12 Datenschutzerklärung must indeed name the OSM
   tile server (plan.md already lists it under "Data at rest / GDPR").
3. **M7 bug (`NewSuggestion.resetForm` not resetting `submitted`):**
   confirmed at `ui/src/pages/NewSuggestion.tsx:101` — clicking
   "Weiteren Termin vorschlagen" kept the success panel and never showed
   the form again. **Applied as an M8 review fix** (`setSubmitted(false)`,
   commit "M8: review fixes"), same code as `NewIssue.resetForm` already
   does (NewIssue.tsx:141-151).
4. **Rejected 400s counting against the rate-limit bucket:** noted, no
   client-side change possible or needed; consistent with the M7 decision.

## Findings

- **Fixed (review fixes, commit "M8: review fixes"):**
  - `ui/src/pages/NewSuggestion.tsx:101` — M7 latent bug above; now
    `setSubmitted(false)` on reset.
  - `ui/src/lib/exifStrip.test.ts` — comment typo ("acual" → "actual").
- **Minor, non-blocking (no change):** the submit button is not disabled
  while photo processing is in flight (`PhotoInput` busy state is local);
  a user racing the ~1 s re-encode submits without the photo they just
  selected. Worst case is a missing photo, never the original file
  (which is stripped in any case) — acceptable for M8; if the Beirat
  wants it, it is a one-prop change for M9 polish (pass `busy` up).
- **Pre-existing, for the record:** the M5/M7 parallel-branch topology
  (see Authorship) — caused the `m7-approved..m8-impl` diff noise; branch
  tags should sit on the merged main line in future milestones (or reviews
  should diff against the merge commit).

## Phone testing obligations (agreed, carried over)

The handoff's phone-test list (HEIC via iOS picker, iOS <16.4 canvas
`toBlob` fallback, real GPS prompts, touch drag/pinch bounds, 48 MP
performance, camera capture) is legitimate residual risk and must be
tracked by the Beirat on a real device; plan.md "test it" for HEIC stays
open until then. None of these can break the EXIF invariant (decode
failure → photo not attached), only UX/rotation.

## Review checklist ticks (milestones.md M8)

- [x] Original file never uploaded; only the re-encoded blob.
- [x] Map tiles + attribution correct; no other third-party requests.
- [x] Acceptance re-run green (npm ci/test/lint/build, make build,
      go test ./... -count=1).
- [x] Handoff open questions answered (above).

Result: `m8-approved` tagged on the branch tip (commit "M8: review",
which carries this file and sits on top of "M8: review fixes").
