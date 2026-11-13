package portal

import (
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// issue_metas tests (submitter contact emails: beirat only; no API create/update/delete)
func TestIssueMetasList(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodGet,
			URL:             "/api/collections/issue_metas/records",
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":0`},
		},
		{
			Name:               "resident",
			Method:             http.MethodGet,
			URL:                "/api/collections/issue_metas/records",
			Headers:            authHeader(t, emailResident),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     200,
			ExpectedContent:    []string{`"totalItems":0`},
			NotExpectedContent: []string{`submitter@example.com`},
		},
		{
			Name:            "beirat",
			Method:          http.MethodGet,
			URL:             "/api/collections/issue_metas/records",
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":10`, `submitter@example.com`},
		},
		{
			Name:               "hausmeister",
			Method:             http.MethodGet,
			URL:                "/api/collections/issue_metas/records",
			Headers:            authHeader(t, emailHausmeister),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     200,
			ExpectedContent:    []string{`"totalItems":0`},
			NotExpectedContent: []string{`submitter@example.com`},
		},
		{
			Name:            "hausverwaltung",
			Method:          http.MethodGet,
			URL:             "/api/collections/issue_metas/records",
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

func TestIssueMetasView(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest",
			Method:          http.MethodGet,
			URL:             "/api/collections/issue_metas/records/imetapcom000001",
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "resident",
			Method:          http.MethodGet,
			URL:             "/api/collections/issue_metas/records/imetapcom000001",
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "hausmeister",
			Method:          http.MethodGet,
			URL:             "/api/collections/issue_metas/records/imetapcom000001",
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "beirat sees the submitter contact",
			Method:          http.MethodGet,
			URL:             "/api/collections/issue_metas/records/imetapcom000001",
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`submitter@example.com`, `"Max Mustermann"`, `"issue":"issuepcom000001"`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestIssueMetasMutationsBlocked(t *testing.T) {
	t.Parallel()

	body := `{"issue":"issuepcom000001","email":"attacker@example.com"}`

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest create",
			Method:          http.MethodPost,
			URL:             "/api/collections/issue_metas/records",
			Body:            strings.NewReader(body),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
		{
			Name:            "beirat create (only the custom route may create)",
			Method:          http.MethodPost,
			URL:             "/api/collections/issue_metas/records",
			Body:            strings.NewReader(body),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
		{
			Name:            "beirat update",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issue_metas/records/imetapcom000001",
			Body:            strings.NewReader(`{"email":"hijacked@example.com"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
		{
			Name:            "beirat delete (cascade only)",
			Method:          http.MethodDelete,
			URL:             "/api/collections/issue_metas/records/imetapcom000001",
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
		{
			Name:            "resident update",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issue_metas/records/imetapcom000001",
			Body:            strings.NewReader(`{"email":"hijacked@example.com"}`),
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  403,
			ExpectedContent: []string{`"status":403`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}
