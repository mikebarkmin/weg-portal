package portal

import (
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// issues role-matrix tests (read rule, enrich-unhidden exact coords,
// staff update whitelist). See plan.md "Issue read rule" and "Issue update rule".
//
// Fixture recap (see test_pb_data/README.md):
//   - issuepcom000001: pending + community   (beirat only)
//   - issuepprv000001: pending + private     (beirat only)
//   - issueocom000001: open + community       (all approved)
//   - issueoprv000001: open + private         (beirat + staff)
//   - issueicom000001: in_progress + community
//   - issueiprv000001: in_progress + private
//   - issuercom000001: resolved + community
//   - issuerprv000001: resolved + private
//   - issuejcom000001: rejected + community   (beirat + staff)
//   - issuejprv000001: rejected + private
//
// The location of an issue is a separate record (issue_locations), see
// api_issue_locations_test.go - an issue itself carries no position.

func TestIssuesList(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodGet,
			URL:             "/api/collections/issues/records",
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":0`},
		},
		{
			Name:               "unapproved resident sees nothing",
			Method:             http.MethodGet,
			URL:                "/api/collections/issues/records",
			Headers:            authHeader(t, emailUnapproved),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     200,
			ExpectedContent:    []string{`"totalItems":0`},
			NotExpectedContent: []string{`"Kaputte Gartenbank"`},
		},
		{
			Name:               "resident sees accepted community issues only, no location",
			Method:             http.MethodGet,
			URL:                "/api/collections/issues/records",
			Headers:            authHeader(t, emailResident),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     200,
			ExpectedContent:    []string{`"totalItems":3`, `"issueocom000001"`, `"issueicom000001"`, `"issuercom000001"`},
			NotExpectedContent: []string{`areahouse790000`, `"floor"`, `"lat"`, `"issuepcom000001"`, `"issuepprv000001"`, `"issueoprv000001"`, `"issueiprv000001"`, `"issuerprv000001"`, `"issuejcom000001"`, `"issuejprv000001"`, `submitter@example.com`},
		},
		{
			Name:            "beirat sees all issues",
			Method:          http.MethodGet,
			URL:             "/api/collections/issues/records",
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":11`, `"issuepcom000001"`, `"issueacom000001"`},
		},
		{
			Name:               "hausmeister sees accepted issues incl. private",
			Method:             http.MethodGet,
			URL:                "/api/collections/issues/records",
			Headers:            authHeader(t, emailHausmeister),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     200,
			ExpectedContent:    []string{`"totalItems":6`, `"issueoprv000001"`},
			NotExpectedContent: []string{`"issuepcom000001"`, `"issuejcom000001"`},
		},
		{
			Name:               "hausverwaltung sees accepted issues incl. private",
			Method:             http.MethodGet,
			URL:                "/api/collections/issues/records",
			Headers:            authHeader(t, emailHausverwaltung),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     200,
			ExpectedContent:    []string{`"totalItems":6`, `"issueoprv000001"`},
			NotExpectedContent: []string{`"issuepcom000001"`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestIssuesViewPending(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodGet,
			URL:             "/api/collections/issues/records/issuepcom000001",
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "resident",
			Method:          http.MethodGet,
			URL:             "/api/collections/issues/records/issuepcom000001",
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "hausmeister",
			Method:          http.MethodGet,
			URL:             "/api/collections/issues/records/issuepcom000001",
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "beirat sees pending issue with exact coords",
			Method:          http.MethodGet,
			URL:             "/api/collections/issues/records/issuepcom000001",
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"Defekte Laterne"`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestIssuesViewOpenCommunity(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodGet,
			URL:             "/api/collections/issues/records/issueocom000001",
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "unapproved resident",
			Method:          http.MethodGet,
			URL:             "/api/collections/issues/records/issueocom000001",
			Headers:         authHeader(t, emailUnapproved),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:               "resident: rounded coords only",
			Method:             http.MethodGet,
			URL:                "/api/collections/issues/records/issueocom000001",
			Headers:            authHeader(t, emailResident),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     200,
			ExpectedContent:    []string{`"Kaputte Gartenbank"`},
			NotExpectedContent: []string{`areahouse790000`, `"floor"`, `submitter@example.com`, `Max Mustermann`},
		},
		{
			Name:            "beirat: exact coords",
			Method:          http.MethodGet,
			URL:             "/api/collections/issues/records/issueocom000001",
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"Kaputte Gartenbank"`},
		},
		{
			Name:            "hausmeister: exact coords",
			Method:          http.MethodGet,
			URL:             "/api/collections/issues/records/issueocom000001",
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"Kaputte Gartenbank"`},
		},
		{
			Name:            "hausverwaltung: exact coords",
			Method:          http.MethodGet,
			URL:             "/api/collections/issues/records/issueocom000001",
			Headers:         authHeader(t, emailHausverwaltung),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"Kaputte Gartenbank"`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestIssuesViewOpenPrivate(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodGet,
			URL:             "/api/collections/issues/records/issueoprv000001",
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "resident cannot see private issues",
			Method:          http.MethodGet,
			URL:             "/api/collections/issues/records/issueoprv000001",
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "beirat sees private issues",
			Method:          http.MethodGet,
			URL:             "/api/collections/issues/records/issueoprv000001",
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"Privater Parkplatz belegt"`},
		},
		{
			Name:            "hausmeister sees private issues",
			Method:          http.MethodGet,
			URL:             "/api/collections/issues/records/issueoprv000001",
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"Privater Parkplatz belegt"`},
		},
		{
			Name:            "hausverwaltung sees private issues",
			Method:          http.MethodGet,
			URL:             "/api/collections/issues/records/issueoprv000001",
			Headers:         authHeader(t, emailHausverwaltung),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"Privater Parkplatz belegt"`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestIssuesCreate(t *testing.T) {
	t.Parallel()

	// issues are created only via the custom /api/portal/issues route (M3)
	body := `{"title":"Direkt","description":"Test","status":"pending","category":"test"}`

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodPost,
			URL:             "/api/collections/issues/records",
			Body:            strings.NewReader(body),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
		{
			Name:            "resident",
			Method:          http.MethodPost,
			URL:             "/api/collections/issues/records",
			Body:            strings.NewReader(body),
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
		{
			Name:            "beirat",
			Method:          http.MethodPost,
			URL:             "/api/collections/issues/records",
			Body:            strings.NewReader(body),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
		{
			Name:            "hausmeister",
			Method:          http.MethodPost,
			URL:             "/api/collections/issues/records",
			Body:            strings.NewReader(body),
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
		{
			Name:            "hausverwaltung",
			Method:          http.MethodPost,
			URL:             "/api/collections/issues/records",
			Body:            strings.NewReader(body),
			Headers:         authHeader(t, emailHausverwaltung),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestIssuesUpdate(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issueocom000001",
			Body:            strings.NewReader(`{"status":"in_progress"}`),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "resident cannot change status",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issueocom000001",
			Body:            strings.NewReader(`{"status":"in_progress"}`),
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "beirat can edit accepted issues",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issueocom000001",
			Body:            strings.NewReader(`{"status":"in_progress"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"status":"in_progress"`},
		},
		{
			Name:            "hausmeister progresses an open issue",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issueocom000001",
			Body:            strings.NewReader(`{"status":"in_progress"}`),
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"status":"in_progress"`},
		},
		{
			Name:            "hausmeister progresses a private issue",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issueoprv000001",
			Body:            strings.NewReader(`{"status":"in_progress"}`),
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"status":"in_progress"`},
		},
		{
			Name:            "hausmeister cannot accept a pending issue",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issuepcom000001",
			Body:            strings.NewReader(`{"status":"in_progress"}`),
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "hausmeister cannot change visibility",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issueocom000001",
			Body:            strings.NewReader(`{"visibility":"private"}`),
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "hausmeister cannot change the title",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issueocom000001",
			Body:            strings.NewReader(`{"title":"Umgetauft"}`),
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "hausmeister cannot touch photos",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issueocom000001",
			Body:            strings.NewReader(`{"photos":[]}`),
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "hausmeister cannot work on resolved issues",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issuercom000001",
			Body:            strings.NewReader(`{"status":"in_progress"}`),
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "hausverwaltung cannot update issues",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issueocom000001",
			Body:            strings.NewReader(`{"status":"in_progress"}`),
			Headers:         authHeader(t, emailHausverwaltung),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestIssuesDelete(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodDelete,
			URL:             "/api/collections/issues/records/issueocom000001",
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "resident",
			Method:          http.MethodDelete,
			URL:             "/api/collections/issues/records/issueocom000001",
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "beirat (retention cron deletes server-side)",
			Method:          http.MethodDelete,
			URL:             "/api/collections/issues/records/issueocom000001",
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "hausmeister",
			Method:          http.MethodDelete,
			URL:             "/api/collections/issues/records/issueocom000001",
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			// migration 1795000113: the admin role may delete issues
			Name:           "admin",
			Method:         http.MethodDelete,
			URL:            "/api/collections/issues/records/issueocom000001",
			Headers:        authHeader(t, emailAdmin),
			TestAppFactory: setupTestApp,
			ExpectedStatus: 204,
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

// TestIssuesAdminDeleteCascade: deleting an issue as admin removes its
// meta, location and history records with it (all cascade on the issue
// relation).
func TestIssuesAdminDeleteCascade(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	mux := serveMux(t, app)

	rec := doJSON(t, mux, http.MethodDelete, "/api/collections/issues/records/issuercom000001",
		"", authHeader(t, emailAdmin))
	if rec.Code != 204 {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}

	if _, err := app.FindRecordById("issues", "issuercom000001"); err == nil {
		t.Fatal("expected the issue to be deleted")
	}
	if _, err := app.FindRecordById("issue_metas", "imetarcom000001"); err == nil {
		t.Fatal("expected the issue_metas record to cascade")
	}
	if _, err := app.FindRecordById("issue_locations", "issuercom000001"); err == nil {
		t.Fatal("expected the issue_locations record to cascade")
	}
	events, err := app.FindRecordsByFilter("issue_events", "issue = 'issuercom000001'", "", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) > 0 {
		t.Fatalf("expected the issue_events records to cascade, got %d", len(events))
	}

	// only the admin row of the role matrix can delete; the file storage
	// cleanup of the deleted photo is PocketBase's own delete cascade
}
