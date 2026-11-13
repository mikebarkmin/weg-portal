package portal

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// Owner features (migration 1795000105): calendars, announcements,
// contacts, documents, issue history + notes, agenda topics, polls,
// "my submissions", the personal iCal feed and the opt-in mails.

func listCount(t *testing.T, mux http.Handler, url string, headers map[string]string) int {
	t.Helper()
	rec := doJSON(t, mux, http.MethodGet, url, "", headers)
	if rec.Code != 200 {
		t.Fatalf("%s: expected 200, got %d: %s", url, rec.Code, rec.Body.String())
	}
	var body struct {
		TotalItems int `json:"totalItems"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body.TotalItems
}

func TestOwnerVisibilityMatrix(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	mux := serveMux(t, app)

	identities := map[string]map[string]string{
		"guest":       nil,
		"unapproved":  authHeader(t, emailUnapproved),
		"resident":    authHeader(t, emailResident),
		"hausmeister": authHeader(t, emailHausmeister),
		"beirat":      authHeader(t, emailBeirat),
	}

	cases := []struct {
		url  string
		want map[string]int
	}{
		// public + not expired | + owners | beirat sees everything incl. expired
		{"/api/collections/announcements/records", map[string]int{"guest": 1, "unapproved": 1, "resident": 2, "hausmeister": 2, "beirat": 3}},
		{"/api/collections/contacts/records", map[string]int{"guest": 2, "unapproved": 2, "resident": 3, "hausmeister": 3, "beirat": 3}},
		{"/api/collections/documents/records", map[string]int{"guest": 1, "unapproved": 1, "resident": 2, "hausmeister": 2, "beirat": 2}},
		// own pending topic + accepted ones; beirat sees all
		{"/api/collections/agenda_items/records", map[string]int{"guest": 0, "unapproved": 0, "resident": 2, "hausmeister": 1, "beirat": 2}},
		{"/api/collections/polls/records", map[string]int{"guest": 0, "unapproved": 0, "resident": 1, "hausmeister": 1, "beirat": 1}},
		// only the own vote is ever listed
		{"/api/collections/poll_votes/records", map[string]int{"guest": 0, "unapproved": 0, "resident": 1, "hausmeister": 0, "beirat": 0}},
	}

	for _, c := range cases {
		for who, want := range c.want {
			if got := listCount(t, mux, c.url, identities[who]); got != want {
				t.Errorf("%s as %s: expected %d records, got %d", c.url, who, want, got)
			}
		}
	}
}

func TestDocumentFileAccess(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	mux := serveMux(t, app)

	fileOf := func(id string) string {
		r, err := app.FindRecordById("documents", id)
		if err != nil {
			t.Fatal(err)
		}
		return "/api/files/documents/" + id + "/" + r.GetString("file")
	}

	get := func(url string) int {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, url, nil))
		return rec.Code
	}

	if code := get(fileOf("docpublic000001")); code != 200 {
		t.Fatalf("public document without token: expected 200, got %d", code)
	}
	if code := get(fileOf("docowners000001")); code != 404 {
		t.Fatalf("owners document without token: expected 404, got %d", code)
	}
	if code := get(fileOf("docowners000001") + "?token=" + getFileToken(t, emailUnapproved)); code != 404 {
		t.Fatalf("owners document with an unapproved token: expected 404, got %d", code)
	}
	if code := get(fileOf("docowners000001") + "?token=" + getFileToken(t, emailResident)); code != 200 {
		t.Fatalf("owners document with an owner token: expected 200, got %d", code)
	}
}

func TestAnnouncementWrites(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "resident cannot create",
			Method:          http.MethodPost,
			URL:             "/api/collections/announcements/records",
			Body:            strings.NewReader(`{"title":"x","body":"y","visibility":"public","author":"userresident000"}`),
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "beirat cannot spoof the author",
			Method:          http.MethodPost,
			URL:             "/api/collections/announcements/records",
			Body:            strings.NewReader(`{"title":"x","body":"y","visibility":"public","author":"userresident000"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "beirat creates",
			Method:          http.MethodPost,
			URL:             "/api/collections/announcements/records",
			Body:            strings.NewReader(`{"title":"Neu","body":"Text","visibility":"owners","author":"userbeirat00000"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"title":"Neu"`},
		},
	}
	for _, s := range scenarios {
		s.Test(t)
	}
}

