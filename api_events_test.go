package portal

import (
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// events role-matrix tests (public calendar: write beirat, read everyone)
// Three calendars (migration 1795000105): public for everyone, owners for
// approved accounts, beirat for the Beirat only. The fixture has 5 public
// events plus one in each of the other calendars.
func TestEventsList(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodGet,
			URL:             "/api/collections/events/records",
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":5`, `"eventsimple0001"`, `"eventrecurring1"`},
		},
		{
			Name:            "unapproved resident",
			Method:          http.MethodGet,
			URL:             "/api/collections/events/records",
			Headers:         authHeader(t, emailUnapproved),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":5`},
		},
		{
			Name:            "resident",
			Method:          http.MethodGet,
			URL:             "/api/collections/events/records",
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":6`},
		},
		{
			Name:            "beirat",
			Method:          http.MethodGet,
			URL:             "/api/collections/events/records",
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":7`},
		},
		{
			Name:            "hausmeister",
			Method:          http.MethodGet,
			URL:             "/api/collections/events/records",
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":6`},
		},
		{
			Name:            "hausverwaltung",
			Method:          http.MethodGet,
			URL:             "/api/collections/events/records",
			Headers:         authHeader(t, emailHausverwaltung),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":6`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestEventsView(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodGet,
			URL:             "/api/collections/events/records/eventsimple0001",
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"Herbstputz"`},
		},
		{
			Name:            "unapproved resident",
			Method:          http.MethodGet,
			URL:             "/api/collections/events/records/eventsimple0001",
			Headers:         authHeader(t, emailUnapproved),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"Herbstputz"`},
		},
		{
			Name:            "resident",
			Method:          http.MethodGet,
			URL:             "/api/collections/events/records/eventsimple0001",
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"Herbstputz"`},
		},
		{
			Name:            "beirat",
			Method:          http.MethodGet,
			URL:             "/api/collections/events/records/eventsimple0001",
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"Herbstputz"`},
		},
		{
			Name:            "hausmeister",
			Method:          http.MethodGet,
			URL:             "/api/collections/events/records/eventsimple0001",
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"Herbstputz"`},
		},
		{
			Name:            "hausverwaltung",
			Method:          http.MethodGet,
			URL:             "/api/collections/events/records/eventsimple0001",
			Headers:         authHeader(t, emailHausverwaltung),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"Herbstputz"`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestEventsCreate(t *testing.T) {
	t.Parallel()

	body := `{"title":"Neues Event","description":"Test","date_start":"2027-01-01 10:00:00.000Z"}`

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodPost,
			URL:             "/api/collections/events/records",
			Body:            strings.NewReader(body),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "unapproved resident",
			Method:          http.MethodPost,
			URL:             "/api/collections/events/records",
			Body:            strings.NewReader(body),
			Headers:         authHeader(t, emailUnapproved),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "resident",
			Method:          http.MethodPost,
			URL:             "/api/collections/events/records",
			Body:            strings.NewReader(body),
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "beirat",
			Method:          http.MethodPost,
			URL:             "/api/collections/events/records",
			Body:            strings.NewReader(body),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"Neues Event"`},
		},
		{
			Name:            "hausmeister",
			Method:          http.MethodPost,
			URL:             "/api/collections/events/records",
			Body:            strings.NewReader(body),
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "hausverwaltung",
			Method:          http.MethodPost,
			URL:             "/api/collections/events/records",
			Body:            strings.NewReader(body),
			Headers:         authHeader(t, emailHausverwaltung),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestEventsUpdate(t *testing.T) {
	t.Parallel()

	body := `{"title":"Geaendert"}`

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodPatch,
			URL:             "/api/collections/events/records/eventsimple0001",
			Body:            strings.NewReader(body),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "resident",
			Method:          http.MethodPatch,
			URL:             "/api/collections/events/records/eventsimple0001",
			Body:            strings.NewReader(body),
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "beirat",
			Method:          http.MethodPatch,
			URL:             "/api/collections/events/records/eventsimple0001",
			Body:            strings.NewReader(body),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"Geaendert"`},
		},
		{
			Name:            "hausmeister",
			Method:          http.MethodPatch,
			URL:             "/api/collections/events/records/eventsimple0001",
			Body:            strings.NewReader(body),
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "hausverwaltung",
			Method:          http.MethodPatch,
			URL:             "/api/collections/events/records/eventsimple0001",
			Body:            strings.NewReader(body),
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

func TestEventsDelete(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodDelete,
			URL:             "/api/collections/events/records/eventsimple0001",
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "resident",
			Method:          http.MethodDelete,
			URL:             "/api/collections/events/records/eventsimple0001",
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:           "beirat",
			Method:         http.MethodDelete,
			URL:            "/api/collections/events/records/eventsimple0001",
			Headers:        authHeader(t, emailBeirat),
			TestAppFactory: setupTestApp,
			ExpectedStatus: 204,
		},
		{
			Name:            "hausmeister",
			Method:          http.MethodDelete,
			URL:             "/api/collections/events/records/eventsimple0001",
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
