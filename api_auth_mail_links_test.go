package portal

import (
	"strings"
	"testing"

	"weg-portal/migrations"
)

// The account mails link into the SPA: PocketBase's default /_/#/auth/...
// pages sit behind Caddy's basic auth in production (deploy/Caddyfile).
func TestAuthMailLinksPointIntoSPA(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}

	cases := map[string]struct {
		body string
		link string
	}{
		"verification": {users.VerificationTemplate.Body, migrations.AuthLinkVerify},
		"reset":        {users.ResetPasswordTemplate.Body, migrations.AuthLinkReset},
		"email change": {users.ConfirmEmailChangeTemplate.Body, migrations.AuthLinkEmailChange},
	}
	for name, c := range cases {
		if strings.Contains(c.body, "/_/") {
			t.Errorf("%s mail still links to the admin UI:\n%s", name, c.body)
		}
		if !strings.Contains(c.body, "{APP_URL}"+c.link+"{TOKEN}") {
			t.Errorf("%s mail lacks the SPA link %q:\n%s", name, c.link, c.body)
		}
	}
}
