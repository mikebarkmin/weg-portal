package portal

import (
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// portal_settings is superuser only (all rules null)
func TestPortalSettingsAccess(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest list",
			Method:          http.MethodGet,
			URL:             "/api/collections/portal_settings/records",
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
		{
			Name:            "resident list",
			Method:          http.MethodGet,
			URL:             "/api/collections/portal_settings/records",
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
		{
			Name:            "beirat list",
			Method:          http.MethodGet,
			URL:             "/api/collections/portal_settings/records",
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
		{
			Name:            "guest view",
			Method:          http.MethodGet,
			URL:             "/api/collections/portal_settings/records/portsettings000",
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
		{
			Name:            "resident update",
			Method:          http.MethodPatch,
			URL:             "/api/collections/portal_settings/records/portsettings000",
			Body:            strings.NewReader(`{"retention_issues_resolved_days":1}`),
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
		{
			Name:            "guest create",
			Method:          http.MethodPost,
			URL:             "/api/collections/portal_settings/records",
			Body:            strings.NewReader(`{"retention_suggestions_rejected_days":1,"retention_suggestions_accepted_days":1,"retention_issues_rejected_days":1,"retention_issues_resolved_days":1}`),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
		{
			Name:            "beirat delete",
			Method:          http.MethodDelete,
			URL:             "/api/collections/portal_settings/records/portsettings000",
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
		{
			Name:            "superuser list sees the single record",
			Method:          http.MethodGet,
			URL:             "/api/collections/portal_settings/records",
			Headers:         map[string]string{"Authorization": getAuthToken(t, "_superusers", superuserEmail)},
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":1`, `"portsettings000"`, `"retention_issues_resolved_days":365`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

// setupTestAppWithoutSettings returns a test app whose portal_settings
// record was removed directly on the DB level (bypassing the API guard)
// so that the "first record may be created" case is testable.
func setupTestAppWithoutSettings(t testing.TB) *tests.TestApp {
	app := setupTestApp(t)

	settings, err := app.FindRecordById("portal_settings", "portsettings000")
	if err != nil {
		t.Fatal(err)
	}
	if err := app.Delete(settings); err != nil {
		t.Fatal(err)
	}

	return app
}

// portal_settings is a single-record collection: the M5 hooks reject a
// second record and the deletion of the existing one - including for
// superusers (all rules are null, so superusers are the only ones who
// reach these endpoints at all).
func TestPortalSettingsSingleRecordInvariant(t *testing.T) {
	t.Parallel()

	newRecord := `{"retention_suggestions_rejected_days":30,"retention_suggestions_accepted_days":30,"retention_issues_rejected_days":30,"retention_issues_resolved_days":30}`

	scenarios := []tests.ApiScenario{
		{
			Name:   "superuser create (second record rejected)",
			Method: http.MethodPost,
			URL:    "/api/collections/portal_settings/records",
			Body:   strings.NewReader(newRecord),
			Headers: map[string]string{
				"Authorization": getAuthToken(t, "_superusers", superuserEmail),
			},
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`, `Only a single portal_settings record is allowed.`},
		},
		{
			Name:   "superuser delete (existing record rejected)",
			Method: http.MethodDelete,
			URL:    "/api/collections/portal_settings/records/portsettings000",
			Headers: map[string]string{
				"Authorization": getAuthToken(t, "_superusers", superuserEmail),
			},
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`, `The portal_settings record cannot be deleted.`},
		},
		{
			Name:   "superuser create (allowed while no record exists)",
			Method: http.MethodPost,
			URL:    "/api/collections/portal_settings/records",
			Body:   strings.NewReader(newRecord),
			Headers: map[string]string{
				"Authorization": getAuthToken(t, "_superusers", superuserEmail),
			},
			TestAppFactory:  setupTestAppWithoutSettings,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"retention_issues_resolved_days":30`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}
