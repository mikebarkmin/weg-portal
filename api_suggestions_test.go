package portal

import (
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// suggestions role-matrix tests (queue visible to beirat only; public create
// with the create rule forcing status=pending)
func TestSuggestionsList(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:               "guest",
			Method:             http.MethodGet,
			URL:                "/api/collections/suggestions/records",
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     200,
			ExpectedContent:    []string{`"totalItems":0`},
			NotExpectedContent: []string{`submitter@example.com`, `"Vorschlag Sommerfest"`},
		},
		{
			Name:            "unapproved resident",
			Method:          http.MethodGet,
			URL:             "/api/collections/suggestions/records",
			Headers:         authHeader(t, emailUnapproved),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":0`},
		},
		{
			Name:               "resident",
			Method:             http.MethodGet,
			URL:                "/api/collections/suggestions/records",
			Headers:            authHeader(t, emailResident),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     200,
			ExpectedContent:    []string{`"totalItems":0`},
			NotExpectedContent: []string{`submitter@example.com`},
		},
		{
			Name:            "beirat sees everything incl. submitter emails",
			Method:          http.MethodGet,
			URL:             "/api/collections/suggestions/records",
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":3`, `submitter@example.com`, `"Vorschlag Sommerfest"`},
		},
		{
			Name:            "hausmeister",
			Method:          http.MethodGet,
			URL:             "/api/collections/suggestions/records",
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":0`},
		},
		{
			Name:            "hausverwaltung",
			Method:          http.MethodGet,
			URL:             "/api/collections/suggestions/records",
			Headers:         authHeader(t, emailHausverwaltung),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":0`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestSuggestionsView(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodGet,
			URL:             "/api/collections/suggestions/records/suggpending0001",
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "resident",
			Method:          http.MethodGet,
			URL:             "/api/collections/suggestions/records/suggpending0001",
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "hausmeister",
			Method:          http.MethodGet,
			URL:             "/api/collections/suggestions/records/suggpending0001",
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "beirat",
			Method:          http.MethodGet,
			URL:             "/api/collections/suggestions/records/suggpending0001",
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"Vorschlag Sommerfest"`, `submitter@example.com`, `"status":"pending"`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestSuggestionsCreate(t *testing.T) {
	t.Parallel()

	body := `{"title":"Neuer Vorschlag","description":"Test","date_start":"2027-03-01 10:00:00.000Z","email":"newsubmitter@example.com","status":"pending","honeypot":"","form_started_at":1794567508651}`

	scenarios := []tests.ApiScenario{
		{
			Name:               "guest",
			Method:             http.MethodPost,
			URL:                "/api/collections/suggestions/records",
			Body:               strings.NewReader(body),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     200,
			ExpectedContent:    []string{`"status":"pending"`},
			NotExpectedContent: []string{`"decision_note":"selbst entschieden"`},
		},
		{
			Name:               "guest submits a recurring meeting suggestion",
			Method:             http.MethodPost,
			URL:                "/api/collections/suggestions/records",
			Body:               strings.NewReader(`{"title":"Gemeinschaftsgarten","description":"Jeden 14. Tag","date_start":"2027-04-05 09:00:00.000Z","rrule":"FREQ=WEEKLY;INTERVAL=2;BYDAY=MO","email":"newsubmitter@example.com","status":"pending","honeypot":"","form_started_at":1794567514781}`),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     200,
			ExpectedContent:    []string{`"status":"pending"`, `"FREQ=WEEKLY;INTERVAL=2;BYDAY=MO"`},
			NotExpectedContent: []string{`"decision_note":"selbst entschieden"`},
		},
		{
			Name:            "unapproved resident",
			Method:          http.MethodPost,
			URL:             "/api/collections/suggestions/records",
			Body:            strings.NewReader(body),
			Headers:         authHeader(t, emailUnapproved),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"status":"pending"`},
		},
		{
			Name:            "resident",
			Method:          http.MethodPost,
			URL:             "/api/collections/suggestions/records",
			Body:            strings.NewReader(body),
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"status":"pending"`},
		},
		{
			Name:            "beirat",
			Method:          http.MethodPost,
			URL:             "/api/collections/suggestions/records",
			Body:            strings.NewReader(body),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"status":"pending"`},
		},
		{
			Name:            "guest cannot pre-accept a suggestion",
			Method:          http.MethodPost,
			URL:             "/api/collections/suggestions/records",
			Body:            strings.NewReader(`{"title":"Neuer Vorschlag","date_start":"2027-03-01 10:00:00.000Z","email":"newsubmitter@example.com","status":"accepted","honeypot":"","form_started_at":1794567514781,`),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "guest cannot inject a decision note",
			Method:          http.MethodPost,
			URL:             "/api/collections/suggestions/records",
			Body:            strings.NewReader(`{"title":"Neuer Vorschlag","date_start":"2027-03-01 10:00:00.000Z","email":"newsubmitter@example.com","status":"pending","decision_note":"selbst entschieden","honeypot":"","form_started_at":1794567514781}`),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "guest cannot inject decided_at",
			Method:          http.MethodPost,
			URL:             "/api/collections/suggestions/records",
			Body:            strings.NewReader(`{"title":"Neuer Vorschlag","date_start":"2027-03-01 10:00:00.000Z","email":"newsubmitter@example.com","status":"pending","decided_at":"2026-11-01 10:00:00.000Z","honeypot":"","form_started_at":1794567514781}`),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestSuggestionsUpdate(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodPatch,
			URL:             "/api/collections/suggestions/records/suggpending0001",
			Body:            strings.NewReader(`{"status":"accepted"}`),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "resident",
			Method:          http.MethodPatch,
			URL:             "/api/collections/suggestions/records/suggpending0001",
			Body:            strings.NewReader(`{"status":"accepted"}`),
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "beirat accepts",
			Method:          http.MethodPatch,
			URL:             "/api/collections/suggestions/records/suggpending0001",
			Body:            strings.NewReader(`{"status":"accepted","decision_note":"Einverstanden"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"status":"accepted"`, `"Einverstanden"`},
		},
		{
			Name:            "hausmeister",
			Method:          http.MethodPatch,
			URL:             "/api/collections/suggestions/records/suggpending0001",
			Body:            strings.NewReader(`{"status":"accepted"}`),
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestSuggestionsDelete(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodDelete,
			URL:             "/api/collections/suggestions/records/suggpending0001",
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
		{
			Name:            "resident",
			Method:          http.MethodDelete,
			URL:             "/api/collections/suggestions/records/suggpending0001",
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
		{
			Name:            "beirat (retention cron deletes server-side)",
			Method:          http.MethodDelete,
			URL:             "/api/collections/suggestions/records/suggpending0001",
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
