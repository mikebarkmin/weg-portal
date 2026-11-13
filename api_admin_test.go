package portal

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// admin routes role-matrix tests (hooks/adminUsers.go, migration
// 1795000108): the `admin` role manages accounts in the app instead of a
// superuser in the PocketBase dashboard.
func TestAdminCreateUser(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodPost,
			URL:             "/api/portal/admin/users",
			Body:            strings.NewReader(`{"name":"Neu","email":"neu@portal.test","role":"beirat"}`),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  401,
			ExpectedContent: []string{`"status":401`},
		},
		{
			Name:            "resident",
			Method:          http.MethodPost,
			URL:             "/api/portal/admin/users",
			Body:            strings.NewReader(`{"name":"Neu","email":"neu@portal.test","role":"beirat"}`),
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
		{
			Name:            "beirat",
			Method:          http.MethodPost,
			URL:             "/api/portal/admin/users",
			Body:            strings.NewReader(`{"name":"Neu","email":"neu@portal.test","role":"beirat"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
		{
			Name:            "admin",
			Method:          http.MethodPost,
			URL:             "/api/portal/admin/users",
			Body:            strings.NewReader(`{"name":"Neu","email":"neu@portal.test","role":"beirat"}`),
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"role":"beirat"`, `"approved":true`, `"verified":true`, `"password"`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
				users, err := app.FindRecordsByFilter("users", "email = 'neu@portal.test'", "", 1, 0, nil)
				if err != nil || len(users) != 1 {
					t.Fatal("expected the created user to exist")
				}
			},
		},
		{
			Name:            "admin + explicit password",
			Method:          http.MethodPost,
			URL:             "/api/portal/admin/users",
			Body:            strings.NewReader(`{"name":"Neu","email":"neu@portal.test","role":"resident","password":"passwort123","approved":false,"verified":false}`),
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"approved":false`, `"verified":false`},
			NotExpectedContent: []string{
				`"password":"passwort123"`, // supplied passwords are never echoed
				`"passwordHash"`,
			},
		},
		{
			Name:            "admin + too short password",
			Method:          http.MethodPost,
			URL:             "/api/portal/admin/users",
			Body:            strings.NewReader(`{"name":"Neu","email":"neu@portal.test","role":"resident","password":"kurz"}`),
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "admin + unknown role",
			Method:          http.MethodPost,
			URL:             "/api/portal/admin/users",
			Body:            strings.NewReader(`{"name":"Neu","email":"neu@portal.test","role":"supercoder"}`),
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "admin + missing name",
			Method:          http.MethodPost,
			URL:             "/api/portal/admin/users",
			Body:            strings.NewReader(`{"email":"neu@portal.test","role":"resident"}`),
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "admin + duplicate email",
			Method:          http.MethodPost,
			URL:             "/api/portal/admin/users",
			Body:            strings.NewReader(`{"name":"Zweit","email":"resident@portal.test","role":"resident"}`),
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestAdminUpdateUser(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodPatch,
			URL:             "/api/portal/admin/users/userresident000",
			Body:            strings.NewReader(`{"role":"beirat"}`),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  401,
			ExpectedContent: []string{`"status":401`},
		},
		{
			Name:            "beirat",
			Method:          http.MethodPatch,
			URL:             "/api/portal/admin/users/userresident000",
			Body:            strings.NewReader(`{"role":"beirat"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
		{
			Name:            "admin changes the role",
			Method:          http.MethodPatch,
			URL:             "/api/portal/admin/users/userresident000",
			Body:            strings.NewReader(`{"role":"beirat"}`),
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"role":"beirat"`},
		},
		{
			Name:            "admin approves a pending account",
			Method:          http.MethodPatch,
			URL:             "/api/portal/admin/users/userunapproved0",
			Body:            strings.NewReader(`{"approved":true}`),
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"approved":true`},
		},
		{
			Name:            "admin changes name and email",
			Method:          http.MethodPatch,
			URL:             "/api/portal/admin/users/userresident000",
			Body:            strings.NewReader(`{"name":"Anderer Name","email":"neu@portal.test"}`),
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"name":"Anderer Name"`, `"email":"neu@portal.test"`},
		},
		{
			Name:            "admin never edits their own record",
			Method:          http.MethodPatch,
			URL:             "/api/portal/admin/users/useradmin000000",
			Body:            strings.NewReader(`{"role":"resident"}`),
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "admin + unknown record",
			Method:          http.MethodPatch,
			URL:             "/api/portal/admin/users/nichtvorhanden",
			Body:            strings.NewReader(`{"role":"beirat"}`),
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "superuser may not demote the last admin",
			Method:          http.MethodPatch,
			URL:             "/api/portal/admin/users/useradmin000000",
			Body:            strings.NewReader(`{"role":"resident"}`),
			Headers:         map[string]string{"Authorization": getAuthToken(t, "_superusers", superuserEmail)},
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestAdminResetPassword(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodPost,
			URL:             "/api/portal/admin/users/userresident000/reset-password",
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  401,
			ExpectedContent: []string{`"status":401`},
		},
		{
			Name:            "beirat",
			Method:          http.MethodPost,
			URL:             "/api/portal/admin/users/userresident000/reset-password",
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
		{
			Name:            "admin + chosen password",
			Method:          http.MethodPost,
			URL:             "/api/portal/admin/users/userresident000/reset-password",
			Body:            strings.NewReader(`{"password":"neuespasswort"}`),
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"password":"neuespasswort"`},
		},
		{
			Name:            "admin + too short chosen password",
			Method:          http.MethodPost,
			URL:             "/api/portal/admin/users/userresident000/reset-password",
			Body:            strings.NewReader(`{"password":"kurz"}`),
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "admin never resets their own password here",
			Method:          http.MethodPost,
			URL:             "/api/portal/admin/users/useradmin000000/reset-password",
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}

	// workflow: a generated password works for the next login
	t.Run("generated password authenticates", func(t *testing.T) {
		app := setupTestApp(t)
		defer app.Cleanup()

		mux := serveMux(t, app)

		rec := doJSON(t, mux, http.MethodPost,
			"/api/portal/admin/users/userresident000/reset-password", `{}`,
			map[string]string{"Authorization": getAuthToken(t, "users", emailAdmin)})
		if rec.Code != 200 {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		var body struct {
			Password string `json:"password"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || len(body.Password) < 8 {
			t.Fatalf("expected a generated password, got: %s", rec.Body.String())
		}

		rec = doJSON(t, mux, http.MethodPost, "/api/collections/users/auth-with-password",
			`{"identity":"resident@portal.test","password":"`+body.Password+`"}`, nil)
		if rec.Code != 200 {
			t.Fatalf("expected the new password to authenticate, got %d", rec.Code)
		}
	})
}

func TestAdminDeleteUser(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodDelete,
			URL:             "/api/portal/admin/users/userresident000",
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  401,
			ExpectedContent: []string{`"status":401`},
		},
		{
			Name:            "beirat",
			Method:          http.MethodDelete,
			URL:             "/api/portal/admin/users/userresident000",
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
		{
			Name:           "admin removes a user",
			Method:         http.MethodDelete,
			URL:            "/api/portal/admin/users/userresident000",
			Headers:        authHeader(t, emailAdmin),
			TestAppFactory: setupTestApp,
			ExpectedStatus: 204,
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
				if _, err := app.FindRecordById("users", "userresident000"); err == nil {
					t.Fatal("expected the account to be deleted")
				}
			},
		},
		{
			Name:            "admin never deletes their own record",
			Method:          http.MethodDelete,
			URL:             "/api/portal/admin/users/useradmin000000",
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "superuser may not delete the last admin",
			Method:          http.MethodDelete,
			URL:             "/api/portal/admin/users/useradmin000000",
			Headers:         map[string]string{"Authorization": getAuthToken(t, "_superusers", superuserEmail)},
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "admin + unknown record",
			Method:          http.MethodDelete,
			URL:             "/api/portal/admin/users/nichtvorhanden",
			Headers:         authHeader(t, emailAdmin),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

// TestAdminSecondAdminGuards: with a second active admin, demoting and
// deleting the other admin is allowed; once only one remains, the routes
// refuse to remove it (the last-active-admin guard of hooks/adminUsers.go).
func TestAdminSecondAdminGuards(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	mux := serveMux(t, app)
	adminToken := map[string]string{"Authorization": getAuthToken(t, "users", emailAdmin)}

	// promote resident -> admin (another active admin exists: the caller)
	rec := doJSON(t, mux, http.MethodPatch, "/api/portal/admin/users/userresident000",
		`{"role":"admin"}`, adminToken)
	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// demote again: allowed while the caller remains admin
	rec = doJSON(t, mux, http.MethodPatch, "/api/portal/admin/users/userresident000",
		`{"role":"resident"}`, adminToken)
	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// re-promote, then delete the other admin: allowed (caller remains)
	rec = doJSON(t, mux, http.MethodPatch, "/api/portal/admin/users/userresident000",
		`{"role":"admin"}`, adminToken)
	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	rec = doJSON(t, mux, http.MethodDelete, "/api/portal/admin/users/userresident000", "", adminToken)
	if rec.Code != 204 {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}

	// the fixture admin is now the only active one: still protected against
	// a superuser demote/delete (the admin themself cannot target self)
	superToken := map[string]string{"Authorization": getAuthToken(t, "_superusers", superuserEmail)}
	rec = doJSON(t, mux, http.MethodPatch, "/api/portal/admin/users/useradmin000000",
		`{"role":"resident"}`, superToken)
	if rec.Code != 400 {
		t.Fatalf("expected 400 for demoting the last admin, got %d", rec.Code)
	}
	rec = doJSON(t, mux, http.MethodDelete, "/api/portal/admin/users/useradmin000000", "", superToken)
	if rec.Code != 400 {
		t.Fatalf("expected 400 for deleting the last admin, got %d", rec.Code)
	}
}
