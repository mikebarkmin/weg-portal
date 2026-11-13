package migrations

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	m "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

// Scheduled backups (plan.md "Architecture": "PocketBase built-in
// scheduled backups (consistent SQLite snapshot), uploaded to
// S3-compatible offsite storage").
//
// S3 offsite upload stays DISABLED here and is configured at deployment
// time (M11 compose env file / the /_/ dashboard by a superuser) - no
// credentials or other secrets belong in the repository. Until it is
// enabled there, the cron backups only accumulate locally in pb_data/
// (keeping at most CronMaxKeep = 5).
//
// "cronMaxKeep" below is NOT secret and is committed; the "s3" settings
// block is left at its zero value (enabled = false).
func init() {
	m.Register(func(app core.App) error {
		settings := app.Settings()

		settings.Backups.Cron = "0 2 * * *"
		settings.Backups.CronMaxKeep = 5

		return app.Save(settings)
	}, nil)
}
