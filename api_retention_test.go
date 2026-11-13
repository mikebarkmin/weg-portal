package portal

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/filesystem"

	"weg-portal/hooks"
)

// fixed reference time for the boundary assertions (hooks.RunRetentionAt)
var retentionNow = time.Date(2027, 6, 1, 12, 0, 0, 0, time.UTC)

// fixture photo bytes (1x1 transparent PNG, same as fixturegen)
var retentionPNG = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
	0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
	0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
	0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0, 0x00, 0x00, 0x00,
	0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
}

// runRetentionCron invokes the registered daily retention cron job
// directly (the cron scheduler itself is not running under NewTestApp).
func runRetentionCron(app *tests.TestApp) {
	for _, job := range app.Cron().Jobs() {
		if job.Id() == "retentionCleanup" {
			job.Run()
			return
		}
	}
	panic("retention cleanup cron job is not registered")
}

// createTestSuggestion saves a suggestion record with the given status and
// decision time (fixed id so the tests can reference it).
func createTestSuggestion(t testing.TB, app *tests.TestApp, id, status string, decided time.Time) {
	collection, err := app.FindCollectionByNameOrId("suggestions")
	if err != nil {
		t.Fatal(err)
	}

	record := core.NewRecord(collection)
	record.Set("id", id)
	record.Set("title", "Retention test suggestion "+id)
	record.Set("date_start", "2027-01-01 10:00:00.000Z")
	record.Set("email", "submitter@example.com")
	record.Set("status", status)
	if !decided.IsZero() {
		record.Set("decided_at", decided.UTC().Format("2006-01-02 15:04:05.000Z"))
	}
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
}

// createTestIssue saves an issue record with its issue_metas record and
// (optionally) one photo file, so cascade and file cleanup are testable.
func createTestIssue(t testing.TB, app *tests.TestApp, id, status string, decided, resolved time.Time, withPhoto bool) {
	issues, err := app.FindCollectionByNameOrId("issues")
	if err != nil {
		t.Fatal(err)
	}
	metas, err := app.FindCollectionByNameOrId("issue_metas")
	if err != nil {
		t.Fatal(err)
	}

	record := core.NewRecord(issues)
	record.Set("id", id)
	record.Set("title", "Retention test issue "+id)
	record.Set("description", "Retention test issue description.")
	record.Set("category", "test")
	record.Set("lat", 51.123)
	record.Set("lng", 7.456)
	record.Set("lat_exact", 51.1234)
	record.Set("lng_exact", 7.4567)
	record.Set("status", status)
	record.Set("visibility", "community")
	if !decided.IsZero() {
		record.Set("decided_at", decided.UTC().Format("2006-01-02 15:04:05.000Z"))
	}
	if !resolved.IsZero() {
		record.Set("resolved_at", resolved.UTC().Format("2006-01-02 15:04:05.000Z"))
	}
	if withPhoto {
		photo, err := filesystem.NewFileFromBytes(retentionPNG, "photo.png")
		if err != nil {
			t.Fatal(err)
		}
		record.Set("photos", []*filesystem.File{photo})
	}
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}

	meta := core.NewRecord(metas)
	meta.Set("issue", record.Id)
	meta.Set("email", "submitter@example.com")
	if err := app.Save(meta); err != nil {
		t.Fatal(err)
	}
}

// recordExists reports whether the collection still holds the record.
func recordExists(app *tests.TestApp, collection, id string) bool {
	_, err := app.FindRecordById(collection, id)
	return err == nil
}

// metaCountForIssue returns how many issue_metas records still belong to
// the issue (the cascade delete target).
func metaCountForIssue(app *tests.TestApp, issueId string) int {
	rows, err := app.FindAllRecords("issue_metas", dbx.HashExp{"issue": issueId})
	if err != nil {
		return -1
	}
	return len(rows)
}

func TestRetentionCronRegisteredDaily(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	for _, job := range app.Cron().Jobs() {
		if job.Id() != "retentionCleanup" {
			continue
		}
		if job.Expression() != "0 3 * * *" {
			t.Fatalf("expected the retention cron to run daily at 03:00, got %q", job.Expression())
		}
		return
	}
	t.Fatal("retention cleanup cron job is not registered")
}

