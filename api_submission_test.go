package portal

import (
	"bytes"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// M3: public submission tests (POST /api/portal/issues, suggestion traps,
// forced users role)

// tiny valid 1x1 px PNG (same bytes as in fixturegen)
var testPNG = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
	0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
	0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
	0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0, 0x00, 0x00, 0x00,
	0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
}

// trapMS returns a form_started_at value safely in the past.
func trapMS() int64 {
	return time.Now().Add(-10 * time.Second).UnixMilli()
}

type photoPart struct {
	name    string
	content []byte
}

// multipartBody builds a multipart/form-data body for the issue route.
func multipartBody(t testing.TB, fields map[string]string, photos []photoPart) (string, *bytes.Buffer) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)

	for k, v := range fields {
		if err := w.WriteField(k, v); err != nil {
			t.Fatal(err)
		}
	}
	for _, p := range photos {
		fw, err := w.CreateFormFile("photos", p.name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := fw.Write(p.content); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}

	return w.FormDataContentType(), &buf
}

func validIssueFields() map[string]string {
	return map[string]string{
		"title":           "Meldefall test",
		"description":     "Ein neuer Meldefall des Tests.",
		"category":        "test",
		"area":            "areahouse790000",
		"floor":           "2. OG",
		"email":           "newsubmitter@example.com",
		"photo_consent":   "true",
		"honeypot":        "",
		"form_started_at": fmt.Sprint(trapMS()),
	}
}

