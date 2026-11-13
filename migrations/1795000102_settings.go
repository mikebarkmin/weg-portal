package migrations

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	m "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		settings := app.Settings()

		settings.Meta.AppName = "WEG Portal"
		settings.Meta.HideControls = true
		settings.Meta.AccentColor = "#1055c9"

		// rate limits: PB defaults plus the public submission routes
		// (plan.md "Public submission routes", 5 requests / 10 min / IP)
		settings.RateLimits.Enabled = true
		settings.RateLimits.Rules = []core.RateLimitRule{
			{Label: "*:auth", MaxRequests: 2, Duration: 3},
			{Label: "*:create", MaxRequests: 20, Duration: 5},
			{Label: "/api/batch", MaxRequests: 3, Duration: 1},
			{Label: "/api/", MaxRequests: 300, Duration: 10},
			{Label: "POST /api/portal/issues", MaxRequests: 5, Duration: 600},
			// plain path labels do not match for the builtin collection record
			// routes (their global rate limit middleware is unbound in
			// apis/record_crud.go and only the "<collection>:<action>" tags are
			// scanned), hence the "suggestions:create" tag instead
			{Label: "suggestions:create", MaxRequests: 5, Duration: 600},
		}

		if err := app.Save(settings); err != nil {
			return err
		}

		// file token duration for the protected issues.photos files
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		users.FileToken.Duration = 300

		return app.Save(users)
	}, nil)
}