// TestRetentionCronDeletesOldRecords invokes the registered cron job
// end-to-end (not a helper) with clearly out-of-retention and clearly
// in-retention records, so the whole cron wiring is covered.
func TestRetentionCronDeletesOldRecords(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	now := time.Now().UTC()

	// 400 days old rejected suggestion: far outside the 90 day period
	createTestSuggestion(t, app, "suggrejold00001", "rejected", now.Add(-400*24*time.Hour))
	// 10 days old rejected suggestion: far inside the 90 day period
	createTestSuggestion(t, app, "suggrejnew00001", "rejected", now.Add(-10*24*time.Hour))
	// 400 days old rejected issue: far outside the 90 day period
	createTestIssue(t, app, "issoldreje00001", "rejected", now.Add(-400*24*time.Hour), time.Time{}, false)
	// 100 days old resolved issue: far inside the 365 day period
	createTestIssue(t, app, "issresnew000001", "resolved", now.Add(-100*24*time.Hour), now.Add(-100*24*time.Hour), false)

	runRetentionCron(app)

	if recordExists(app, "suggestions", "suggrejold00001") {
		t.Error("expected the 400 days old rejected suggestion to be deleted")
	}
	if !recordExists(app, "suggestions", "suggrejnew00001") {
		t.Error("expected the 10 days old rejected suggestion to be kept")
	}
	if recordExists(app, "issues", "issoldreje00001") {
		t.Error("expected the 400 days old rejected issue to be deleted")
	}
	if !recordExists(app, "issues", "issresnew000001") {
		t.Error("expected the 100 days old resolved issue to be kept")
	}
}

// TestRetentionPeriodBoundaries checks the exact retention thresholds per
// category against a fixed clock: a record exactly at the threshold
// (now - retention days) is kept, a record one second older is deleted.
func TestRetentionPeriodBoundaries(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	day := 24 * time.Hour

	// fixture defaults (plan.md): rejected/accepted suggestions 90 days,
	// rejected issues 90 days, resolved issues 365 days
	cases := []struct {
		label      string
		createGone func()
		createKept func()
		goneId     string
		keptId     string
		collection string
	}{
		{
			label:      "suggestions rejected (90 days)",
			collection: "suggestions",
			goneId:     "suggrejdeep0001",
			keptId:     "suggrejedge0001",
			createGone: func() {
				createTestSuggestion(t, app, "suggrejdeep0001", "rejected", retentionNow.Add(-90*day-1*time.Second))
			},
			createKept: func() {
				createTestSuggestion(t, app, "suggrejedge0001", "rejected", retentionNow.Add(-90*day))
			},
		},
		{
			label:      "suggestions accepted (90 days)",
			collection: "suggestions",
			goneId:     "suggaccdeep0001",
			keptId:     "suggaccedge0001",
			createGone: func() {
				createTestSuggestion(t, app, "suggaccdeep0001", "accepted", retentionNow.Add(-90*day-1*time.Second))
			},
			createKept: func() {
				createTestSuggestion(t, app, "suggaccedge0001", "accepted", retentionNow.Add(-90*day))
			},
		},
		{
			label:      "issues rejected (90 days, after decided_at)",
			collection: "issues",
			goneId:     "issrejdeep00001",
			keptId:     "issrejedge00001",
			createGone: func() {
				createTestIssue(t, app, "issrejdeep00001", "rejected", retentionNow.Add(-90*day-1*time.Second), time.Time{}, false)
			},
			createKept: func() {
				createTestIssue(t, app, "issrejedge00001", "rejected", retentionNow.Add(-90*day), time.Time{}, false)
			},
		},
		{
			label:      "issues resolved (365 days, after resolved_at)",
			collection: "issues",
			goneId:     "issresdeep00001",
			keptId:     "issresedge00001",
			createGone: func() {
				createTestIssue(t, app, "issresdeep00001", "resolved", retentionNow.Add(-366*day), retentionNow.Add(-365*day-1*time.Second), false)
			},
			createKept: func() {
				createTestIssue(t, app, "issresedge00001", "resolved", retentionNow.Add(-400*day), retentionNow.Add(-365*day), false)
			},
		},
	}

	for _, c := range cases {
		// a decided long ago but resolved exactly at the threshold keeps
		// the record: resolved_at, not decided_at, is what counts for
		// resolved issues (and vice versa for rejected ones)
		c.createGone()
		c.createKept()
	}

	hooks.RunRetentionAt(app, retentionNow)

	for _, c := range cases {
		if recordExists(app, c.collection, c.goneId) {
			t.Errorf("%s: expected record %s (one second past the threshold) to be deleted", c.label, c.goneId)
		}
		if !recordExists(app, c.collection, c.keptId) {
			t.Errorf("%s: expected record %s (exactly at the threshold) to be kept", c.label, c.keptId)
		}
	}
}

// TestRetentionPendingNeverDeleted proves that pending items stay in the
// moderation queue even with an old (bogus legacy) decided_at and old
// resolved_at values, i.e. only the four deleted categories are touched.
func TestRetentionPendingNeverDeleted(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	day := 24 * time.Hour

	// fixture pending records (no timestamps)
	if !recordExists(app, "suggestions", "suggpending0001") {
		t.Fatal("fixture pending suggestion is missing")
	}
	if !recordExists(app, "issues", "issuepcom000001") {
		t.Fatal("fixture pending issue is missing")
	}

	// pending records with bogus old timestamps (never set by the
	// workflow hooks - the status alone must protect them)
	createTestSuggestion(t, app, "suggpendhist001", "pending", retentionNow.Add(-400*day))
	createTestIssue(t, app, "issuependhist01", "pending", retentionNow.Add(-400*day), retentionNow.Add(-400*day), false)

	hooks.RunRetentionAt(app, retentionNow)

	for id, collection := range map[string]string{
		"suggpending0001": "suggestions",
		"issuepcom000001": "issues",
		"suggpendhist001": "suggestions",
		"issuependhist01": "issues",
	} {
		if !recordExists(app, collection, id) {
			t.Errorf("pending records must never be deleted, but %s was removed from %s", id, collection)
		}
	}
}

