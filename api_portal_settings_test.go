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
