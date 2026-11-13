package hooks

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// IssueEnrich unhides the exact issue coordinates (lat_exact/lng_exact) for
// beirat, hausmeister and hausverwaltung (plan.md "Issue read rule").
//
// The fields are marked as Hidden in the schema, which removes them from
// every response and filter for all other identities. Enrich runs for the
// regular API responses and for realtime events, so subscriptions are
// covered by the same logic.
func IssueEnrich(app core.App) {
	app.OnRecordEnrich().BindFunc(func(e *core.RecordEnrichEvent) error {
		if e.Record.Collection().Name != "issues" {
			return e.Next()
		}

		if e.RequestInfo == nil || e.RequestInfo.Auth == nil {
			return e.Next()
		}

		switch e.RequestInfo.Auth.GetString("role") {
		case "beirat", "hausmeister", "hausverwaltung":
			e.Record.Unhide("lat_exact", "lng_exact")
		}

		return e.Next()
	})
}