func TestSubmitIssueValidation(t *testing.T) {
	t.Parallel()

	build := func(tweaks func(map[string]string), photos []photoPart, contentType string) tests.ApiScenario {
		fields := validIssueFields()
		if tweaks != nil {
			tweaks(fields)
		}
		ct, body := multipartBody(t, fields, photos)
		if contentType != "" {
			ct = contentType
		}
		return tests.ApiScenario{
			Method:          http.MethodPost,
			URL:             "/api/portal/issues",
			Body:            body,
			Headers:         map[string]string{"Content-Type": ct},
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"ok":true`},
			NotExpectedContent: []string{
				"newsubmitter@example.com",
				`"record"`,
				`"id"`,
				`"email"`,
			},
		}
	}

	scenarios := []tests.ApiScenario{}

	// valid submissions
	sc := build(nil, nil, "")
	sc.Name = "valid without photos"
	scenarios = append(scenarios, sc)

	sc = build(nil, []photoPart{{name: "a.png", content: testPNG}, {name: "b.png", content: testPNG}}, "")
	sc.Name = "valid with photos and consent"
	scenarios = append(scenarios, sc)

	sc = build(func(f map[string]string) { delete(f, "area"); delete(f, "floor") }, nil, "")
	sc.Name = "valid without a location"
	scenarios = append(scenarios, sc)

	sc = build(func(f map[string]string) { delete(f, "email") }, nil, "")
	sc.Name = "logged-in user without an email field"
	sc.Headers["Authorization"] = getAuthToken(t, "users", emailResident)
	scenarios = append(scenarios, sc)

	// field validation failures -> 400
	failureScenarios := []struct {
		name   string
		tweaks func(map[string]string)
		photos func() []photoPart
	}{
		{"missing title", func(f map[string]string) { f["title"] = "" }, nil},
		{"title too long", func(f map[string]string) { f["title"] = strings.Repeat("x", 201) }, nil},
		{"description too long", func(f map[string]string) { f["description"] = strings.Repeat("x", 5001) }, nil},
		{"category too long", func(f map[string]string) { f["category"] = strings.Repeat("x", 101) }, nil},
		{"name too long", func(f map[string]string) { f["name"] = strings.Repeat("x", 201) }, nil},
		{"unknown area", func(f map[string]string) { f["area"] = "areamissing0000" }, nil},
		{"inactive area", func(f map[string]string) { f["area"] = "areainactive000"; delete(f, "floor") }, nil},
		{"unknown floor", func(f map[string]string) { f["floor"] = "9. OG" }, nil},
		{"floor in an area without floors", func(f map[string]string) { f["area"] = "areakeller00000" }, nil},
		{"floor without an area", func(f map[string]string) { delete(f, "area") }, nil},
		{"pin without an area", func(f map[string]string) { delete(f, "area"); delete(f, "floor"); f["x"] = "0.5"; f["y"] = "0.5" }, nil},
		{"pin from a guest", func(f map[string]string) {
			f["area"] = "areakeller00000"
			delete(f, "floor")
			f["x"] = "0.5"
			f["y"] = "0.5"
		}, nil},
		{"email invalid", func(f map[string]string) { f["email"] = "not-an-email" }, nil},
		{"email missing for guests", func(f map[string]string) { delete(f, "email") }, nil},
		{"honeypot filled", func(f map[string]string) { f["honeypot"] = "spam" }, nil},
		{"form_started_at missing", func(f map[string]string) { delete(f, "form_started_at") }, nil},
		{"form_started_at too recent", func(f map[string]string) { f["form_started_at"] = fmt.Sprint(time.Now().UnixMilli()) }, nil},
		{"photos without consent", func(f map[string]string) { f["photo_consent"] = "" }, func() []photoPart { return []photoPart{{name: "a.png", content: testPNG}} }},
		{"photo wrong mime (text)", nil, func() []photoPart { return []photoPart{{name: "note.txt", content: []byte("hello text")}} }},
		{"photo mime spoofing (png name, text content)", nil, func() []photoPart { return []photoPart{{name: "fake.png", content: []byte("hello text")}} }},
		{"photo too big", nil, func() []photoPart {
			return []photoPart{{name: "big.png", content: bytes.Repeat([]byte{0}, 6*1024*1024)}}
		}},
		{"too many photos", nil, func() []photoPart {
			return []photoPart{
				{name: "1.png", content: testPNG},
				{name: "2.png", content: testPNG},
				{name: "3.png", content: testPNG},
				{name: "4.png", content: testPNG},
				{name: "5.png", content: testPNG},
				{name: "6.png", content: testPNG},
			}
		}},
	}

	for _, fs := range failureScenarios {
		sc := build(fs.tweaks, nil, "")
		if fs.photos != nil {
			sc = build(fs.tweaks, fs.photos(), "")
		}
		sc.Name = fs.name
		sc.ExpectedStatus = 400
		sc.ExpectedContent = []string{`"status":400`}
		scenarios = append(scenarios, sc)
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

// serveMux builds a ready-to-serve mux for the test app instance, similar to
// what tests.ApiScenario does internally, so that multiple requests can be
// issued against the same application (needed for stateful flows).
func serveMux(t testing.TB, app *tests.TestApp) http.Handler {
	baseRouter, err := apis.NewRouter(app)
	if err != nil {
		t.Fatal(err)
	}

	serveEvent := new(core.ServeEvent)
	serveEvent.App = app
	serveEvent.Router = baseRouter

	var mux http.Handler

	err = app.OnServe().Trigger(serveEvent, func(e *core.ServeEvent) error {
		m, err := e.Router.BuildMux()
		mux = m
		return err
	})
	if err != nil {
		t.Fatal(err)
	}

	return mux
}

func doIssueSubmission(t testing.TB, mux http.Handler, fields map[string]string, photos []photoPart) *httptest.ResponseRecorder {
	ct, body := multipartBody(t, fields, photos)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/portal/issues", body)
	req.Header.Set("Content-Type", ct)
	mux.ServeHTTP(rec, req)

	return rec
}

func findIssuesByTitle(t testing.TB, app *tests.TestApp, title string) []*core.Record {
	records, err := app.FindAllRecords("issues")
	if err != nil {
		t.Fatal(err)
	}

	var filtered []*core.Record
	for _, r := range records {
		if r.GetString("title") == title {
			filtered = append(filtered, r)
		}
	}

	return filtered
}

// stateful M3 flow: valid submission, server-controlled values, transaction
// rollback, moderation visibility of the created record.
func TestSubmitIssuePersistence(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	mux := serveMux(t, app)

	// 1. valid submission with photo
	fields := validIssueFields()
	fields["name"] = "Max Mustermann"
	rec := doIssueSubmission(t, mux, fields, []photoPart{{name: "a.png", content: testPNG}})
	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != `{"ok":true}` {
		t.Fatalf("unexpected response body: %s", rec.Body.String())
	}

	issues := findIssuesByTitle(t, app, "Meldefall test")
	if len(issues) != 1 {
		t.Fatalf("expected exactly 1 created issue, got %d", len(issues))
	}

	issue := issues[0]

	// status/visibility are server-controlled, the location is its own record
	if issue.GetString("status") != "pending" {
		t.Fatalf("expected status pending, got %q", issue.GetString("status"))
	}
	if issue.GetString("visibility") != "" {
		t.Fatalf("expected empty visibility, got %q", issue.GetString("visibility"))
	}
	location, err := app.FindFirstRecordByData("issue_locations", "issue", issue.Id)
	if err != nil {
		t.Fatalf("expected a location record: %v", err)
	}
	if location.GetString("area") != "areahouse790000" || location.GetString("floor") != "2. OG" {
		t.Fatalf("unexpected location: %v", location.PublicExport())
	}
	if location.Id != issue.Id {
		t.Fatalf("the location must share the id of its issue, got %q", location.Id)
	}
	if location.GetBool("has_pin") || location.GetBool("shared") {
		t.Fatal("a new location has no pin here and is never shared with staff")
	}
	if len(issue.GetStringSlice("photos")) != 1 {
		t.Fatalf("expected 1 stored photo, got %v", issue.GetStringSlice("photos"))
	}

	// the meta record must exist with the submitter email
	metas, err := app.FindRecordsByFilter("issue_metas", "issue = {:id}", "", 0, 0, map[string]any{"id": issue.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(metas) != 1 {
		t.Fatalf("expected 1 issue_metas record, got %d", len(metas))
	}
	if metas[0].GetString("email") != "newsubmitter@example.com" {
		t.Fatalf("expected submitter email in meta, got %q", metas[0].GetString("email"))
	}
	if metas[0].GetString("name") != "Max Mustermann" {
		t.Fatalf("expected submitter name in meta, got %q", metas[0].GetString("name"))
	}

	// 2. spoofing attempt: client-supplied status/visibility/sharing must be ignored
	fields = validIssueFields()
	fields["title"] = "Spoof Versuch"
	fields["status"] = "open"
	fields["visibility"] = "community"
	fields["shared"] = "true"
	fields["id"] = "usercustom00001"
	rec = doIssueSubmission(t, mux, fields, nil)
	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	spoofed := findIssuesByTitle(t, app, "Spoof Versuch")
	if len(spoofed) != 1 {
		t.Fatalf("expected exactly 1 spoof-attempt issue, got %d", len(spoofed))
	}
	if spoofed[0].GetString("status") != "pending" {
		t.Fatalf("spoofed status must stay pending, got %q", spoofed[0].GetString("status"))
	}
	if spoofed[0].GetString("visibility") != "" {
		t.Fatalf("spoofed visibility must stay empty, got %q", spoofed[0].GetString("visibility"))
	}
	if spoofedLocation, err := app.FindFirstRecordByData("issue_locations", "issue", spoofed[0].Id); err != nil || spoofedLocation.GetBool("shared") {
		t.Fatalf("a client must not be able to share the location itself (%v)", err)
	}
	if spoofed[0].Id == "usercustom00001" {
		t.Fatal("client-supplied id must not be used")
	}

	// 3. transaction rollback: an overlong meta name fails ONLY at meta save
	// time (the route does not pre-validate it) and must leave no issue behind
	fields = validIssueFields()
	fields["title"] = "Rollback Fall"
	fields["name"] = strings.Repeat("x", 201)
	rec = doIssueSubmission(t, mux, fields, nil)
	if rec.Code != 400 {
		t.Fatalf("expected 400 for the invalid meta name, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(findIssuesByTitle(t, app, "Rollback Fall")) != 0 {
		t.Fatal("rollback failed: the issue from the failed transaction still exists")
	}
	if len(findIssuesByTitle(t, app, "Meldefall test")) != 1 {
		t.Fatal("rollback must not touch earlier submissions")
	}

	// 4. what was submitted cannot be read back by those who may not see it:
	// the new issues are pending -> guests and residents get nothing
	for _, tc := range []struct {
		token  string
		expect string
	}{
		{"", `"totalItems":0`},
		{getAuthToken(t, "users", emailResident), `"totalItems":3`},
		{getAuthToken(t, "users", emailBeirat), `"totalItems":13`},
	} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/collections/issues/records", nil)
		req.Header.Set("Content-Type", "application/json")
		if tc.token != "" {
			req.Header.Set("Authorization", tc.token)
		}
		mux.ServeHTTP(rec, req)
		if !strings.Contains(rec.Body.String(), tc.expect) {
			t.Fatalf("expected %s in issues list, got: %s", tc.expect, rec.Body.String())
		}
	}
}

// the rate limit rule "POST /api/portal/issues" (5/10min/IP) applies to the
// custom route; the fixture disables rate limits, this test enables them.
func TestSubmitIssueRateLimit(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	settings := app.Settings()
	settings.RateLimits.Enabled = true
	if err := app.Save(settings); err != nil {
		t.Fatal(err)
	}

	mux := serveMux(t, app)

	codes := []int{}
	for i := 0; i < 6; i++ {
		fields := validIssueFields()
		fields["title"] = fmt.Sprintf("Meldefall %d", i)
		rec := doIssueSubmission(t, mux, fields, nil)
		codes = append(codes, rec.Code)
	}

	for i, code := range codes {
		want := 200
		if i == 5 {
			want = 429
		}
		if code != want {
			t.Fatalf("request %d: expected %d, got %d (%v)", i, want, code, codes)
		}
	}
}

func TestSuggestionCreateTraps(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			// valid: trap present, email must NOT be echoed
			Name:               "valid with traps, no email echo",
			Method:             http.MethodPost,
			URL:                "/api/collections/suggestions/records",
			Body:               strings.NewReader(`{"title":"Neuer Vorschlag","date_start":"2027-03-01 10:00:00.000Z","email":"secret@example.com","status":"pending","honeypot":"","form_started_at":` + fmt.Sprint(trapMS()) + `}`),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     200,
			ExpectedContent:    []string{`"status":"pending"`},
			NotExpectedContent: []string{"secret@example.com"},
		},
		{
			Name:               "honeypot filled",
			Method:             http.MethodPost,
			URL:                "/api/collections/suggestions/records",
			Body:               strings.NewReader(`{"title":"Neuer Vorschlag","date_start":"2027-03-01 10:00:00.000Z","email":"secret@example.com","status":"pending","honeypot":"spam","form_started_at":` + fmt.Sprint(trapMS()) + `}`),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     400,
			ExpectedContent:    []string{`"status":400`},
			NotExpectedContent: []string{"secret@example.com"},
		},
		{
			// review fix: a non-string honeypot value (as a lazy bot would
			// send) must also be treated as a filled trap
			Name:               "honeypot as number is still a filled trap",
			Method:             http.MethodPost,
			URL:                "/api/collections/suggestions/records",
			Body:               strings.NewReader(`{"title":"Neuer Vorschlag","date_start":"2027-03-01 10:00:00.000Z","email":"secret@example.com","status":"pending","honeypot":123,"form_started_at":` + fmt.Sprint(trapMS()) + `}`),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     400,
			ExpectedContent:    []string{`"status":400`},
			NotExpectedContent: []string{"secret@example.com"},
		},
		{
			Name:            "form_started_at missing",
			Method:          http.MethodPost,
			URL:             "/api/collections/suggestions/records",
			Body:            strings.NewReader(`{"title":"Neuer Vorschlag","date_start":"2027-03-01 10:00:00.000Z","email":"secret@example.com","status":"pending","honeypot":""}`),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "form_started_at too recent",
			Method:          http.MethodPost,
			URL:             "/api/collections/suggestions/records",
			Body:            strings.NewReader(`{"title":"Neuer Vorschlag","date_start":"2027-03-01 10:00:00.000Z","email":"secret@example.com","status":"pending","honeypot":"","form_started_at":` + fmt.Sprint(time.Now().UnixMilli()) + `}`),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestUsersCreateForcesRole(t *testing.T) {
	t.Parallel()

	signup := func(role string) string {
		body := `{"email":"attacker@example.com","password":"` + fixturePassword + `","passwordConfirm":"` + fixturePassword + `","name":"Angreifer","approved":true,"verified":true`
		if role != "" {
			body += `,"role":"` + role + `"`
		}
		return body + `}`
	}

	scenarios := []tests.ApiScenario{
		{
			Name:               "guest with role beirat is forced to unapproved resident",
			Method:             http.MethodPost,
			URL:                "/api/collections/users/records",
			Body:               strings.NewReader(signup("beirat")),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     200,
			ExpectedContent:    []string{`"role":"resident"`, `"approved":false`},
			NotExpectedContent: []string{`"role":"beirat"`},
		},
		{
			Name:               "guest with role hausmeister is forced to resident",
			Method:             http.MethodPost,
			URL:                "/api/collections/users/records",
			Body:               strings.NewReader(signup("hausmeister")),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     200,
			ExpectedContent:    []string{`"role":"resident"`},
			NotExpectedContent: []string{`"role":"hausmeister"`},
		},
		{
			Name:               "resident trying to elevate via signup is forced back",
			Method:             http.MethodPost,
			URL:                "/api/collections/users/records",
			Body:               strings.NewReader(signup("beirat")),
			Headers:            authHeader(t, emailResident),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     200,
			ExpectedContent:    []string{`"role":"resident"`},
			NotExpectedContent: []string{`"role":"beirat"`},
		},
		{
			Name:               "beirat trying to elevate via signup is forced back",
			Method:             http.MethodPost,
			URL:                "/api/collections/users/records",
			Body:               strings.NewReader(signup("beirat")),
			Headers:            authHeader(t, emailBeirat),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     200,
			ExpectedContent:    []string{`"role":"resident"`},
			NotExpectedContent: []string{`"role":"beirat"`},
		},
		{
			Name:            "superuser can still create a beirat account",
			Method:          http.MethodPost,
			URL:             "/api/collections/users/records",
			Body:            strings.NewReader(`{"email":"newbeirat@example.com","password":"` + fixturePassword + `","passwordConfirm":"` + fixturePassword + `","role":"beirat","approved":true}`),
			Headers:         map[string]string{"Authorization": getAuthToken(t, "_superusers", superuserEmail)},
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"role":"beirat"`, `"approved":true`},
		},
		{
			Name:            "superuser-created hausmeister defaults to notify_new_issues",
			Method:          http.MethodPost,
			URL:             "/api/collections/users/records",
			Body:            strings.NewReader(`{"email":"newhm@example.com","password":"` + fixturePassword + `","passwordConfirm":"` + fixturePassword + `","role":"hausmeister","approved":true}`),
			Headers:         map[string]string{"Authorization": getAuthToken(t, "_superusers", superuserEmail)},
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"notify_new_issues":true`},
		},
		{
			Name:            "superuser-created hausmeister keeps an explicit notify=false",
			Method:          http.MethodPost,
			URL:             "/api/collections/users/records",
			Body:            strings.NewReader(`{"email":"newhm@example.com","password":"` + fixturePassword + `","passwordConfirm":"` + fixturePassword + `","role":"hausmeister","approved":true,"notify_new_issues":false}`),
			Headers:         map[string]string{"Authorization": getAuthToken(t, "_superusers", superuserEmail)},
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"notify_new_issues":false`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

// listStorageFiles returns all file paths under the test app's local storage.
func listStorageFiles(t testing.TB, app *tests.TestApp) map[string]bool {
	files := map[string]bool{}
	err := filepath.Walk(filepath.Join(app.DataDir(), "storage"), func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			files[strings.TrimPrefix(path, filepath.Join(app.DataDir(), "storage"))] = true
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}

// A submission whose transaction rolls back AFTER the issue (and its photos)
// was already saved must not leave orphaned photo files behind. PocketBase
// defers the file-field interceptor cleanup to the transaction completion
// (core/db.go registers it via txInfo.OnComplete), which this test pins down.
func TestSubmitIssueRollbackCleansFiles(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	mux := serveMux(t, app)

	before := listStorageFiles(t, app)

	// the 201-char meta name only fails at meta save time, i.e. after the
	// issue (with its photo) was saved inside the transaction
	fields := validIssueFields()
	fields["title"] = "Rollback Photos Fall"
	fields["name"] = strings.Repeat("x", 201)
	rec := doIssueSubmission(t, mux, fields, []photoPart{{name: "a.png", content: testPNG}})
	if rec.Code != 400 {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(findIssuesByTitle(t, app, "Rollback Photos Fall")) != 0 {
		t.Fatal("rollback failed: the issue from the failed transaction still exists")
	}

	after := listStorageFiles(t, app)

	if len(after) != len(before) {
		t.Fatalf("expected unchanged storage (%d files), got %d", len(before), len(after))
	}
	for path := range after {
		if !before[path] {
			t.Fatalf("orphaned file from the failed submission: %s", path)
		}
	}
}

// The M1 rate limit rule labeled "suggestions:create" must still cover the
// public suggestion create endpoint (the fixture disables rate limits,
// this test enables them; see also TestSubmitIssueRateLimit).
func TestSuggestionCreateRateLimit(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	settings := app.Settings()
	settings.RateLimits.Enabled = true
	if err := app.Save(settings); err != nil {
		t.Fatal(err)
	}

	mux := serveMux(t, app)

	codes := []int{}
	for i := 0; i < 6; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/collections/suggestions/records", strings.NewReader(
			`{"title":"RL Vorschlag `+fmt.Sprint(i)+`","date_start":"2027-03-01 10:00:00.000Z","email":"rl`+fmt.Sprint(i)+`@example.com","status":"pending","honeypot":"","form_started_at":`+fmt.Sprint(trapMS())+`}`,
		))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		codes = append(codes, rec.Code)
	}

	for i, code := range codes {
		want := 200
		if i == 5 {
			want = 429
		}
		if code != want {
			t.Fatalf("request %d: expected %d, got %d (%v)", i, want, code, codes)
		}
	}
}

// Logged-in submitters are not asked for an email or name: the account data is
// stored instead (also overriding a supplied one), and the map point of an
// issue report is optional.
func TestLoggedInSubmissionsUseAccountEmail(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	mux := serveMux(t, app)

	fields := validIssueFields()
	fields["title"] = "Ohne Ort und Mail"
	fields["email"] = "someone-else@example.com"
	delete(fields, "lat")
	delete(fields, "lng")
	ct, body := multipartBody(t, fields, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/portal/issues", body)
	req.Header.Set("Content-Type", ct)
	req.Header.Set("Authorization", getAuthToken(t, "users", emailResident))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("issue: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	issues := findIssuesByTitle(t, app, "Ohne Ort und Mail")
	if len(issues) != 1 {
		t.Fatalf("expected 1 issue, got %d", len(issues))
	}
	if issues[0].GetFloat("lat") != 0 || issues[0].GetFloat("lng") != 0 || issues[0].GetFloat("lat_exact") != 0 {
		t.Fatalf("expected no location, got %v/%v", issues[0].GetFloat("lat"), issues[0].GetFloat("lng"))
	}
	meta, err := app.FindFirstRecordByData("issue_metas", "issue", issues[0].Id)
	if err != nil {
		t.Fatal(err)
	}
	if meta.GetString("email") != emailResident {
		t.Fatalf("issue meta email: expected %q, got %q", emailResident, meta.GetString("email"))
	}
	resident, err := app.FindAuthRecordByEmail("users", emailResident)
	if err != nil {
		t.Fatal(err)
	}
	if meta.GetString("name") != resident.GetString("name") {
		t.Fatalf("issue meta name: expected the account name %q, got %q", resident.GetString("name"), meta.GetString("name"))
	}

	rec = doJSON(t, mux, http.MethodPost, "/api/collections/suggestions/records",
		`{"title":"Ohne Mail","date_start":"2027-03-01 10:00:00.000Z","status":"pending","honeypot":"","form_started_at":`+fmt.Sprint(trapMS())+`}`,
		authHeader(t, emailResident))
	if rec.Code != 200 {
		t.Fatalf("suggestion: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	suggestion, err := app.FindFirstRecordByData("suggestions", "title", "Ohne Mail")
	if err != nil {
		t.Fatal(err)
	}
	if suggestion.GetString("email") != emailResident {
		t.Fatalf("suggestion email: expected %q, got %q", emailResident, suggestion.GetString("email"))
	}
	if strings.Contains(rec.Body.String(), emailResident) {
		t.Fatal("the suggestion response must not echo the email")
	}

	// guests still need an email for suggestions
	rec = doJSON(t, mux, http.MethodPost, "/api/collections/suggestions/records",
		`{"title":"Gast ohne Mail","date_start":"2027-03-01 10:00:00.000Z","status":"pending","honeypot":"","form_started_at":`+fmt.Sprint(trapMS())+`}`, nil)
	if rec.Code != 400 {
		t.Fatalf("guest suggestion without email: expected 400, got %d", rec.Code)
	}
}
