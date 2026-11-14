// fixturegen (re)builds the test fixture database in test_pb_data/ used by
// the api_*_test.go role-matrix tests.
//
// Usage:
//
//	go run ./fixturegen
//
// The script wipes and recreates test_pb_data/ from scratch: it applies all
// migrations (PB core + app migrations) and seeds one deterministic record set
// (fixed record ids so that tests can reference them). See test_pb_data/README.md.
package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	_ "ganigeorgiev.com/pocketbase/pocketbase/migrations" // PB core migrations
	"ganigeorgiev.com/pocketbase/pocketbase/tools/filesystem"

	_ "weg-portal/migrations" // app migrations
)

const (
	dataDir = "./test_pb_data"

	// passwords of all fixture users (documented in test_pb_data/README.md)
	fixturePassword = "passwort123"

	// issue areas (issue_areas)
	areaHouse    = "areahouse790000" // house with floors, no plan
	areaBasement = "areakeller00000" // shared area with a plan
	areaInactive = "areainactive000" // retired area
)

// tiny 1x1 transparent PNG used as the fixture issue photo
var fixturePNG = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
	0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
	0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
	0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0, 0x00, 0x00, 0x00,
	0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
}

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	// the hand-written docs in the directory survive the reset
	docs := map[string][]byte{}
	if matches, err := filepath.Glob(filepath.Join(dataDir, "*.md")); err == nil {
		for _, path := range matches {
			if content, err := os.ReadFile(path); err == nil {
				docs[path] = content
			}
		}
	}

	if err := os.RemoveAll(dataDir); err != nil {
		return fmt.Errorf("failed to reset %s: %w", dataDir, err)
	}
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return err
	}
	for path, content := range docs {
		if err := os.WriteFile(path, content, 0o644); err != nil {
			return err
		}
	}

	app := core.NewBaseApp(core.BaseAppConfig{
		DataDir: dataDir,
	})
	if err := app.Bootstrap(); err != nil {
		return err
	}
	defer app.ResetBootstrapState()

	// apply PB core + app migrations
	runner := core.NewMigrationsRunner(app, core.AppMigrations)
	if _, err := runner.Up(); err != nil {
		return err
	}

	// -------------------------------------------------------------------
	// settings: disable rate limits (tests hammer the API from localhost)
	// -------------------------------------------------------------------

	settings := app.Settings()
	settings.RateLimits.Enabled = false
	if err := app.Save(settings); err != nil {
		return err
	}

	// -------------------------------------------------------------------
	// superuser
	// -------------------------------------------------------------------

	superusers, err := app.FindCollectionByNameOrId("_superusers")
	if err != nil {
		return err
	}
	superuser := core.NewRecord(superusers)
	superuser.Set("email", "super@portal.test")
	superuser.SetPassword(fixturePassword)
	if err := app.Save(superuser); err != nil {
		return err
	}

	// -------------------------------------------------------------------
	// users (one per role)
	// -------------------------------------------------------------------

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}

	beirat := createUser(app, users, "userbeirat00000", "beirat@portal.test", "beirat", true)
	createUser(app, users, "userunapproved0", "unapproved@portal.test", "resident", false)
	createUser(app, users, "userresident000", "resident@portal.test", "resident", true)
	hm := createUser(app, users, "userhausmeister", "hm@portal.test", "hausmeister", true)
	createUser(app, users, "userhausverwalt", "hv@portal.test", "hausverwaltung", true)
	createUser(app, users, "useradmin000000", "admin@portal.test", "admin", true)

	// the hausmeister opts into new-issue mails (the hausverwaltung does
	// not, so both branches of the notify_new_issues flag are testable)
	hm.Set("notify_new_issues", true)
	if err := app.Save(hm); err != nil {
		log.Fatal("hm notify_new_issues: " + err.Error())
	}

	// -------------------------------------------------------------------
	// events
	// -------------------------------------------------------------------

	events, err := app.FindCollectionByNameOrId("events")
	if err != nil {
		return err
	}

	eventSimple := core.NewRecord(events)
	eventSimple.Set("id", "eventsimple0001")
	eventSimple.Set("calendar", "public")
	eventSimple.Set("title", "Herbstputz")
	eventSimple.Set("description", "Putzen des gemeinsamen Kellerflurs.")
	eventSimple.Set("date_start", "2026-12-01 18:00:00.000Z")
	eventSimple.Set("date_end", "2026-12-01 20:00:00.000Z")
	eventSimple.Set("location", "Keller")
	eventSimple.Set("category", "putzen")
	if err := app.Save(eventSimple); err != nil {
		return err
	}

	eventRecurring := core.NewRecord(events)
	eventRecurring.Set("id", "eventrecurring1")
	eventRecurring.Set("calendar", "public")
	eventRecurring.Set("title", "Muellplan leer?")
	eventRecurring.Set("description", "Taegliche Kontrolle der Muelltonnen.")
	eventRecurring.Set("date_start", "2026-11-01 08:00:00.000Z")
	eventRecurring.Set("all_day", true)
	eventRecurring.Set("category", "muell")
	eventRecurring.Set("rrule", "FREQ=DAILY;COUNT=30")
	if err := app.Save(eventRecurring); err != nil {
		return err
	}

	// single all-day event without date_end (iCal: DTSTART;VALUE=DATE,
	// no DTEND)
	eventAllDaySingle := core.NewRecord(events)
	eventAllDaySingle.Set("id", "eventallday0001")
	eventAllDaySingle.Set("calendar", "public")
	eventAllDaySingle.Set("title", "Gartenfest")
	eventAllDaySingle.Set("description", "Gemeinsames Fest im Garten.")
	eventAllDaySingle.Set("date_start", "2026-07-04 00:00:00.000Z")
	eventAllDaySingle.Set("all_day", true)
	eventAllDaySingle.Set("location", "Garten")
	eventAllDaySingle.Set("category", "fest")
	if err := app.Save(eventAllDaySingle); err != nil {
		return err
	}

	// all-day event spanning multiple days (iCal: VALUE=DATE with an
	// exclusive DTEND = stored date_end + 1 day, matching the inclusive
	// display of the SPA)
	eventAllDayMulti := core.NewRecord(events)
	eventAllDayMulti.Set("id", "eventallday0002")
	eventAllDayMulti.Set("calendar", "public")
	eventAllDayMulti.Set("title", "Fassadenreinigung")
	eventAllDayMulti.Set("description", "Geruest steht, Zugaenge begrenzt.")
	eventAllDayMulti.Set("date_start", "2026-08-14 00:00:00.000Z")
	eventAllDayMulti.Set("date_end", "2026-08-16 00:00:00.000Z")
	eventAllDayMulti.Set("all_day", true)
	eventAllDayMulti.Set("location", "Haus A")
	eventAllDayMulti.Set("category", "wartung")
	if err := app.Save(eventAllDayMulti); err != nil {
		return err
	}

	// event with RFC 5545 escapable characters (comma, semicolon,
	// backslash, newline) and a long description (iCal line folding)
	eventEscaping := core.NewRecord(events)
	eventEscaping.Set("id", "eventescapes001")
	eventEscaping.Set("calendar", "public")
	eventEscaping.Set("title", "Keller, Waschkeller; 2. OG")
	eventEscaping.Set("description", "Der Keller, die Waschkueche sowie das 2. OG muessen geputzt werden. Beachtet die Hinweise am schwarzen Brett, den Plan im Ordner \\Gemeinschaft; Muelleimer vorher ausleeren.\nFragen an den Beirat.")
	eventEscaping.Set("date_start", "2026-09-12 09:00:00.000Z")
	eventEscaping.Set("date_end", "2026-09-12 12:00:00.000Z")
	eventEscaping.Set("location", "Keller; neben dem Fahrstuhl, 1. OG")
	eventEscaping.Set("category", "putzen")
	if err := app.Save(eventEscaping); err != nil {
		return err
	}

	// -------------------------------------------------------------------
	// suggestions (one per status)
	// -------------------------------------------------------------------

	suggestions, err := app.FindCollectionByNameOrId("suggestions")
	if err != nil {
		return err
	}

	suggestionPending := core.NewRecord(suggestions)
	suggestionPending.Set("id", "suggpending0001")
	suggestionPending.Set("title", "Vorschlag Sommerfest")
	suggestionPending.Set("description", "Ein Sommerfest im Innenhof.")
	suggestionPending.Set("date_start", "2027-06-20 15:00:00.000Z")
	suggestionPending.Set("email", "submitter@example.com")
	suggestionPending.Set("status", "pending")
	if err := app.Save(suggestionPending); err != nil {
		return err
	}

	suggestionAccepted := core.NewRecord(suggestions)
	suggestionAccepted.Set("id", "suggaccepted001")
	suggestionAccepted.Set("title", "Vorschlag Weihnachtsmarkt")
	suggestionAccepted.Set("description", "Ein kleiner Weihnachtsmarkt.")
	suggestionAccepted.Set("date_start", "2026-12-20 15:00:00.000Z")
	suggestionAccepted.Set("email", "submitter@example.com")
	suggestionAccepted.Set("status", "accepted")
	suggestionAccepted.Set("decided_at", "2026-11-01 10:00:00.000Z")
	if err := app.Save(suggestionAccepted); err != nil {
		return err
	}

	suggestionRejected := core.NewRecord(suggestions)
	suggestionRejected.Set("id", "suggrejected001")
	suggestionRejected.Set("title", "Vorschlag laterne")
	suggestionRejected.Set("description", "Laterne im Garten aufstellen.")
	suggestionRejected.Set("date_start", "2026-12-06 18:00:00.000Z")
	suggestionRejected.Set("email", "submitter@example.com")
	suggestionRejected.Set("status", "rejected")
	suggestionRejected.Set("decision_note", "Kein Budget.")
	suggestionRejected.Set("decided_at", "2026-11-01 10:00:00.000Z")
	if err := app.Save(suggestionRejected); err != nil {
		return err
	}

	// -------------------------------------------------------------------
	// issues: each status x visibility + metas + one photo each
	// -------------------------------------------------------------------

	issues, err := app.FindCollectionByNameOrId("issues")
	if err != nil {
		return err
	}
	issueMetas, err := app.FindCollectionByNameOrId("issue_metas")
	if err != nil {
		return err
	}
	issueAreas, err := app.FindCollectionByNameOrId("issue_areas")
	if err != nil {
		return err
	}
	issueLocations, err := app.FindCollectionByNameOrId("issue_locations")
	if err != nil {
		return err
	}

	for i, f := range []struct {
		id     string
		name   string
		floors []string
		plan   bool
		active bool
	}{
		{areaHouse, "Haus 79", []string{"EG", "1. OG", "2. OG"}, false, true},
		{areaBasement, "Keller", []string{}, true, true},
		{areaInactive, "Alter Bereich", []string{}, false, false},
	} {
		area := core.NewRecord(issueAreas)
		area.Set("id", f.id)
		area.Set("name", f.name)
		area.Set("floors", f.floors)
		area.Set("sort", i+1)
		area.Set("active", f.active)
		if f.plan {
			plan, err := filesystem.NewFileFromBytes(fixturePNG, "plan.png")
			if err != nil {
				return err
			}
			area.Set("plan", plan)
		}
		if err := app.Save(area); err != nil {
			return err
		}
	}

	// id suffix -> [status, visibility, title]
	issueFixtures := []struct {
		id         string
		status     string
		visibility string
		title      string
	}{
		{"issuepcom000001", "pending", "community", "Defekte Laterne"},
		{"issuepprv000001", "pending", "private", "Unbekannte Person im Kellerflur"},
		{"issueocom000001", "open", "community", "Kaputte Gartenbank"},
		{"issueoprv000001", "open", "private", "Privater Parkplatz belegt"},
		{"issueicom000001", "in_progress", "community", "Lampe im Treppenhaus defekt"},
		{"issueiprv000001", "in_progress", "private", "Ruempelnder Nachbar"},
		{"issuercom000001", "resolved", "community", "Brunnen repariert"},
		{"issuerprv000001", "resolved", "private", "Beschwerde zurueckgezogen"},
		{"issueacom000001", "archived", "community", "Alte Meldung (archiviert)"},
		{"issuejcom000001", "rejected", "community", "Zu viel Laub"},
		{"issuejprv000001", "rejected", "private", "Nachbarstreit"},
	}

	for _, f := range issueFixtures {
		issue := core.NewRecord(issues)
		issue.Set("id", f.id)
		issue.Set("title", f.title)
		issue.Set("description", "Fixture issue description for tests.")
		issue.Set("category", "test")
		issue.Set("status", f.status)
		issue.Set("visibility", f.visibility)
		switch f.status {
		case "open", "in_progress", "resolved", "archived":
			issue.Set("decided_at", "2026-11-01 10:00:00.000Z")
		case "rejected":
			issue.Set("decided_at", "2026-11-01 10:00:00.000Z")
		}
		if f.status == "resolved" || f.status == "archived" {
			issue.Set("resolved_at", "2026-11-10 12:00:00.000Z")
		}
		if err := app.Save(issue); err != nil {
			return err
		}

		// meta record with the submitter email
		meta := core.NewRecord(issueMetas)
		meta.Set("id", "imeta"+f.id[5:])
		meta.Set("issue", f.id)
		meta.Set("email", "submitter@example.com")
		meta.Set("name", "Max Mustermann")
		// two reports were submitted by the resident account (the reporter
		// sees their own location — and their own archived entry in
		// "Meine Einreichungen")
		if f.id == "issueiprv000001" || f.id == "issueacom000001" {
			meta.Set("user", "userresident000")
		}
		if err := app.Save(meta); err != nil {
			return err
		}

		// location: community issues in the house (floor, no pin), private
		// ones in the basement with a pin. Shared with staff: the pending
		// and the open issues (the pending ones must stay invisible to
		// staff anyway), not the others.
		location := core.NewRecord(issueLocations)
		// same id as the issue (as the submission route does)
		location.Set("id", f.id)
		location.Set("issue", f.id)
		if f.visibility == "community" {
			location.Set("area", areaHouse)
			location.Set("floor", "1. OG")
		} else {
			location.Set("area", areaBasement)
			location.Set("has_pin", true)
			location.Set("x", 0.25)
			location.Set("y", 0.75)
		}
		location.Set("shared", f.status == "pending" || f.status == "open")
		if err := app.Save(location); err != nil {
			return err
		}

		// one photo per issue (set as filesystem.File so PocketBase
		// validates and stores it like an uploaded file)
		photo, err := filesystem.NewFileFromBytes(fixturePNG, "photo.png")
		if err != nil {
			return err
		}
		issue.Set("photos", []*filesystem.File{photo})
		if err := app.Save(issue); err != nil {
			return err
		}
	}

	// pending issues keep their visibility value only as the fixture's
	// documentation of the decision; the field is what the beirat will set
	// on accept, hidden records stay invisible to residents by status rules.

	// -------------------------------------------------------------------
	// notes
	// -------------------------------------------------------------------

	notes, err := app.FindCollectionByNameOrId("notes")
	if err != nil {
		return err
	}

	noteNormal := core.NewRecord(notes)
	noteNormal.Set("id", "notesnormal0001")
	noteNormal.Set("title", "Sonstiges")
	noteNormal.Set("body", "Dies ist eine **interne** Notiz.")
	noteNormal.Set("author", beirat.Id)
	if err := app.Save(noteNormal); err != nil {
		return err
	}

	notePinned := core.NewRecord(notes)
	notePinned.Set("id", "notespinned0001")
	notePinned.Set("title", "Wichtig")
	notePinned.Set("body", "Hausmeister ab Maerz neu.")
	notePinned.Set("author", beirat.Id)
	notePinned.Set("pinned", true)
	if err := app.Save(notePinned); err != nil {
		return err
	}

	return seedOwnerPortal(app, events, "userresident000", beirat.Id)
}

func createUser(app core.App, users *core.Collection, id, email, role string, approved bool) *core.Record {
	user := core.NewRecord(users)
	user.Set("id", id)
	user.Set("email", email)
	user.Set("emailVisibility", true)
	user.Set("name", email)
	user.Set("role", role)
	user.Set("approved", approved)
	user.Set("verified", true)
	user.SetPassword(fixturePassword)
	if err := app.Save(user); err != nil {
		log.Fatal(email + ": " + err.Error())
	}
	return user
}
