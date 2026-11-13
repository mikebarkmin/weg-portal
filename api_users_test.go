package portal

import (
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// users role-matrix tests (plan.md "Collections and access", "Users: updates and approval")
func TestUsersList(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodGet,
			URL:             "/api/collections/users/records",
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":0`},
		},
		{
			Name:            "unapproved resident",
			Method:          http.MethodGet,
			URL:             "/api/collections/users/records",
			Headers:         authHeader(t, emailUnapproved),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":1`, `"userunapproved0"`},
		},
		{
			Name:            "approved resident",
			Method:          http.MethodGet,
			URL:             "/api/collections/users/records",
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":1`, `"userresident000"`},
		},
		{
			Name:            "beirat",
			Method:          http.MethodGet,
			URL:             "/api/collections/users/records",
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":5`},
		},
		{
			Name:            "hausmeister",
			Method:          http.MethodGet,
			URL:             "/api/collections/users/records",
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":1`, `"userhausmeister"`},
		},
		{
			Name:            "hausverwaltung",
			Method:          http.MethodGet,
			URL:             "/api/collections/users/records",
			Headers:         authHeader(t, emailHausverwaltung),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":1`, `"userhausverwalt"`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestUsersView(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest -> other user",
			Method:          http.MethodGet,
			URL:             "/api/collections/users/records/userresident000",
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "unapproved resident -> own record",
			Method:          http.MethodGet,
			URL:             "/api/collections/users/records/userunapproved0",
			Headers:         authHeader(t, emailUnapproved),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"userunapproved0"`},
		},
		{
			Name:            "unapproved resident -> other record",
			Method:          http.MethodGet,
			URL:             "/api/collections/users/records/userresident000",
			Headers:         authHeader(t, emailUnapproved),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "resident -> own record",
			Method:          http.MethodGet,
			URL:             "/api/collections/users/records/userresident000",
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"userresident000"`},
		},
		{
			Name:            "resident -> other record",
			Method:          http.MethodGet,
			URL:             "/api/collections/users/records/userbeirat00000",
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "beirat -> other record",
			Method:          http.MethodGet,
			URL:             "/api/collections/users/records/userresident000",
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"userresident000"`},
		},
		{
			Name:            "hausmeister -> own record",
			Method:          http.MethodGet,
			URL:             "/api/collections/users/records/userhausmeister",
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"userhausmeister"`},
		},
		{
			Name:            "hausmeister -> other record",
			Method:          http.MethodGet,
			URL:             "/api/collections/users/records/userresident000",
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "hausverwaltung -> other record",
			Method:          http.MethodGet,
			URL:             "/api/collections/users/records/userresident000",
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

func TestUsersCreate(t *testing.T) {
	t.Parallel()

	body := `{"email":"newuser@example.com","password":"` + fixturePassword + `","passwordConfirm":"` + fixturePassword + `","name":"Neu","role":"resident"}`

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodPost,
			URL:             "/api/collections/users/records",
			Body:            strings.NewReader(body),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"role":"resident"`},
		},
		{
			Name:            "unapproved resident",
			Method:          http.MethodPost,
			URL:             "/api/collections/users/records",
			Body:            strings.NewReader(body),
			Headers:         authHeader(t, emailUnapproved),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"role":"resident"`},
		},
		{
			Name:            "resident",
			Method:          http.MethodPost,
			URL:             "/api/collections/users/records",
			Body:            strings.NewReader(body),
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"role":"resident"`},
		},
		{
			Name:            "beirat",
			Method:          http.MethodPost,
			URL:             "/api/collections/users/records",
			Body:            strings.NewReader(body),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"role":"resident"`},
		},
		{
			Name:            "hausmeister",
			Method:          http.MethodPost,
			URL:             "/api/collections/users/records",
			Body:            strings.NewReader(body),
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"role":"resident"`},
		},
		{
			Name:            "hausverwaltung",
			Method:          http.MethodPost,
			URL:             "/api/collections/users/records",
			Body:            strings.NewReader(body),
			Headers:         authHeader(t, emailHausverwaltung),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"role":"resident"`},
		},
		{
			// the users create hook forces role=resident, so clients
			// cannot and need not submit a role
			Name:            "guest - missing role is forced to resident",
			Method:          http.MethodPost,
			URL:             "/api/collections/users/records",
			Body:            strings.NewReader(`{"email":"newuser@example.com","password":"` + fixturePassword + `","passwordConfirm":"` + fixturePassword + `","name":"Neu"}`),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"role":"resident"`, `"approved":false`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestUsersUpdate(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest -> other record",
			Method:          http.MethodPatch,
			URL:             "/api/collections/users/records/userresident000",
			Body:            strings.NewReader(`{"name":"Gast"}`),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "resident -> own name",
			Method:          http.MethodPatch,
			URL:             "/api/collections/users/records/userresident000",
			Body:            strings.NewReader(`{"name":"Neuer Name"}`),
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"Neuer Name"`},
		},
		{
			Name:            "resident cannot self-elevate role",
			Method:          http.MethodPatch,
			URL:             "/api/collections/users/records/userresident000",
			Body:            strings.NewReader(`{"role":"beirat"}`),
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "resident cannot self-approve",
			Method:          http.MethodPatch,
			URL:             "/api/collections/users/records/userresident000",
			Body:            strings.NewReader(`{"approved":true}`),
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "resident cannot self-verify",
			Method:          http.MethodPatch,
			URL:             "/api/collections/users/records/userresident000",
			Body:            strings.NewReader(`{"verified":true}`),
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "resident -> other record",
			Method:          http.MethodPatch,
			URL:             "/api/collections/users/records/userbeirat00000",
			Body:            strings.NewReader(`{"name":"Neuer Name"}`),
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "unapproved resident cannot self-approve",
			Method:          http.MethodPatch,
			URL:             "/api/collections/users/records/userunapproved0",
			Body:            strings.NewReader(`{"approved":true}`),
			Headers:         authHeader(t, emailUnapproved),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "beirat approves resident",
			Method:          http.MethodPatch,
			URL:             "/api/collections/users/records/userresident000",
			Body:            strings.NewReader(`{"approved":false}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"approved":false`},
		},
		{
			Name:            "beirat cannot change role",
			Method:          http.MethodPatch,
			URL:             "/api/collections/users/records/userresident000",
			Body:            strings.NewReader(`{"role":"beirat"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "beirat cannot change email",
			Method:          http.MethodPatch,
			URL:             "/api/collections/users/records/userresident000",
			Body:            strings.NewReader(`{"email":"hijacked@example.com"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "beirat cannot change name",
			Method:          http.MethodPatch,
			URL:             "/api/collections/users/records/userresident000",
			Body:            strings.NewReader(`{"name":"Umbenannt"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "beirat can set notify flag",
			Method:          http.MethodPatch,
			URL:             "/api/collections/users/records/userresident000",
			Body:            strings.NewReader(`{"notify_new_issues":true}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"notify_new_issues":true`},
		},
		{
			Name:            "hausmeister -> own name",
			Method:          http.MethodPatch,
			URL:             "/api/collections/users/records/userhausmeister",
			Body:            strings.NewReader(`{"name":"Neuer Name"}`),
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"Neuer Name"`},
		},
		{
			Name:            "hausmeister -> other record",
			Method:          http.MethodPatch,
			URL:             "/api/collections/users/records/userresident000",
			Body:            strings.NewReader(`{"name":"Neuer Name"}`),
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "hausverwaltung -> other record",
			Method:          http.MethodPatch,
			URL:             "/api/collections/users/records/userresident000",
			Body:            strings.NewReader(`{"approved":false}`),
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

func TestUsersDelete(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodDelete,
			URL:             "/api/collections/users/records/userresident000",
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
		{
			Name:            "resident -> own record",
			Method:          http.MethodDelete,
			URL:             "/api/collections/users/records/userresident000",
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
		{
			Name:            "beirat",
			Method:          http.MethodDelete,
			URL:             "/api/collections/users/records/userresident000",
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
		{
			Name:            "hausmeister",
			Method:          http.MethodDelete,
			URL:             "/api/collections/users/records/userresident000",
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}