// TestRetentionIssueCascade verifies that deleting an issue also removes
// its issue_metas record (cascade delete) and its photo files.
func TestRetentionIssueCascade(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	day := 24 * time.Hour

	createTestIssue(t, app, "issueoldcase001", "rejected", retentionNow.Add(-400*day), time.Time{}, true)

	issue, err := app.FindRecordById("issues", "issueoldcase001")
	if err != nil {
		t.Fatal(err)
	}
	photoDir := filepath.Join(app.DataDir(), "storage", issue.BaseFilesPath())
	if _, err := os.Stat(photoDir); err != nil {
		t.Fatalf("expected the photo directory %s to exist before the cleanup: %v", photoDir, err)
	}
	if metaCountForIssue(app, issue.Id) != 1 {
		t.Fatal("expected the issue meta to exist before the cleanup")
	}

	hooks.RunRetentionAt(app, retentionNow)

	if recordExists(app, "issues", "issueoldcase001") {
		t.Fatal("expected the out-of-retention rejected issue to be deleted")
	}
	if metaCountForIssue(app, issue.Id) != 0 {
		t.Error("expected the cascade-deleted issue_metas record to be gone")
	}
	if _, err := os.Stat(photoDir); !os.IsNotExist(err) {
		t.Errorf("expected the photo directory %s to be removed with the record, got %v", photoDir, err)
	}
}

// TestRetentionSettingsChangeAppliedOnNextRun proves that the periods are
// re-read from portal_settings on every run: shortening a period deletes
// additional records on the next run, also shortening a period cannot
// delete anything below the new limit, while other categories keep
// their own periods.
func TestRetentionSettingsChangeAppliedOnNextRun(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	day := 24 * time.Hour

	// 30 days old rejected suggestion: inside the default 90 days
	createTestSuggestion(t, app, "suggrejmiddle01", "rejected", retentionNow.Add(-30*day))

	hooks.RunRetentionAt(app, retentionNow)
	if !recordExists(app, "suggestions", "suggrejmiddle01") {
		t.Fatal("expected the 30 days old rejected suggestion to be kept under the default 90 day period")
	}

	// a superuser shortens the period in /_/ (rules are null, but the
	// test app writes directly to the DB just like /_/ does)
	settings, err := app.FindRecordById("portal_settings", "portsettings000")
	if err != nil {
		t.Fatal(err)
	}
	settings.Set("retention_suggestions_rejected_days", 20)
	if err := app.Save(settings); err != nil {
		t.Fatal(err)
	}

	hooks.RunRetentionAt(app, retentionNow)
	if recordExists(app, "suggestions", "suggrejmiddle01") {
		t.Error("expected the reduced 20 day period to delete the 30 days old rejected suggestion on the next run")
	}

	// the accepted-suggestion period is untouched: a 30 days old accepted
	// suggestion must still be kept
	createTestSuggestion(t, app, "suggaccmiddle01", "accepted", retentionNow.Add(-30*day))
	hooks.RunRetentionAt(app, retentionNow)
	if !recordExists(app, "suggestions", "suggaccmiddle01") {
		t.Error("the accepted-suggestion period must still be 90 days after shortening only the rejected one")
	}
}

// TestRetentionMissingSettingsDeletesNothing proves the no-fallback
// behavior: with the portal_settings record gone, nothing is deleted,
// not even records far outside their default periods.
func TestRetentionMissingSettingsDeletesNothing(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	day := 24 * time.Hour

	createTestSuggestion(t, app, "suggrejancien01", "rejected", retentionNow.Add(-4000*day))
	createTestIssue(t, app, "issrejancien001", "rejected", retentionNow.Add(-4000*day), time.Time{}, true)
	createTestIssue(t, app, "issresancien001", "resolved", retentionNow.Add(-4000*day), retentionNow.Add(-4000*day), true)

	settings, err := app.FindRecordById("portal_settings", "portsettings000")
	if err != nil {
		t.Fatal(err)
	}
	// note: removing the settings record via app.Delete bypasses the
	// request-level portal_settings hook on purpose (it simulates a
	// corrupted/dropped record, not an API delete)
	if err := app.Delete(settings); err != nil {
		t.Fatal(err)
	}

	// the fixed-clock seam AND the registered cron job must both behave
	// the same way
	hooks.RunRetentionAt(app, retentionNow)
	runRetentionCron(app)

	for id, collection := range map[string]string{
		"suggrejancien01": "suggestions",
		"issrejancien001": "issues",
		"issresancien001": "issues",
	} {
		if !recordExists(app, collection, id) {
			t.Errorf("with the portal_settings record missing nothing must be deleted, but %s was removed from %s", id, collection)
		}
	}
}
