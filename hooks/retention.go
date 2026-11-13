package hooks

import (
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// retentionCronId is the app.Cron() job identifier of the daily cleanup.
const retentionCronId = "retentionCleanup"

// Retention registers the daily retention cleanup cron job
// (plan.md "Retention").
//
// The schedule itself (03:00 UTC) only decides WHEN the cleanup runs; all
// retention periods are read from the portal_settings record on EVERY run,
// so changes made by a superuser in /_/ apply from the next run without a
// restart. There are deliberately NO hard-coded fallback periods: if the
// portal_settings record is missing or unreadable, the run logs an error
// and deletes NOTHING.
func Retention(app core.App) {
	// note: MustAdd panics only on an invalid cron expression, which is a
	// static programming error, not a runtime condition
	app.Cron().MustAdd(retentionCronId, "0 3 * * *", func() {
		RunRetentionAt(app, time.Now().UTC())
	})
}

// retentionSettingFields maps each cleanup category to its
// portal_settings field. Only these four statuses are ever cleaned up;
// everything in the moderation queue (status "pending") is never deleted.
var retentionSettingFields = []struct {
	collection string
	status     string
	timestamp  string // the "after <timestamp>" field from plan.md
	setting    string
}{
	{"suggestions", "rejected", "decided_at", "retention_suggestions_rejected_days"},
	{"suggestions", "accepted", "decided_at", "retention_suggestions_accepted_days"},
	{"issues", "rejected", "decided_at", "retention_issues_rejected_days"},
	{"issues", "resolved", "resolved_at", "retention_issues_resolved_days"},
}

// RunRetentionAt performs one retention cleanup run against the provided
// reference time. It is exported as the test seam: the cron job calls it
// with the current time, while the tests invoke it directly with a fixed
// clock for their boundary assertions.
func RunRetentionAt(app core.App, now time.Time) {
	settings, err := app.FindFirstRecordByFilter("portal_settings", "id != ''")
	if err != nil {
		app.Logger().Error(
			"retention: portal_settings record is missing or unreadable, nothing was deleted",
			"error", err,
		)
		return
	}

	// validate all periods BEFORE deleting anything: a partially
	// unreadable/garbage settings record must not lead to a partial
	// cleanup either
	days := make([]int, len(retentionSettingFields))
	for i, cat := range retentionSettingFields {
		days[i] = settings.GetInt(cat.setting)
		if days[i] < 1 {
			app.Logger().Error(
				"retention: invalid value in portal_settings, nothing was deleted",
				"field", cat.setting,
				"value", days[i],
			)
			return
		}
	}

	deleted := make(map[string]int)
	for i, cat := range retentionSettingFields {
		deleted[cat.collection+"/"+cat.status] = deleteRetentionCategory(
			app,
			cat.collection,
			cat.status,
			cat.timestamp,
			days[i],
			now,
		)
	}

	app.Logger().Info(
		"retention cleanup finished",
		"suggestions_rejected_deleted", deleted["suggestions/rejected"],
		"suggestions_accepted_deleted", deleted["suggestions/accepted"],
		"issues_rejected_deleted", deleted["issues/rejected"],
		"issues_resolved_deleted", deleted["issues/resolved"],
	)
}

// deleteRetentionCategory deletes all records of the given status whose
// decision/resolution timestamp is strictly older than days days and
// returns the number of deleted records.
//
// Deletion goes through app.Delete so record files (issue photos) and the
// cascade delete of the issue_metas records are handled by PocketBase.
func deleteRetentionCategory(app core.App, collection, status, timestamp string, days int, now time.Time) int {
	records, err := app.FindAllRecords(collection, dbx.HashExp{"status": status})
	if err != nil {
		app.Logger().Error(
			"retention: failed to load records, category skipped",
			"collection", collection,
			"status", status,
			"error", err,
		)
		return 0
	}

	// records whose retention period has not yet elapsed are kept; the
	// boundary value itself (exactly N days) is still kept, only strictly
	// older timestamps are deleted
	cutoff := now.Add(time.Duration(-days) * 24 * time.Hour)

	deleted := 0
	for _, record := range records {
		decided := record.GetDateTime(timestamp).Time()
		if decided.IsZero() {
			// no decision timestamp stored - never delete it silently
			// (can only happen with manually edited legacy data)
			continue
		}

		if !decided.Before(cutoff) {
			continue
		}

		if err := app.Delete(record); err != nil {
			app.Logger().Error(
				"retention: failed to delete record",
				"collection", collection,
				"id", record.Id,
				"error", err,
			)
			continue
		}
		deleted++
	}

	return deleted
}