func TestIssueHistoryAndNotes(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	mux := serveMux(t, app)

	// a status change is recorded by the server with the acting account
	rec := doJSON(t, mux, http.MethodPatch, "/api/collections/issues/records/issueocom000001",
		`{"status":"in_progress"}`, authHeader(t, emailHausmeister))
	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	history, err := app.FindRecordsByFilter("issue_events", "issue = 'issueocom000001' && type = 'status'", "", 0, 0)
	if err != nil || len(history) != 1 {
		t.Fatalf("expected one status entry, got %d (%v)", len(history), err)
	}
	if h := history[0]; h.GetString("from_status") != "open" || h.GetString("to_status") != "in_progress" || h.GetString("actor") != "userhausmeister" {
		t.Fatalf("unexpected history entry: %v", h.PublicExport())
	}

	note := func(who, issue, body string) int {
		return doJSON(t, mux, http.MethodPost, "/api/collections/issue_events/records", body, authHeader(t, who)).Code
	}

	if code := note(emailHausverwaltung, "issueocom000001",
		`{"issue":"issueocom000001","type":"note","actor":"userhausverwalt","note":"Firma beauftragt"}`); code != 200 {
		t.Fatalf("staff note on an accepted issue: expected 200, got %d", code)
	}
	if code := note(emailHausmeister, "issuepcom000001",
		`{"issue":"issuepcom000001","type":"note","actor":"userhausmeister","note":"x"}`); code != 400 {
		t.Fatalf("staff note on a pending issue: expected 400, got %d", code)
	}
	if code := note(emailResident, "issueocom000001",
		`{"issue":"issueocom000001","type":"note","actor":"userresident000","note":"x"}`); code != 400 {
		t.Fatalf("resident note: expected 400, got %d", code)
	}
	if code := note(emailBeirat, "issueocom000001",
		`{"issue":"issueocom000001","type":"status","actor":"userbeirat00000","to_status":"resolved"}`); code != 400 {
		t.Fatalf("forged status entry: expected 400, got %d", code)
	}

	// residents never see the internal history
	if got := listCount(t, mux, "/api/collections/issue_events/records", authHeader(t, emailResident)); got != 0 {
		t.Fatalf("resident sees %d history entries", got)
	}
}

func TestAgendaWorkflow(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	mux := serveMux(t, app)

	create := func(who, body string) int {
		return doJSON(t, mux, http.MethodPost, "/api/collections/agenda_items/records", body, authHeader(t, who)).Code
	}
	if code := create(emailResident, `{"title":"Thema","author":"userresident000","status":"pending"}`); code != 200 {
		t.Fatalf("owner submits a topic: expected 200, got %d", code)
	}
	if code := create(emailResident, `{"title":"Thema","author":"userbeirat00000","status":"pending"}`); code != 400 {
		t.Fatalf("author spoof: expected 400, got %d", code)
	}
	if code := create(emailUnapproved, `{"title":"Thema","author":"userunapproved0","status":"pending"}`); code != 400 {
		t.Fatalf("unapproved account: expected 400, got %d", code)
	}
	if code := create(emailResident, `{"title":"Thema","author":"userresident000","status":"accepted"}`); code != 400 {
		t.Fatalf("self-accepted topic: expected 400, got %d", code)
	}

	rec := doJSON(t, mux, http.MethodPatch, "/api/collections/agenda_items/records/agendapending01",
		`{"status":"accepted","decision_note":"Kommt auf die TO"}`, authHeader(t, emailBeirat))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"decided_at":"2`) {
		t.Fatalf("accept: expected 200 with decided_at, got %d: %s", rec.Code, rec.Body.String())
	}
	waitTestMailerMails(t, app, 2, "beirat topic mail + agenda decision mail")
	mailMsg := findBySubject(t, app, "Ihr Thema für die Versammlung wurde angenommen")
	if to := toAddresses(mailMsg); len(to) != 1 || to[0] != emailResident {
		t.Fatalf("decision mail must go to the author only, got %v", to)
	}

	rec = doJSON(t, mux, http.MethodPatch, "/api/collections/agenda_items/records/agendapending01",
		`{"status":"pending"}`, authHeader(t, emailBeirat))
	if rec.Code != 400 {
		t.Fatalf("accepted -> pending: expected 400, got %d", rec.Code)
	}
}

