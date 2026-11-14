package portal

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// The location of an issue (issue_locations) and the selectable areas
// (issue_areas), see migrations/1795000112_issue_areas.go.
//
// Fixture: every issue has a location. Community issues are in "Haus 79"
// (floor "1. OG"), private ones in "Keller" with a pin. `shared` is set
// for the pending and the open issues. issueiprv000001 was reported by
// the resident account.

// Who may read a location: Beirat/admin all, the reporter their own,
// staff only shared ones of accepted issues, nobody else anything.
func TestIssueLocationsRead(t *testing.T) {
	t.Parallel()

	const url = "/api/collections/issue_locations/records"

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodGet,
			URL:             url,
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":0`},
		},
		{
			Name:            "unapproved account",
			Method:          http.MethodGet,
			URL:             url,
			Headers:         authHeader(t, emailUnapproved),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":0`},
		},
		{
			Name:               "resident: only the own report, with all fields",
			Method:             http.MethodGet,
			URL:                url,
			Headers:            authHeader(t, emailResident),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     200,
			ExpectedContent:    []string{`"totalItems":1`, `"issue":"issueiprv000001"`, `"area":"areakeller00000"`, `"has_pin":true`, `"x":0.25`, `"y":0.75`},
			NotExpectedContent: []string{`issueocom000001`, `areahouse790000`},
		},
		{
			Name:            "beirat: every location",
			Method:          http.MethodGet,
			URL:             url,
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":10`, `"issue":"issuepcom000001"`, `"floor":"1. OG"`, `"shared":true`},
		},
		{
			Name:            "admin: every location",
			Method:          http.MethodGet,
			URL:             url,
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":10`},
		},
		{
			// shared: both pending and both open issues - but pending
			// issues stay invisible to staff
			Name:               "hausmeister: only shared locations of accepted issues",
			Method:             http.MethodGet,
			URL:                url,
			Headers:            authHeader(t, emailHausmeister),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     200,
			ExpectedContent:    []string{`"totalItems":2`, `"issue":"issueocom000001"`, `"issue":"issueoprv000001"`},
			NotExpectedContent: []string{`issuepcom000001`, `issuepprv000001`, `issueicom000001`, `issuercom000001`},
		},
		{
			Name:               "hausverwaltung: the same",
			Method:             http.MethodGet,
			URL:                url,
			Headers:            authHeader(t, emailHausverwaltung),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     200,
			ExpectedContent:    []string{`"totalItems":2`},
			NotExpectedContent: []string{`issueicom000001`},
		},
		{
			Name:            "resident cannot view a foreign location",
			Method:          http.MethodGet,
			URL:             url + "/issueocom000001",
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "hausmeister cannot view an unshared location",
			Method:          http.MethodGet,
			URL:             url + "/issueicom000001",
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "nobody writes locations through the API (beirat)",
			Method:          http.MethodPatch,
			URL:             url + "/issueocom000001",
			Body:            strings.NewReader(`{"floor":"EG"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

// Side channels: a location must not be reachable by filtering, sorting or
// expanding through the issue it belongs to. PocketBase does not apply
// the rules of a related collection to filters, which is why every
// issue_locations field is Hidden.
func TestIssueLocationsProbing(t *testing.T) {
	t.Parallel()

	probe := func(name, email, query string) tests.ApiScenario {
		return tests.ApiScenario{
			Name:               name,
			Method:             http.MethodGet,
			URL:                "/api/collections/issues/records?" + query,
			Headers:            authHeader(t, email),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     400,
			ExpectedContent:    []string{`"status":400`},
			NotExpectedContent: []string{`issueocom000001`, `areahouse790000`},
		}
	}

	scenarios := []tests.ApiScenario{
		probe("resident filter by floor", emailResident, "filter="+urlEncode(`(issue_locations_via_issue.floor='1. OG')`)),
		probe("resident filter by area", emailResident, "filter="+urlEncode(`(issue_locations_via_issue.area='areahouse790000')`)),
		probe("resident filter by area name", emailResident, "filter="+urlEncode(`(issue_locations_via_issue.area.name='Haus 79')`)),
		probe("resident filter by pin", emailResident, "filter="+urlEncode(`(issue_locations_via_issue.x>0.1)`)),
		probe("resident filter by existence", emailResident, "filter="+urlEncode(`(issue_locations_via_issue.id!='')`)),
		probe("resident sort by pin", emailResident, "sort="+urlEncode(`issue_locations_via_issue.x`)),
		probe("hausmeister filter by the unshared floor", emailHausmeister, "filter="+urlEncode(`(issue_locations_via_issue.floor='1. OG')`)),
		{
			Name:               "resident expand yields no location",
			Method:             http.MethodGet,
			URL:                "/api/collections/issues/records?expand=issue_locations_via_issue",
			Headers:            authHeader(t, emailResident),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     200,
			ExpectedContent:    []string{`"totalItems":3`},
			NotExpectedContent: []string{`areahouse790000`, `"floor"`, `"has_pin"`},
		},
		{
			Name:               "hausmeister expand yields no unshared location",
			Method:             http.MethodGet,
			URL:                "/api/collections/issues/records/issueicom000001?expand=issue_locations_via_issue",
			Headers:            authHeader(t, emailHausmeister),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     200,
			NotExpectedContent: []string{`areahouse790000`, `"floor"`, `"has_pin"`},
		},
		{
			Name:            "resident cannot filter the own locations by hidden fields either",
			Method:          http.MethodGet,
			URL:             "/api/collections/issue_locations/records?filter=" + urlEncode(`(floor='1. OG')`),
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

// The Beirat shares a location with staff per issue and can revoke it.
func TestIssueLocationShare(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	mux := serveMux(t, app)

	const route = "/api/portal/issues/issueicom000001/location-share"
	const view = "/api/collections/issue_locations/records/issueicom000001"

	for name, tc := range map[string]struct {
		headers map[string]string
		want    int
	}{
		"guest":          {nil, 401},
		"resident":       {authHeader(t, emailResident), 403},
		"hausmeister":    {authHeader(t, emailHausmeister), 403},
		"hausverwaltung": {authHeader(t, emailHausverwaltung), 403},
		"unapproved":     {authHeader(t, emailUnapproved), 403},
	} {
		if rec := doJSON(t, mux, http.MethodPost, route, `{"shared":true}`, tc.headers); rec.Code != tc.want {
			t.Fatalf("%s: expected %d, got %d: %s", name, tc.want, rec.Code, rec.Body.String())
		}
	}
	if rec := doJSON(t, mux, http.MethodGet, view, "", authHeader(t, emailHausmeister)); rec.Code != 404 {
		t.Fatalf("still unshared: expected 404, got %d", rec.Code)
	}

	if rec := doJSON(t, mux, http.MethodPost, route, `{}`, authHeader(t, emailBeirat)); rec.Code != 400 {
		t.Fatalf("missing flag: expected 400, got %d", rec.Code)
	}
	if rec := doJSON(t, mux, http.MethodPost, "/api/portal/issues/missing00000000/location-share", `{"shared":true}`, authHeader(t, emailBeirat)); rec.Code != 404 {
		t.Fatalf("unknown issue: expected 404, got %d", rec.Code)
	}

	if rec := doJSON(t, mux, http.MethodPost, route, `{"shared":true}`, authHeader(t, emailBeirat)); rec.Code != 200 {
		t.Fatalf("beirat share: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	rec := doJSON(t, mux, http.MethodGet, view, "", authHeader(t, emailHausmeister))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"area":"areahouse790000"`) {
		t.Fatalf("shared: expected the location, got %d: %s", rec.Code, rec.Body.String())
	}
	// sharing with staff never opens it to other owners
	if rec := doJSON(t, mux, http.MethodGet, view, "", authHeader(t, emailResident)); rec.Code != 404 {
		t.Fatalf("resident after sharing: expected 404, got %d", rec.Code)
	}

	// an admin has the Beirat rights and revokes it again
	if rec := doJSON(t, mux, http.MethodPost, route, `{"shared":false}`, authHeader(t, emailAdmin)); rec.Code != 200 {
		t.Fatalf("admin revoke: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(t, mux, http.MethodGet, view, "", authHeader(t, emailHausmeister)); rec.Code != 404 {
		t.Fatalf("revoked: expected 404, got %d", rec.Code)
	}
}

// GET /api/portal/issue-areas: names and floors for everyone (the report
// form is public), the plan file name only for approved accounts.
func TestIssueAreasRoute(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	mux := serveMux(t, app)

	const route = "/api/portal/issue-areas"

	guest := doJSON(t, mux, http.MethodGet, route, "", nil)
	if guest.Code != 200 {
		t.Fatalf("guest: expected 200, got %d", guest.Code)
	}
	for _, want := range []string{`"name":"Haus 79"`, `"floors":["EG","1. OG","2. OG"]`, `"name":"Keller"`, `"has_plan":true`, `"active":false`} {
		if !strings.Contains(guest.Body.String(), want) {
			t.Fatalf("guest: missing %s in %s", want, guest.Body.String())
		}
	}
	if strings.Contains(guest.Body.String(), `"plan"`) {
		t.Fatalf("guest must not get the plan file name: %s", guest.Body.String())
	}
	if rec := doJSON(t, mux, http.MethodGet, route, "", authHeader(t, emailUnapproved)); strings.Contains(rec.Body.String(), `"plan"`) {
		t.Fatal("an unapproved account must not get the plan file name")
	}

	resident := doJSON(t, mux, http.MethodGet, route, "", authHeader(t, emailResident))
	if !strings.Contains(resident.Body.String(), `"plan":"`+fixturePlanName(t)+`"`) {
		t.Fatalf("resident: expected the plan file name, got %s", resident.Body.String())
	}
}

func fixturePlanName(t testing.TB) string {
	app := setupTestApp(t)
	defer app.Cleanup()

	area, err := app.FindRecordById("issue_areas", "areakeller00000")
	if err != nil || area.GetString("plan") == "" {
		t.Fatalf("fixture area without a plan: %v", err)
	}

	return area.GetString("plan")
}

// The areas are managed by the Beirat; the plan is a protected file for
// approved accounts.
func TestIssueAreasCollection(t *testing.T) {
	t.Parallel()

	const url = "/api/collections/issue_areas/records"
	planURL := "/api/files/issue_areas/areakeller00000/" + fixturePlanName(t)

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest lists nothing",
			Method:          http.MethodGet,
			URL:             url,
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":0`},
		},
		{
			Name:            "unapproved account lists nothing",
			Method:          http.MethodGet,
			URL:             url,
			Headers:         authHeader(t, emailUnapproved),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":0`},
		},
		{
			Name:            "resident lists the areas",
			Method:          http.MethodGet,
			URL:             url,
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":3`},
		},
		{
			Name:            "resident cannot create an area",
			Method:          http.MethodPost,
			URL:             url,
			Body:            strings.NewReader(`{"name":"Haus 81","active":true}`),
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "hausmeister cannot change an area",
			Method:          http.MethodPatch,
			URL:             url + "/areahouse790000",
			Body:            strings.NewReader(`{"name":"Umbenannt"}`),
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "beirat creates a house with floors (trimmed)",
			Method:          http.MethodPost,
			URL:             url,
			Body:            strings.NewReader(`{"name":" Haus 81 ","floors":["EG"," 1. OG "],"active":true,"sort":5}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"name":"Haus 81"`, `"floors":["EG","1. OG"]`},
		},
		{
			Name:            "admin creates an area without floors",
			Method:          http.MethodPost,
			URL:             url,
			Body:            strings.NewReader(`{"name":"Außenanlage","active":true}`),
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"floors":[]`},
		},
		{
			Name:            "floors must be a list of distinct labels",
			Method:          http.MethodPost,
			URL:             url,
			Body:            strings.NewReader(`{"name":"Haus 83","floors":["EG","EG"],"active":true}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "floors must be strings",
			Method:          http.MethodPatch,
			URL:             url + "/areahouse790000",
			Body:            strings.NewReader(`{"floors":{"a":1}}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "an area with reports cannot be deleted",
			Method:          http.MethodDelete,
			URL:             url + "/areahouse790000",
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:           "an unused area can be deleted",
			Method:         http.MethodDelete,
			URL:            url + "/areainactive000",
			Headers:        authHeader(t, emailBeirat),
			TestAppFactory: setupTestApp,
			ExpectedStatus: 204,
		},
		// ---- protected plan --------------------------------------------
		{
			Name:            "plan: guest without token",
			Method:          http.MethodGet,
			URL:             planURL,
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "plan: unapproved account's file token",
			Method:          http.MethodGet,
			URL:             planURL + "?token=" + getFileToken(t, emailUnapproved),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "plan: resident's file token",
			Method:          http.MethodGet,
			URL:             planURL + "?token=" + getFileToken(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{"\x89PNG"},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

// A pin needs an approved account and an area with a plan.
func TestSubmitIssuePin(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	mux := serveMux(t, app)

	submit := func(title string, tweak func(map[string]string), email string) *httptest.ResponseRecorder {
		fields := validIssueFields()
		fields["title"] = title
		fields["area"] = "areakeller00000"
		delete(fields, "floor")
		fields["x"] = "0.4"
		fields["y"] = "0.6"
		if tweak != nil {
			tweak(fields)
		}
		ct, body := multipartBody(t, fields, nil)
		req := httptest.NewRequest(http.MethodPost, "/api/portal/issues", body)
		req.Header.Set("Content-Type", ct)
		if email != "" {
			req.Header.Set("Authorization", getAuthToken(t, "users", email))
		}
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec
	}

	for name, tc := range map[string]struct {
		tweak func(map[string]string)
		email string
	}{
		"guest":             {nil, ""},
		"unapproved":        {nil, emailUnapproved},
		"area without plan": {func(f map[string]string) { f["area"] = "areahouse790000" }, emailResident},
		"x only":            {func(f map[string]string) { delete(f, "y") }, emailResident},
		"x out of range":    {func(f map[string]string) { f["x"] = "1.01" }, emailResident},
		"y negative":        {func(f map[string]string) { f["y"] = "-0.1" }, emailResident},
		"x NaN":             {func(f map[string]string) { f["x"] = "NaN" }, emailResident},
		"y infinite":        {func(f map[string]string) { f["y"] = "Inf" }, emailResident},
		"x not a number":    {func(f map[string]string) { f["x"] = "abc" }, emailResident},
	} {
		if rec := submit("Pin "+name, tc.tweak, tc.email); rec.Code != 400 {
			t.Fatalf("%s: expected 400, got %d: %s", name, rec.Code, rec.Body.String())
		}
		if len(findIssuesByTitle(t, app, "Pin "+name)) != 0 {
			t.Fatalf("%s: the rejected report must not be stored", name)
		}
	}

	if rec := submit("Pin gesetzt", nil, emailResident); rec.Code != 200 {
		t.Fatalf("resident pin: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	issues := findIssuesByTitle(t, app, "Pin gesetzt")
	if len(issues) != 1 {
		t.Fatalf("expected the report, got %d", len(issues))
	}
	location, err := app.FindFirstRecordByData("issue_locations", "issue", issues[0].Id)
	if err != nil {
		t.Fatal(err)
	}
	if !location.GetBool("has_pin") || location.GetFloat("x") != 0.4 || location.GetFloat("y") != 0.6 || location.GetBool("shared") {
		t.Fatalf("unexpected location: %v", location.PublicExport())
	}

	// the reporter sees it under "Meine Einreichungen" ...
	mine := doJSON(t, mux, http.MethodGet, "/api/portal/my-submissions", "", authHeader(t, emailResident))
	for _, want := range []string{`"area_name":"Keller"`, `"has_pin":true`, `"x":0.4`} {
		if !strings.Contains(mine.Body.String(), want) {
			t.Fatalf("my-submissions: missing %s in %s", want, mine.Body.String())
		}
	}
	// ... and nobody else's submissions carry it
	if other := doJSON(t, mux, http.MethodGet, "/api/portal/my-submissions", "", authHeader(t, emailHausmeister)); strings.Contains(other.Body.String(), "area_name") {
		t.Fatalf("another account must not see the location: %s", other.Body.String())
	}
}

// Notification mails never carry a location.
func TestIssueMailTemplatesWithoutLocation(t *testing.T) {
	for _, name := range []string{"beirat_new_issue.html", "staff_new_issue.html", "issue_submitter.html"} {
		source, err := os.ReadFile("hooks/templates/" + name)
		if err != nil {
			t.Fatal(err)
		}
		raw := string(source)
		for _, banned := range []string{"Position", ".Lat", ".Lng", "Area", "Floor", "Etage"} {
			if strings.Contains(raw, banned) {
				t.Errorf("%s must not mention %q", name, banned)
			}
		}
	}
}
