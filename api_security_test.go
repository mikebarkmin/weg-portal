package portal

import (
	"net/http"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// Explicit security probes for the plan.md "Security" table: expand
// probing and the protected issue photos. The location probes live in
// api_issue_locations_test.go.
func TestIssuesExpandProbing(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:               "resident expand cannot reach issue_metas from a list",
			Method:             http.MethodGet,
			URL:                "/api/collections/issues/records?expand=issue_metas",
			Headers:            authHeader(t, emailResident),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     200,
			ExpectedContent:    []string{`"totalItems":3`},
			NotExpectedContent: []string{"submitter@example.com", "Max Mustermann"},
		},
		{
			Name:               "resident expand cannot reach issue_metas from a view",
			Method:             http.MethodGet,
			URL:                "/api/collections/issues/records/issueocom000001?expand=issue_metas",
			Headers:            authHeader(t, emailResident),
			TestAppFactory:     setupTestApp,
			ExpectedStatus:     200,
			ExpectedContent:    []string{`"Kaputte Gartenbank"`},
			NotExpectedContent: []string{"submitter@example.com", "Max Mustermann"},
		},
		{
			Name:            "beirat expand of the related issue still works (metas side)",
			Method:          http.MethodGet,
			URL:             "/api/collections/issue_metas/records/imetapcom000001?expand=issue",
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

// Protected file access (issues.photos is a protected file field):
// without a file token nobody gets the file, and the file token inherits
// the view rule of the authenticated identity.
func TestIssuesProtectedPhotos(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "guest without token",
			Method:          http.MethodGet,
			URL:             "/api/files/issues/issueocom000001/" + fixturePhotoName(t, "issueocom000001"),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "resident: Authorization header alone is not enough",
			Method:          http.MethodGet,
			URL:             "/api/files/issues/issueocom000001/" + fixturePhotoName(t, "issueocom000001"),
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "resident file token can read community issue photo",
			Method:          http.MethodGet,
			URL:             "/api/files/issues/issueocom000001/" + fixturePhotoName(t, "issueocom000001") + "?token=" + getFileToken(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{"\x89PNG"},
		},
		{
			Name:            "resident file token cannot read private issue photo",
			Method:          http.MethodGet,
			URL:             "/api/files/issues/issueoprv000001/" + fixturePhotoName(t, "issueoprv000001") + "?token=" + getFileToken(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "resident file token cannot read pending issue photo",
			Method:          http.MethodGet,
			URL:             "/api/files/issues/issuepcom000001/" + fixturePhotoName(t, "issuepcom000001") + "?token=" + getFileToken(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  404,
			ExpectedContent: []string{`"status":404`},
		},
		{
			Name:            "beirat file token can read the private issue photo",
			Method:          http.MethodGet,
			URL:             "/api/files/issues/issueoprv000001/" + fixturePhotoName(t, "issueoprv000001") + "?token=" + getFileToken(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{"\x89PNG"},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func urlEncode(s string) string {
	const hex = "0123456789ABCDEF"
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~' {
			out = append(out, c)
			continue
		}
		out = append(out, '%', hex[c>>4], hex[c&0x0f])
	}
	return string(out)
}