func TestPolls(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	mux := serveMux(t, app)

	vote := func(who, user string, option int) int {
		return doJSON(t, mux, http.MethodPost, "/api/collections/poll_votes/records",
			fmt.Sprintf(`{"poll":"pollopen0000001","user":%q,"option":%d}`, user, option), authHeader(t, who)).Code
	}
	if code := vote(emailHausmeister, "userhausmeister", 5); code != 400 {
		t.Fatalf("unknown option: expected 400, got %d", code)
	}
	if code := vote(emailHausmeister, "userhausmeister", 0); code != 200 {
		t.Fatalf("valid vote: expected 200, got %d", code)
	}
	if code := vote(emailHausmeister, "userhausmeister", 1); code != 400 {
		t.Fatalf("second vote of the same account: expected 400, got %d", code)
	}
	if code := vote(emailResident, "userhausmeister", 0); code != 400 {
		t.Fatalf("vote in another name: expected 400, got %d", code)
	}

	rec := doJSON(t, mux, http.MethodGet, "/api/portal/polls/pollopen0000001/results", "", authHeader(t, emailResident))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"counts":[1,1]`) || !strings.Contains(rec.Body.String(), `"total":2`) {
		t.Fatalf("results: got %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(t, mux, http.MethodGet, "/api/portal/polls/pollopen0000001/results", "", nil); rec.Code != 404 {
		t.Fatalf("results for a guest: expected 404, got %d", rec.Code)
	}

	rec = doJSON(t, mux, http.MethodPatch, "/api/collections/polls/records/pollopen0000001",
		`{"options":["A","B","C"]}`, authHeader(t, emailBeirat))
	if rec.Code != 400 {
		t.Fatalf("changing options after votes: expected 400, got %d", rec.Code)
	}
	rec = doJSON(t, mux, http.MethodPost, "/api/collections/polls/records",
		`{"question":"?","options":["nur eine"],"created_by":"userbeirat00000"}`, authHeader(t, emailBeirat))
	if rec.Code != 400 {
		t.Fatalf("poll with one option: expected 400, got %d", rec.Code)
	}
}

func TestMySubmissionsAndSuggestionCalendar(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	mux := serveMux(t, app)

	if rec := doJSON(t, mux, http.MethodGet, "/api/portal/my-submissions", "", nil); rec.Code != 401 {
		t.Fatalf("guest: expected 401, got %d", rec.Code)
	}

	// a logged-in owner's issue report is linked to the account
	ct, body := multipartBody(t, validIssueFields(), nil)
	req := httptest.NewRequest(http.MethodPost, "/api/portal/issues", body)
	req.Header.Set("Content-Type", ct)
	req.Header.Set("Authorization", getAuthToken(t, "users", emailResident))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("submission: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// a logged-in suggestion cannot pick the calendar itself
	rec = doJSON(t, mux, http.MethodPost, "/api/collections/suggestions/records",
		`{"title":"Treffen","date_start":"2027-03-01 10:00:00.000Z","email":"o@example.com","status":"pending","honeypot":"","calendar":"beirat","form_started_at":`+fmt.Sprint(trapMS())+`}`,
		authHeader(t, emailResident))
	if rec.Code != 400 {
		t.Fatalf("suggestion with a calendar: expected 400, got %d", rec.Code)
	}
	rec = doJSON(t, mux, http.MethodPost, "/api/collections/suggestions/records",
		`{"title":"Treffen","date_start":"2027-03-01 10:00:00.000Z","email":"o@example.com","status":"pending","honeypot":"","form_started_at":`+fmt.Sprint(trapMS())+`}`,
		authHeader(t, emailResident))
	if rec.Code != 200 || strings.Contains(rec.Body.String(), "userresident000") {
		t.Fatalf("suggestion: expected 200 without the user link, got %d: %s", rec.Code, rec.Body.String())
	}
	var created struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)

	rec = doJSON(t, mux, http.MethodGet, "/api/portal/my-submissions", "", authHeader(t, emailResident))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), validIssueFields()["title"]) || !strings.Contains(rec.Body.String(), `"title":"Treffen"`) {
		t.Fatalf("my-submissions: got %d %s", rec.Code, rec.Body.String())
	}
	if other := doJSON(t, mux, http.MethodGet, "/api/portal/my-submissions", "", authHeader(t, emailHausmeister)); strings.Contains(other.Body.String(), "Treffen") {
		t.Fatal("another account must not see the submissions")
	}

	// the Beirat picks the calendar when accepting
	rec = doJSON(t, mux, http.MethodPatch, "/api/collections/suggestions/records/"+created.ID,
		`{"status":"accepted","calendar":"owners"}`, authHeader(t, emailBeirat))
	if rec.Code != 200 {
		t.Fatalf("accept: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	event, err := app.FindFirstRecordByData("events", "title", "Treffen")
	if err != nil || event.GetString("calendar") != "owners" {
		t.Fatalf("expected the event in the owners calendar, got %v (%v)", event, err)
	}
}

func TestPersonalCalendarFeed(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	mux := serveMux(t, app)

	if rec := doJSON(t, mux, http.MethodPost, "/api/portal/calendar-token", `{}`, nil); rec.Code != 401 {
		t.Fatalf("guest token: expected 401, got %d", rec.Code)
	}

	token := func(email string) string {
		rec := doJSON(t, mux, http.MethodPost, "/api/portal/calendar-token", `{}`, authHeader(t, email))
		var body struct {
			Token string `json:"token"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || len(body.Token) < 32 {
			t.Fatalf("token: %d %s", rec.Code, rec.Body.String())
		}
		return body.Token
	}
	feed := func(query string) string {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/portal/calendar.ics"+query, nil))
		return fmt.Sprint(rec.Code) + rec.Body.String()
	}

	public := feed("")
	if strings.Contains(public, "eventowners0001") || strings.Contains(public, "eventbeirat0001") {
		t.Fatal("the public feed must contain public events only")
	}

	resident := feed("?token=" + token(emailResident))
	if !strings.Contains(resident, "eventowners0001") || strings.Contains(resident, "eventbeirat0001") {
		t.Fatal("the owner feed must contain public + owners events")
	}
	if !strings.Contains(resident, "CLASS:PRIVATE") {
		t.Fatal("non-public events must be marked private")
	}

	beirat := token(emailBeirat)
	if !strings.Contains(feed("?token="+beirat), "eventbeirat0001") {
		t.Fatal("the Beirat feed must contain the Beirat calendar")
	}
	if only := feed("?token=" + beirat + "&calendar=beirat"); strings.Contains(only, "eventsimple0001") || !strings.Contains(only, "eventbeirat0001") {
		t.Fatal("calendar=beirat must narrow the feed")
	}

	if !strings.Contains(feed("?token="+token(emailUnapproved)), "200") || strings.Contains(feed("?token="+token(emailUnapproved)), "eventowners0001") {
		t.Fatal("an unapproved account gets the public calendar only")
	}
	if !strings.HasPrefix(feed("?token=nonsense"), "404") {
		t.Fatal("an unknown token must be rejected")
	}

	// renewing invalidates the old link
	old := token(emailResident)
	renewed := doJSON(t, mux, http.MethodPost, "/api/portal/calendar-token", `{"renew":true}`, authHeader(t, emailResident))
	if strings.Contains(renewed.Body.String(), old) || !strings.HasPrefix(feed("?token="+old), "404") {
		t.Fatal("renewing must replace the token")
	}
}

