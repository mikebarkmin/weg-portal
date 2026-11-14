package portal

import (
	"encoding/json"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"weg-portal/hooks"
	"weg-portal/ui"
)

// Regression tests for the post-M12 review fixes.

// GET /api/portal/config returns the app version and time zone - and no
// longer a map bounding box (the OpenStreetMap location is gone).
func TestPortalConfig(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	rec := doJSON(t, serveMux(t, app), http.MethodGet, "/api/portal/config", "", nil)
	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var body struct {
		Version  string `json:"version"`
		Timezone string `json:"timezone"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	// the app version for the SPA footer ("dev" outside release builds)
	if body.Version != "dev" {
		t.Fatalf("expected version %q, got %q", "dev", body.Version)
	}
	if body.Timezone == "" || strings.Contains(rec.Body.String(), "bounds") {
		t.Fatalf("unexpected config: %s", rec.Body.String())
	}
}

// All-day values written by the old SPA (local midnight converted to UTC,
// i.e. 23:00Z of the previous day in Germany) must still export the
// intended calendar date; new values are stored as UTC midnight.
func TestICalendarAllDayDates(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	events, err := app.FindCollectionByNameOrId("events")
	if err != nil {
		t.Fatal(err)
	}

	for id, start := range map[string]string{
		"alldaylegacy001": "2026-12-23 23:00:00.000Z", // legacy CET midnight
		"alldaysummer001": "2026-07-03 22:00:00.000Z", // legacy CEST midnight
		"alldaycurrent01": "2026-12-24 00:00:00.000Z", // current format
	} {
		r := core.NewRecord(events)
		r.Id = id
		r.Set("title", id)
		r.Set("date_start", start)
		r.Set("date_end", start)
		r.Set("all_day", true)
		r.Set("calendar", "public")
		if err := app.Save(r); err != nil {
			t.Fatal(err)
		}
	}

	rec := doJSON(t, serveMux(t, app), http.MethodGet, "/api/portal/calendar.ics", "", nil)
	unfolded := unfoldICal(rec.Body.String())

	for id, want := range map[string][]string{
		"alldaylegacy001": {"DTSTART;VALUE=DATE:20261224", "DTEND;VALUE=DATE:20261225"},
		"alldaysummer001": {"DTSTART;VALUE=DATE:20260704", "DTEND;VALUE=DATE:20260705"},
		"alldaycurrent01": {"DTSTART;VALUE=DATE:20261224", "DTEND;VALUE=DATE:20261225"},
	} {
		block := strings.Join(icalVEvent(unfolded, id+"@weg-portal.test"), "\n")
		for _, line := range want {
			if !strings.Contains(block, line) {
				t.Fatalf("%s: expected %q in\n%s", id, line, block)
			}
		}
	}
}

// The UID domain follows the configured application URL.
func TestICalendarUIDDomainFromAppURL(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	app.Settings().Meta.AppURL = "https://portal.example.org"

	rec := doJSON(t, serveMux(t, app), http.MethodGet, "/api/portal/calendar.ics", "", nil)
	if !strings.Contains(rec.Body.String(), "UID:eventsimple0001@portal.example.org\r\n") {
		t.Fatalf("expected the UID domain from the app URL, got:\n%s", rec.Body.String())
	}
}

// Mail links must be absolute (relative links do not resolve in mail
// clients) and point at the place where the recipient acts.
func TestMailLinksAbsolute(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	app.Settings().Meta.AppURL = "https://portal.example.org/"

	rec := doJSON(t, serveMux(t, app), http.MethodPatch, "/api/collections/issues/records/issuepcom000001",
		`{"status":"open","visibility":"community"}`, authHeader(t, emailBeirat))
	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	waitTestMailerMails(t, app, 2, "submitter + staff mails")

	staff := findBySubject(t, app, "Angenommene Meldung: Defekte Laterne")
	if !strings.Contains(staff.HTML, `href="https://portal.example.org/issues/issuepcom000001"`) {
		t.Fatalf("expected an absolute issue link in the staff mail, got:\n%s", staff.HTML)
	}

	submitter := findBySubject(t, app, "Ihre Meldung im WEG-Portal wurde angenommen")
	if strings.Contains(submitter.HTML, `href="/"`) {
		t.Fatalf("submitter mail still contains a relative link:\n%s", submitter.HTML)
	}
}

// A note's author cannot be re-attributed through an update.
func TestNotesAuthorImmutable(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	rec := doJSON(t, serveMux(t, app), http.MethodPatch, "/api/collections/notes/records/notesnormal0001",
		`{"author":"userresident000","title":"umbenannt"}`, authHeader(t, emailBeirat))
	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	note, err := app.FindRecordById("notes", "notesnormal0001")
	if err != nil {
		t.Fatal(err)
	}
	if note.GetString("title") != "umbenannt" {
		t.Fatal("expected the title update to be applied")
	}
	if got := note.GetString("author"); got != "userbeirat00000" {
		t.Fatalf("expected the author to stay userbeirat00000, got %q", got)
	}
}

// Built, content-hashed assets are cached immutably; the SPA entry point
// is never cached.
func TestStaticCacheHeaders(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	mux := serveMux(t, app)

	// a built asset (only present after `npm run build`)
	assets, _ := fs.ReadDir(ui.DistDirFS, "@assets")

	want := map[string]string{
		"/":       "no-store",
		"/issues": "no-store",
	}
	if _, err := fs.Stat(ui.DistDirFS, "@static/fonts/remixicon/remixicon.woff2"); err == nil {
		want["/@static/fonts/remixicon/remixicon.woff2"] = "max-age=604800, stale-while-revalidate=86400"
	}
	if len(assets) > 0 {
		want["/@assets/"+assets[0].Name()] = "public, max-age=31536000, immutable"
	}

	for path, want := range want {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		_, _ = io.Copy(io.Discard, rec.Body)

		if got := rec.Header().Get("Cache-Control"); got != want {
			t.Fatalf("%s: expected Cache-Control %q, got %q", path, want, got)
		}
	}

	// a missing asset is a 404, not the (then immutably cached) index.html
	req := httptest.NewRequest(http.MethodGet, "/@assets/missing-abc123.js", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for a missing asset, got %d", rec.Code)
	}
}

// Recurring timed events repeat at the same LOCAL time in the portal time
// zone: exported with DTSTART;TZID=... and a matching VTIMEZONE.
func TestICalendarRecurringTimedUsesTZID(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	events, err := app.FindCollectionByNameOrId("events")
	if err != nil {
		t.Fatal(err)
	}

	r := core.NewRecord(events)
	r.Id = "zonedweekly0001"
	r.Set("title", "Gartenrunde")
	r.Set("date_start", "2026-10-20 16:30:00.000Z") // 18:30 CEST
	r.Set("date_end", "2026-10-20 17:30:00.000Z")
	r.Set("rrule", "FREQ=WEEKLY;COUNT=4")
	r.Set("calendar", "public")
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}

	rec := doJSON(t, serveMux(t, app), http.MethodGet, "/api/portal/calendar.ics", "", nil)
	body := rec.Body.String()
	unfolded := unfoldICal(body)

	block := strings.Join(icalVEvent(unfolded, "zonedweekly0001@weg-portal.test"), "\n")
	for _, line := range []string{
		"DTSTART;TZID=Europe/Berlin:20261020T183000",
		"DTEND;TZID=Europe/Berlin:20261020T193000",
		"RRULE:FREQ=WEEKLY;COUNT=4",
	} {
		if !strings.Contains(block, line) {
			t.Fatalf("expected %q in\n%s", line, block)
		}
	}

	// single timed events stay plain UTC
	if simple := strings.Join(icalVEvent(unfolded, "eventsimple0001@weg-portal.test"), "\n"); !strings.Contains(simple, "DTSTART:20261201T180000Z") {
		t.Fatalf("single timed event changed:\n%s", simple)
	}

	all := strings.Join(unfolded, "\n")
	for _, want := range []string{
		"BEGIN:VTIMEZONE\nTZID:Europe/Berlin",
		// end of DST 2026: 03:00 CEST -> 02:00 CET
		"BEGIN:STANDARD\nDTSTART:20261025T030000\nTZOFFSETFROM:+0200\nTZOFFSETTO:+0100\nTZNAME:CET\nEND:STANDARD",
		// start of DST 2027: 02:00 CET -> 03:00 CEST
		"BEGIN:DAYLIGHT\nDTSTART:20270328T020000\nTZOFFSETFROM:+0100\nTZOFFSETTO:+0200\nTZNAME:CEST\nEND:DAYLIGHT",
	} {
		if !strings.Contains(all, want) {
			t.Fatalf("expected VTIMEZONE part\n%s\nin\n%s", want, all)
		}
	}
	if strings.Index(all, "END:VTIMEZONE") > strings.Index(all, "BEGIN:VEVENT") {
		t.Fatal("the VTIMEZONE must precede the events")
	}
}

// Without recurring timed events there is no VTIMEZONE (nothing references it).
func TestICalendarNoVTimezoneWithoutZonedEvents(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	rec := doJSON(t, serveMux(t, app), http.MethodGet, "/api/portal/calendar.ics", "", nil)
	if strings.Contains(rec.Body.String(), "VTIMEZONE") {
		t.Fatal("unexpected VTIMEZONE in a calendar without recurring timed events")
	}
}

func TestPortalConfigTimezone(t *testing.T) {
	t.Setenv("PORTAL_TIMEZONE", "Europe/Vienna")

	app := setupTestApp(t)
	defer app.Cleanup()

	rec := doJSON(t, serveMux(t, app), http.MethodGet, "/api/portal/config", "", nil)
	if !strings.Contains(rec.Body.String(), `"timezone":"Europe/Vienna"`) {
		t.Fatalf("expected the configured zone, got %s", rec.Body.String())
	}
}

func TestPortalTimezoneValidation(t *testing.T) {
	for _, bad := range []string{"Mars/Olympus", "Local"} {
		t.Setenv("PORTAL_TIMEZONE", bad)
		if _, _, err := hooks.PortalLocationForTest(); err == nil {
			t.Fatalf("expected PORTAL_TIMEZONE=%q to be rejected", bad)
		}
	}

	t.Setenv("PORTAL_TIMEZONE", "")
	if _, name, err := hooks.PortalLocationForTest(); err != nil || name != "Europe/Berlin" {
		t.Fatalf("expected the Europe/Berlin default, got %q (%v)", name, err)
	}
}
