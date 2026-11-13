package portal

import (
	"net/http"
	"strings"
	"testing"
)

// Regression tests for the security review findings.

// An unapproved (but verified) account can opt into announcement mails on
// its own record; it must only ever be mailed PUBLIC announcements.
func TestAnnouncementMailRespectsVisibility(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	mux := serveMux(t, app)

	unapproved, err := app.FindAuthRecordByEmail("users", emailUnapproved)
	if err != nil {
		t.Fatal(err)
	}
	if !unapproved.Verified() || unapproved.GetBool("approved") {
		t.Fatal("fixture: the unapproved user must be verified and not approved")
	}

	rec := doJSON(t, mux, http.MethodPatch, "/api/collections/users/records/"+unapproved.Id,
		`{"notify_announcements":true}`, authHeader(t, emailUnapproved))
	if rec.Code != 200 {
		t.Fatalf("self opt-in: %d %s", rec.Code, rec.Body.String())
	}

	rec = doJSON(t, mux, http.MethodPost, "/api/collections/announcements/records",
		`{"title":"Intern","body":"nur Eigentuemer","visibility":"owners","author":"userbeirat00000"}`, authHeader(t, emailBeirat))
	if rec.Code != 200 {
		t.Fatalf("owners announcement: %d %s", rec.Code, rec.Body.String())
	}
	if got := waitTestMailerIdle(app, "owners announcement"); got != 0 {
		t.Fatalf("an owners announcement must not be mailed to an unapproved account: %s", mailSummary(app.TestMailer.Messages()))
	}

	rec = doJSON(t, mux, http.MethodPost, "/api/collections/announcements/records",
		`{"title":"Offen","body":"fuer alle","visibility":"public","author":"userbeirat00000"}`, authHeader(t, emailBeirat))
	if rec.Code != 200 {
		t.Fatalf("public announcement: %d %s", rec.Code, rec.Body.String())
	}
	waitTestMailerMails(t, app, 1, "public announcement mail")
	if to := toAddresses(app.TestMailer.Messages()[0]); len(to) != 1 || to[0] != emailUnapproved {
		t.Fatalf("unexpected recipients: %v", to)
	}
}

// The users update rule lets the Beirat set approved/verified; admin
// accounts are exempt, so the Beirat cannot lock the admins out.
func TestBeiratCannotChangeAdminAccounts(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	mux := serveMux(t, app)

	for _, body := range []string{`{"approved":false}`, `{"verified":false}`, `{"notify_events":true}`} {
		rec := doJSON(t, mux, http.MethodPatch, "/api/collections/users/records/useradmin000000", body, authHeader(t, emailBeirat))
		if rec.Code != 403 {
			t.Fatalf("beirat %s on an admin: expected 403, got %d %s", body, rec.Code, rec.Body.String())
		}
	}

	admin, err := app.FindRecordById("users", "useradmin000000")
	if err != nil {
		t.Fatal(err)
	}
	if !admin.GetBool("approved") || !admin.Verified() {
		t.Fatal("the admin account must be unchanged")
	}

	// still allowed: the Beirat approval of other accounts and the admin's
	// own profile settings
	rec := doJSON(t, mux, http.MethodPatch, "/api/collections/users/records/userunapproved0", `{"approved":true}`, authHeader(t, emailBeirat))
	if rec.Code != 200 {
		t.Fatalf("beirat approval: %d %s", rec.Code, rec.Body.String())
	}
	rec = doJSON(t, mux, http.MethodPatch, "/api/collections/users/records/useradmin000000", `{"notify_events":true}`, authHeader(t, emailAdmin))
	if rec.Code != 200 {
		t.Fatalf("admin own profile: %d %s", rec.Code, rec.Body.String())
	}
}

// A recurrence rule with a line break would inject content lines into the
// iCal feed.
func TestEventRRuleLineBreaksRejected(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	mux := serveMux(t, app)

	rec := doJSON(t, mux, http.MethodPost, "/api/collections/events/records",
		`{"title":"Inject","date_start":"2030-01-01 10:00:00.000Z","calendar":"public","rrule":"FREQ=DAILY\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:x"}`,
		authHeader(t, emailBeirat))
	if rec.Code != 400 {
		t.Fatalf("create: expected 400, got %d %s", rec.Code, rec.Body.String())
	}

	rec = doJSON(t, mux, http.MethodPost, "/api/collections/events/records",
		`{"title":"Fine","date_start":"2030-01-01 10:00:00.000Z","calendar":"public","rrule":"FREQ=DAILY;COUNT=2"}`,
		authHeader(t, emailBeirat))
	if rec.Code != 200 {
		t.Fatalf("valid rrule: %d %s", rec.Code, rec.Body.String())
	}

	// a record written past the hooks is exported without its rule
	events, err := app.FindRecordsByFilter("events", "title = 'Fine'", "", 1, 0)
	if err != nil || len(events) != 1 {
		t.Fatalf("event lookup: %v", err)
	}
	events[0].Set("rrule", "FREQ=DAILY\nSUMMARY:injected")
	if err := app.Save(events[0]); err != nil {
		t.Fatal(err)
	}
	rec = doJSON(t, mux, http.MethodGet, "/api/portal/calendar.ics", "", nil)
	if rec.Code != 200 || strings.Contains(rec.Body.String(), "SUMMARY:injected") {
		t.Fatalf("the feed must not contain the injected line: %d", rec.Code)
	}
}

// Behind Caddy every request comes from 127.0.0.1: the rate limits need
// the forwarded client address (migration 1795000110).
func TestTrustedProxyHeaderConfigured(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	proxy := app.Settings().TrustedProxy
	if len(proxy.Headers) != 1 || proxy.Headers[0] != "X-Forwarded-For" || proxy.UseLeftmostIP {
		t.Fatalf("unexpected trusted proxy settings: %+v", proxy)
	}
}
