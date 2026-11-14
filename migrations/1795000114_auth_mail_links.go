package migrations

import (
	"strings"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	m "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

// Account mails (verification, password reset, email change) link into the
// SPA instead of PocketBase's default /_/#/auth/... pages: in production
// /_/ sits behind Caddy's basic auth (deploy/Caddyfile), so residents could
// never open the default links. The SPA pages call the matching
// confirm* endpoints of the users collection.
//
// Only templates still pointing at /_/ are replaced, so texts a superuser
// already customised in /_/ are kept.
const (
	AuthLinkVerify      = "/konto/bestaetigen/"
	AuthLinkReset       = "/konto/passwort-neu/"
	AuthLinkEmailChange = "/konto/email-bestaetigen/"
)

func authMail(intro, link, button, outro string) string {
	return `<p>Hallo,</p>
<p>` + intro + `</p>
<p>
  <a class="btn" href="` + core.EmailPlaceholderAppURL + link + core.EmailPlaceholderToken + `" target="_blank" rel="noopener">` + button + `</a>
</p>
<p><i>` + outro + `</i></p>
<p>
  Viele Grüße<br/>
  ` + core.EmailPlaceholderAppName + `
</p>`
}

func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}

		usesAdminUI := func(t core.EmailTemplate) bool {
			return strings.Contains(t.Body, "/_/#/auth/")
		}

		if usesAdminUI(users.VerificationTemplate) {
			users.VerificationTemplate = core.EmailTemplate{
				Subject: "E-Mail-Adresse bestätigen – " + core.EmailPlaceholderAppName,
				Body: authMail(
					"bitte bestätigen Sie Ihre E-Mail-Adresse für das "+core.EmailPlaceholderAppName+".",
					AuthLinkVerify, "E-Mail-Adresse bestätigen",
					"Falls Sie sich nicht registriert haben, können Sie diese E-Mail ignorieren.",
				),
			}
		}
		if usesAdminUI(users.ResetPasswordTemplate) {
			users.ResetPasswordTemplate = core.EmailTemplate{
				Subject: "Neues Passwort festlegen – " + core.EmailPlaceholderAppName,
				Body: authMail(
					"über den folgenden Link können Sie ein neues Passwort festlegen. Der Link ist nur kurze Zeit gültig.",
					AuthLinkReset, "Neues Passwort festlegen",
					"Falls Sie kein neues Passwort angefordert haben, können Sie diese E-Mail ignorieren – Ihr bisheriges Passwort bleibt gültig.",
				),
			}
		}
		if usesAdminUI(users.ConfirmEmailChangeTemplate) {
			users.ConfirmEmailChangeTemplate = core.EmailTemplate{
				Subject: "Neue E-Mail-Adresse bestätigen – " + core.EmailPlaceholderAppName,
				Body: authMail(
					"bitte bestätigen Sie Ihre neue E-Mail-Adresse.",
					AuthLinkEmailChange, "Neue E-Mail-Adresse bestätigen",
					"Falls Sie keine Änderung angefordert haben, können Sie diese E-Mail ignorieren.",
				),
			}
		}

		return app.Save(users)
	}, nil)
}
