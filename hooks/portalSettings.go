package hooks

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// PortalSettings keeps the portal_settings collection a single-record
// collection (plan.md "Retention"): the retention cron depends on
// exactly one record existing, with no hard-coded fallback.
//
// The collection rules are all null (superuser only), so the hooks below
// are the last guard and apply to superusers as well:
//   - creating a record is rejected while one already exists;
//   - deleting the record is always rejected
//     (a fresh install with zero records may create the initial one).
func PortalSettings(app core.App) {
	app.OnRecordCreateRequest("portal_settings").BindFunc(func(e *core.RecordRequestEvent) error {
		total, err := e.App.CountRecords("portal_settings")
		if err != nil {
			return e.BadRequestError("Failed to verify the settings record.", err)
		}

		if total > 0 {
			return e.BadRequestError("Only a single portal_settings record is allowed.", nil)
		}

		return e.Next()
	})

	app.OnRecordDeleteRequest("portal_settings").BindFunc(func(e *core.RecordRequestEvent) error {
		return e.BadRequestError("The portal_settings record cannot be deleted.", nil)
	})
}
