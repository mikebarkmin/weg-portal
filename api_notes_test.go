package portal

import (
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// notes tests (beirat internal notes)
func TestNotesList(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodGet,
			URL:             "/api/collections/notes/records",
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":0`},
		},
		{
			Name:               "resident",
			Method:             http.MethodGet,
			URL:                "/api/collections/notes/records",
			Headers:            authHeader(t, emailResident),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     200,
			ExpectedContent:    []string{`"totalItems":0`},
			NotExpectedContent: []string{`Wichtig`, `Hausmeister ab Maerz`},
		},
		{
			Name:            "beirat",
			Method:          http.MethodGet,
			URL:             "/api/collections/notes/records",
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":2`, `"notesnormal0001"`, `"notespinned0001"`},
		},
		{
			Name:            "hausmeister",
			Method:          http.MethodGet,
			URL:             "/api/collections/notes/records",
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":0`},
		},
		{
			Name:            "hausverwaltung",
			Method:          http.MethodGet,
			URL:             "/api/collections/notes/records",
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

func TestNotesView(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodGet,
			URL:             "/api/collections/notes/records/notesnormal0001",
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "resident",
			Method:          http.MethodGet,
			URL:             "/api/collections/notes/records/notesnormal0001",
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "beirat",
			Method:          http.MethodGet,
			URL:             "/api/collections/notes/records/notesnormal0001",
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"Sonstiges"`, `"userbeirat00000"`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestNotesCreate(t *testing.T) {
	t.Parallel()

	body := `{"title":"Neue Notiz","body":"Test","author":"userbeirat00000"}`

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodPost,
			URL:             "/api/collections/notes/records",
			Body:            strings.NewReader(body),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "resident",
			Method:          http.MethodPost,
			URL:             "/api/collections/notes/records",
			Body:            strings.NewReader(body),
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "beirat creates a note",
			Method:          http.MethodPost,
			URL:             "/api/collections/notes/records",
			Body:            strings.NewReader(body),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"Neue Notiz"`},
		},
		{
			Name:            "beirat cannot spoof another author",
			Method:          http.MethodPost,
			URL:             "/api/collections/notes/records",
			Body:            strings.NewReader(`{"title":"Neue Notiz","body":"Test","author":"userresident000"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "hausmeister",
			Method:          http.MethodPost,
			URL:             "/api/collections/notes/records",
			Body:            strings.NewReader(body),
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestNotesUpdate(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodPatch,
			URL:             "/api/collections/notes/records/notesnormal0001",
			Body:            strings.NewReader(`{"title":"Geaendert"}`),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "resident",
			Method:          http.MethodPatch,
			URL:             "/api/collections/notes/records/notesnormal0001",
			Body:            strings.NewReader(`{"title":"Geaendert"}`),
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "beirat updates own note",
			Method:          http.MethodPatch,
			URL:             "/api/collections/notes/records/notesnormal0001",
			Body:            strings.NewReader(`{"title":"Geaendert"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"Geaendert"`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestNotesDelete(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodDelete,
			URL:             "/api/collections/notes/records/notesnormal0001",
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "resident",
			Method:          http.MethodDelete,
			URL:             "/api/collections/notes/records/notesnormal0001",
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:           "beirat deletes a note",
			Method:         http.MethodDelete,
			URL:            "/api/collections/notes/records/notesnormal0001",
			Headers:        authHeader(t, emailBeirat),
			TestAppFactory: setupTestApp,
			ExpectedStatus: 204,
		},
		{
			Name:            "hausmeister",
			Method:          http.MethodDelete,
			URL:             "/api/collections/notes/records/notesnormal0001",
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
