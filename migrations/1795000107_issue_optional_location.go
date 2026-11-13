package migrations

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	m "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

// The map point of an issue report is optional: lat/lng (and the exact
// pair) stay 0 when the submitter did not mark a location. 0/0 lies far
// outside every permitted community box, so it can never be a real point.
func init() {
	m.Register(func(app core.App) error {
		return setIssueLocationRequired(app, false)
	}, func(app core.App) error {
		return setIssueLocationRequired(app, true)
	})
}

func setIssueLocationRequired(app core.App, required bool) error {
	issues, err := app.FindCollectionByNameOrId("issues")
	if err != nil {
		return err
	}

	for _, name := range []string{"lat", "lng"} {
		field, ok := issues.Fields.GetByName(name).(*core.NumberField)
		if !ok {
			continue
		}
		field.Required = required
	}

	return app.Save(issues)
}
