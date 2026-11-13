package portal

import (
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// The admin role carries every Beirat capability (migration
// 1795000109 widens all beirat collection rules; the workflow hooks
// never check the role themselves). These tests pin the content rights
// down for each collection surface the Beirat uses.
func TestAdminBeiratRights(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		// ---- beirat calendar: read and write events -------------------
		{
			Name:            "admin views a beirat calendar event",
			Method:          http.MethodGet,
			URL:             "/api/collections/events/records/eventbeirat0001",
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"calendar":"beirat"`, `"title":"Beiratssitzung"`},
		},
		{
			Name:            "resident cannot view a beirat calendar event",
			Method:          http.MethodGet,
			URL:             "/api/collections/events/records/eventbeirat0001",
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "admin creates an event in the beirat calendar",
			Method:          http.MethodPost,
			URL:             "/api/collections/events/records",
			Body:            strings.NewReader(`{"title":"Beiratssitzung Nachtrag","date_start":"2026-12-04 18:00:00.000Z","calendar":"beirat","category":"beirat"}`),
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"calendar":"beirat"`, `"title":"Beiratssitzung Nachtrag"`},
		},
		{
			Name:            "admin edits an existing event",
			Method:          http.MethodPatch,
			URL:             "/api/collections/events/records/eventsimple0001",
			Body:            strings.NewReader(`{"title":"Herbstputz (neu)"}`),
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"title":"Herbstputz (neu)"`},
		},
		// ---- moderation ------------------------------------------------
		{
			Name:            "admin accepts a suggestion",
			Method:          http.MethodPatch,
			URL:             "/api/collections/suggestions/records/suggpending0001",
			Body:            strings.NewReader(`{"status":"accepted","decision_note":"Passt."}`),
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"status":"accepted"`},
		},
		{
			Name:            "admin accepts an issue (sets visibility)",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issuepcom000001",
			Body:            strings.NewReader(`{"status":"open","visibility":"community"}`),
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"status":"open"`, `"visibility":"community"`},
		},
		{
			Name:            "admin sees the exact issue coordinates",
			Method:          http.MethodGet,
			URL:             "/api/collections/issues/records/issuepcom000001",
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"lat_exact"`, `"lng_exact"`},
		},
		// ---- notes -----------------------------------------------------
		{
			Name:            "admin writes a note",
			Method:          http.MethodPost,
			URL:             "/api/collections/notes/records",
			Body:            strings.NewReader(`{"title":"Admin-Notiz","body":"Interne Notiz.","author":"useradmin000000"}`),
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"title":"Admin-Notiz"`, `"author":"useradmin000000"`},
		},
		// ---- announcements --------------------------------------------
		{
			Name:            "admin publishes an owners-only announcement",
			Method:          http.MethodPost,
			URL:             "/api/collections/announcements/records",
			Body:            strings.NewReader(`{"title":"Rueckfrage","body":"Bitte melden.","visibility":"owners","author":"useradmin000000"}`),
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"visibility":"owners"`},
		},
		// ---- user approval through the normal collection endpoint ----
		{
			Name:            "admin approves a pending account like the Beirat",
			Method:          http.MethodPatch,
			URL:             "/api/collections/users/records/userunapproved0",
			Body:            strings.NewReader(`{"approved":true}`),
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"approved":true`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}
