package migrations

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	m "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

// Owner portal features (post-M12): accounts are for owners only, so
// "owners" visibility means "any approved account" (owners, Beirat,
// Hausmeister, Hausverwaltung). Adds:
//
//   - three calendars: events.calendar = public | owners | beirat
//   - announcements (Aushänge), contacts, documents
//   - issue_events (status history + internal staff notes)
//   - agenda_items (topics for the owners' meeting)
//   - polls + poll_votes (non-binding opinion polls)
//   - users: notify_announcements, notify_events, ical_token (hidden),
//     self-service deletion
//   - submitter account links on issue_metas.user and suggestions.user
func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		issues, err := app.FindCollectionByNameOrId("issues")
		if err != nil {
			return err
		}

		const (
			beirat   = "@request.auth.role = 'beirat'"
			approved = "@request.auth.id != \"\" && @request.auth.approved = true && @request.auth.verified = true"
			staff    = "(@request.auth.role = 'hausmeister' || @request.auth.role = 'hausverwaltung')"
		)

		// -----------------------------------------------------------------
		// users
		// -----------------------------------------------------------------
		users.Fields.Add(
			&core.BoolField{Name: "notify_announcements", Help: "Opt-in: mail about new announcements."},
			&core.BoolField{Name: "notify_events", Help: "Opt-in: mail about new calendar events (only calendars the user can see)."},
			&core.TextField{Name: "ical_token", Hidden: true, Max: 64, Help: "Secret for the personal iCal feed; managed by the portal, never returned."},
		)
		// owners may delete their own account (GDPR); a hook keeps
		// beirat/staff accounts superuser-managed
		users.DeleteRule = rule("@request.auth.id = id")
		if err := app.Save(users); err != nil {
			return err
		}

		// -----------------------------------------------------------------
		// events: three calendars
		// -----------------------------------------------------------------
		events, err := app.FindCollectionByNameOrId("events")
		if err != nil {
			return err
		}
		events.Fields.Add(&core.SelectField{
			Name:      "calendar",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"public", "owners", "beirat"},
			Help:      "public: everyone; owners: approved accounts; beirat: Beirat only.",
		})
		events.AddIndex("idx_events_calendar", false, "calendar", "")
		calendarRead := beirat + " || calendar = 'public' || (calendar = 'owners' && " + approved + ")"
		events.ListRule = rule(calendarRead)
		events.ViewRule = rule(calendarRead)
		if err := app.Save(events); err != nil {
			return err
		}
		if _, err := app.DB().NewQuery("UPDATE events SET calendar = 'public' WHERE calendar = '' OR calendar IS NULL").Execute(); err != nil {
			return err
		}

		// -----------------------------------------------------------------
		// suggestions: target calendar + submitting account
		// -----------------------------------------------------------------
		suggestions, err := app.FindCollectionByNameOrId("suggestions")
		if err != nil {
			return err
		}
		suggestions.Fields.Add(
			&core.SelectField{
				Name:      "calendar",
				MaxSelect: 1,
				Values:    []string{"public", "owners", "beirat"},
				Help:      "Calendar the accepted event goes to (set by the Beirat; public by default).",
			},
			&core.RelationField{
				Name:         "user",
				MaxSelect:    1,
				CollectionId: users.Id,
				Help:         "Submitting account, if logged in (set by the server).",
			},
		)
		suggestions.CreateRule = rule(
			"@request.body.status = 'pending' && @request.body.decision_note:isset = false" +
				" && @request.body.decided_at:isset = false && @request.body.user:isset = false" +
				" && @request.body.calendar:isset = false",
		)
		if err := app.Save(suggestions); err != nil {
			return err
		}

		issueMetas, err := app.FindCollectionByNameOrId("issue_metas")
		if err != nil {
			return err
		}
		issueMetas.Fields.Add(&core.RelationField{
			Name:         "user",
			MaxSelect:    1,
			CollectionId: users.Id,
			Help:         "Submitting account, if logged in (set by the submission route).",
		})
		if err := app.Save(issueMetas); err != nil {
			return err
		}

		// -----------------------------------------------------------------
		// announcements (Aushänge)
		// -----------------------------------------------------------------
		visibleRead := beirat + " || visibility = 'public' || (visibility = 'owners' && " + approved + ")"

		announcements := core.NewBaseCollection("announcements")
		announcements.Fields.Add(
			&core.TextField{Name: "title", Required: true, Max: 200},
			&core.TextField{Name: "body", Required: true, Max: 20000, Help: "Markdown."},
			&core.SelectField{Name: "visibility", Required: true, MaxSelect: 1, Values: []string{"public", "owners"}},
			&core.BoolField{Name: "pinned"},
			&core.DateField{Name: "expires_at", Help: "Optional: hidden for everyone but the Beirat afterwards."},
			&core.RelationField{Name: "author", Required: true, MaxSelect: 1, CollectionId: users.Id},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		announcementRead := beirat + " || ((visibility = 'public' || (visibility = 'owners' && " + approved + ")) && (expires_at = '' || expires_at > @now))"
		announcements.ListRule = rule(announcementRead)
		announcements.ViewRule = rule(announcementRead)
		announcements.CreateRule = rule(beirat + " && @request.body.author = @request.auth.id")
		announcements.UpdateRule = rule(beirat)
		announcements.DeleteRule = rule(beirat)
		if err := app.Save(announcements); err != nil {
			return err
		}

		// -----------------------------------------------------------------
		// contacts
		// -----------------------------------------------------------------
		contacts := core.NewBaseCollection("contacts")
		contacts.Fields.Add(
			&core.TextField{Name: "name", Required: true, Max: 200},
			&core.TextField{Name: "function", Max: 200, Help: "e.g. Beiratsvorsitz, Heizungs-Notdienst"},
			&core.SelectField{Name: "category", Required: true, MaxSelect: 1, Values: []string{"beirat", "verwaltung", "hausmeister", "notdienst", "sonstiges"}},
			&core.TextField{Name: "phone", Max: 100},
			&core.TextField{Name: "email", Max: 254},
			&core.TextField{Name: "note", Max: 1000},
			&core.NumberField{Name: "sort", OnlyInt: true},
			&core.SelectField{Name: "visibility", Required: true, MaxSelect: 1, Values: []string{"public", "owners"}},
		)
		contacts.ListRule = rule(visibleRead)
		contacts.ViewRule = rule(visibleRead)
		contacts.CreateRule = rule(beirat)
		contacts.UpdateRule = rule(beirat)
		contacts.DeleteRule = rule(beirat)
		if err := app.Save(contacts); err != nil {
			return err
		}

		// -----------------------------------------------------------------
		// documents (protected file; the view rule decides, so public
		// documents work without a file token)
		// -----------------------------------------------------------------
		documents := core.NewBaseCollection("documents")
		documents.Fields.Add(
			&core.TextField{Name: "title", Required: true, Max: 200},
			&core.TextField{Name: "description", Max: 2000},
			&core.SelectField{Name: "category", Required: true, MaxSelect: 1, Values: []string{"hausordnung", "protokoll", "beschluss", "wirtschaftsplan", "abrechnung", "vertrag", "sonstiges"}},
			&core.FileField{
				Name:      "file",
				Required:  true,
				MaxSelect: 1,
				MaxSize:   20 * 1024 * 1024,
				MimeTypes: []string{
					"application/pdf",
					"image/jpeg", "image/png", "image/webp",
					"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
					"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
					"application/vnd.oasis.opendocument.text",
					"application/vnd.oasis.opendocument.spreadsheet",
				},
				Protected: true,
			},
			&core.SelectField{Name: "visibility", Required: true, MaxSelect: 1, Values: []string{"public", "owners"}},
			&core.DateField{Name: "document_date"},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		documents.ListRule = rule(visibleRead)
		documents.ViewRule = rule(visibleRead)
		documents.CreateRule = rule(beirat)
		documents.UpdateRule = rule(beirat)
		documents.DeleteRule = rule(beirat)
		if err := app.Save(documents); err != nil {
			return err
		}

		// -----------------------------------------------------------------
		// issue_events: status history (hook-created) + internal notes
		// -----------------------------------------------------------------
		issueEvents := core.NewBaseCollection("issue_events")
		issueEvents.Fields.Add(
			&core.RelationField{Name: "issue", Required: true, MaxSelect: 1, CollectionId: issues.Id, CascadeDelete: true},
			&core.RelationField{Name: "actor", MaxSelect: 1, CollectionId: users.Id},
			&core.SelectField{Name: "type", Required: true, MaxSelect: 1, Values: []string{"status", "note"}},
			&core.TextField{Name: "from_status", Max: 20},
			&core.TextField{Name: "to_status", Max: 20},
			&core.TextField{Name: "note", Max: 2000},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		issueEvents.AddIndex("idx_issue_events_issue", false, "issue", "")
		staffIssue := "(" + staff + " && " + approved + " && issue.status != 'pending' && issue.status != 'rejected')"
		issueEvents.ListRule = rule(beirat + " || " + staffIssue)
		issueEvents.ViewRule = rule(beirat + " || " + staffIssue)
		issueEvents.CreateRule = rule(
			"(" + beirat + " || " + staffIssue + ")" +
				" && @request.body.type = 'note' && @request.body.actor = @request.auth.id" +
				" && @request.body.from_status:isset = false && @request.body.to_status:isset = false",
		)
		issueEvents.UpdateRule = nil
		issueEvents.DeleteRule = nil
		if err := app.Save(issueEvents); err != nil {
			return err
		}

		// -----------------------------------------------------------------
		// agenda_items: topics for the owners' meeting
		// -----------------------------------------------------------------
		agenda := core.NewBaseCollection("agenda_items")
		agenda.Fields.Add(
			&core.TextField{Name: "title", Required: true, Max: 200},
			&core.TextField{Name: "description", Max: 5000},
			&core.RelationField{Name: "author", MaxSelect: 1, CollectionId: users.Id},
			&core.SelectField{Name: "status", Required: true, MaxSelect: 1, Values: []string{"pending", "accepted", "rejected"}},
			&core.TextField{Name: "decision_note", Max: 2000},
			&core.DateField{Name: "decided_at"},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		agenda.AddIndex("idx_agenda_items_status", false, "status", "")
		agendaRead := beirat + " || (" + approved + " && (author = @request.auth.id || status = 'accepted'))"
		agenda.ListRule = rule(agendaRead)
		agenda.ViewRule = rule(agendaRead)
		agenda.CreateRule = rule(
			approved + " && @request.body.author = @request.auth.id && @request.body.status = 'pending'" +
				" && @request.body.decision_note:isset = false && @request.body.decided_at:isset = false",
		)
		agenda.UpdateRule = rule(beirat)
		agenda.DeleteRule = rule(beirat + " || (" + approved + " && author = @request.auth.id && status = 'pending')")
		if err := app.Save(agenda); err != nil {
			return err
		}

		// -----------------------------------------------------------------
		// polls + poll_votes (non-binding; results only as aggregates)
		// -----------------------------------------------------------------
		polls := core.NewBaseCollection("polls")
		polls.Fields.Add(
			&core.TextField{Name: "question", Required: true, Max: 300},
			&core.TextField{Name: "description", Max: 5000},
			&core.JSONField{Name: "options", Required: true, MaxSize: 10000, Help: "Array of 2-10 answer strings."},
			&core.DateField{Name: "closes_at"},
			&core.RelationField{Name: "created_by", Required: true, MaxSelect: 1, CollectionId: users.Id},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		polls.ListRule = rule(beirat + " || (" + approved + ")")
		polls.ViewRule = rule(beirat + " || (" + approved + ")")
		polls.CreateRule = rule(beirat + " && @request.body.created_by = @request.auth.id")
		polls.UpdateRule = rule(beirat)
		polls.DeleteRule = rule(beirat)
		if err := app.Save(polls); err != nil {
			return err
		}

		votes := core.NewBaseCollection("poll_votes")
		votes.Fields.Add(
			&core.RelationField{Name: "poll", Required: true, MaxSelect: 1, CollectionId: polls.Id, CascadeDelete: true},
			&core.RelationField{Name: "user", Required: true, MaxSelect: 1, CollectionId: users.Id, CascadeDelete: true},
			&core.NumberField{Name: "option", OnlyInt: true, Min: f64(0), Max: f64(9)},
		)
		votes.AddIndex("idx_poll_votes_poll_user", true, "poll, user", "")
		pollOpen := "(poll.closes_at = '' || poll.closes_at > @now)"
		votes.ListRule = rule("@request.auth.id != \"\" && user = @request.auth.id")
		votes.ViewRule = rule("@request.auth.id != \"\" && user = @request.auth.id")
		votes.CreateRule = rule(approved + " && @request.body.user = @request.auth.id && " + pollOpen)
		votes.UpdateRule = rule(
			approved + " && user = @request.auth.id && " + pollOpen +
				" && @request.body.user:isset = false && @request.body.poll:isset = false",
		)
		votes.DeleteRule = rule(approved + " && user = @request.auth.id && " + pollOpen)

		return app.Save(votes)
	}, nil)
}
