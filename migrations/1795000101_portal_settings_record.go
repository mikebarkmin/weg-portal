package migrations

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	m "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

// inserts the single portal_settings record with the plan.md defaults
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("portal_settings")
		if err != nil {
			return err
		}

		record := core.NewRecord(collection)
		record.Set("id", "portsettings000")
		record.Set("retention_suggestions_rejected_days", 90)
		record.Set("retention_suggestions_accepted_days", 90)
		record.Set("retention_issues_rejected_days", 90)
		record.Set("retention_issues_resolved_days", 365)

		return app.Save(record)
	}, nil)
}