func TestOptInMails(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	mux := serveMux(t, app)

	// resident + beirat opt into announcements, only the resident into events
	for id, fields := range map[string]map[string]any{
		"userresident000": {"notify_announcements": true, "notify_events": true},
		"userbeirat00000": {"notify_announcements": true},
	} {
		u, err := app.FindRecordById("users", id)
		if err != nil {
			t.Fatal(err)
		}
		for k, v := range fields {
			u.Set(k, v)
		}
		if err := app.Save(u); err != nil {
			t.Fatal(err)
		}
	}

	rec := doJSON(t, mux, http.MethodPost, "/api/collections/announcements/records",
		`{"title":"Aufzug","body":"Wartung","visibility":"owners","author":"userbeirat00000"}`, authHeader(t, emailBeirat))
	if rec.Code != 200 {
		t.Fatalf("announcement: %d %s", rec.Code, rec.Body.String())
	}
	waitTestMailerMails(t, app, 2, "announcement mails")
	for _, m := range app.TestMailer.Messages() {
		if len(m.To) != 1 {
			t.Fatalf("each mail must have exactly one recipient, got %v", toAddresses(m))
		}
	}

	// a Beirat-calendar event is not mailed to the (opted-in) resident
	before := app.TestMailer.TotalSend()
	rec = doJSON(t, mux, http.MethodPost, "/api/collections/events/records",
		`{"title":"Intern","date_start":"2027-01-01 10:00:00.000Z","calendar":"beirat"}`, authHeader(t, emailBeirat))
	if rec.Code != 200 {
		t.Fatalf("event: %d %s", rec.Code, rec.Body.String())
	}
	if got := waitTestMailerIdle(app, "beirat event"); got != before {
		t.Fatalf("a Beirat event must not be mailed to owners, got %d new mails", got-before)
	}

	// an event without a calendar defaults to public and is mailed
	rec = doJSON(t, mux, http.MethodPost, "/api/collections/events/records",
		`{"title":"Fest","date_start":"2027-01-02 10:00:00.000Z"}`, authHeader(t, emailBeirat))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"calendar":"public"`) {
		t.Fatalf("event default calendar: %d %s", rec.Code, rec.Body.String())
	}
	waitTestMailerMails(t, app, before+1, "public event mail")
	m := findBySubject(t, app, "Neuer Termin: Fest")
	if to := toAddresses(m); len(to) != 1 || to[0] != emailResident {
		t.Fatalf("event mail recipients: %v", to)
	}
}

// Legal pages: public to read, editable by the Beirat only; the editor is
// recorded by the server and the slug cannot change.
func TestLegalPages(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	mux := serveMux(t, app)

	if got := listCount(t, mux, "/api/collections/legal_pages/records", nil); got != 2 {
		t.Fatalf("guests must read both legal pages, got %d", got)
	}

	page, err := app.FindFirstRecordByData("legal_pages", "slug", "impressum")
	if err != nil {
		t.Fatal(err)
	}
	if !page.GetBool("draft") || !strings.Contains(page.GetString("body"), "TODO(Beirat)") {
		t.Fatal("the seeded Impressum must be the marked draft")
	}
	url := "/api/collections/legal_pages/records/" + page.Id

	for _, who := range []string{emailResident, emailHausverwaltung} {
		if rec := doJSON(t, mux, http.MethodPatch, url, `{"body":"x"}`, authHeader(t, who)); rec.Code == 200 {
			t.Fatalf("%s must not edit the legal pages", who)
		}
	}
	// the update rule refuses it (PocketBase answers a failed update rule with 404)
	if rec := doJSON(t, mux, http.MethodPatch, url, `{"slug":"datenschutz"}`, authHeader(t, emailBeirat)); rec.Code < 400 {
		t.Fatalf("changing the slug must be refused, got %d", rec.Code)
	}

	rec := doJSON(t, mux, http.MethodPatch, url,
		`{"body":"## Angaben\n\nWEG Musterstraße 1","draft":false,"updated_by":"userresident000"}`, authHeader(t, emailBeirat))
	if rec.Code != 200 {
		t.Fatalf("beirat edit: %d %s", rec.Code, rec.Body.String())
	}
	page, _ = app.FindRecordById("legal_pages", page.Id)
	if page.GetString("updated_by") != "userbeirat00000" || page.GetBool("draft") || page.GetString("slug") != "impressum" {
		t.Fatalf("unexpected record after edit: %v", page.PublicExport())
	}

	for _, method := range []string{http.MethodPost, http.MethodDelete} {
		target := "/api/collections/legal_pages/records"
		if method == http.MethodDelete {
			target = url
		}
		if rec := doJSON(t, mux, method, target, `{"slug":"impressum"}`, authHeader(t, emailBeirat)); rec.Code < 400 {
			t.Fatalf("%s must be refused, got %d", method, rec.Code)
		}
	}

	rec = doJSON(t, mux, http.MethodGet, "/api/portal/retention", "", nil)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"retention_issues_resolved_days":365`) {
		t.Fatalf("retention: %d %s", rec.Code, rec.Body.String())
	}
}
