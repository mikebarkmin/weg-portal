package migrations

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	m "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

// rule wraps the rule string so that it can be assigned to the *string rule fields.
// A nil rule (superuser only) is assigned directly.
func rule(s string) *string { return &s }

// f64 is a helper for the optional numeric field limits.
func f64(v float64) *float64 { return &v }

// beirat returns the expanded form of the `B` helper from plan.md.
func beirat() string { return "@request.auth.role = 'beirat'" }

func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}

		users.Fields.Add(
			&core.SelectField{
				Name:      "role",
				Required:  true,
				MaxSelect: 1,
				Values:    []string{"resident", "beirat", "hausmeister", "hausverwaltung"},
				Help:      "The role decides what the user may see and do. Only superusers can set a role other than resident.",
			},
			&core.BoolField{
				Name: "approved",
				Help: "The Beirat approves new and revokes moved-out residents. Unapproved users cannot see the issue board.",
			},
			&core.BoolField{
				Name: "notify_new_issues",
				Help: "If set, the user is notified by mail about accepted issues (used by hausmeister/hausverwaltung).",
			},
		)

		public := ""
		users.CreateRule = &public
		users.ListRule = rule("@request.auth.id = id || " + beirat())
		users.ViewRule = rule("@request.auth.id = id || " + beirat())
		users.UpdateRule = rule(
			"(@request.auth.id = id && @request.body.role:isset = false && @request.body.approved:isset = false && @request.body.verified:isset = false)" +
				" || (" + beirat() + " && @request.body.role:isset = false && @request.body.email:isset = false && @request.body.name:isset = false)",
		)
		users.DeleteRule = nil

		if err := app.Save(users); err != nil {
			return err
		}

		// -----------------------------------------------------------------
		// events (public calendar)
		// -----------------------------------------------------------------

		events := core.NewBaseCollection("events")
		events.Fields.Add(
			&core.TextField{Name: "title", Required: true, Max: 200},
			&core.TextField{Name: "description", Max: 5000},
			&core.DateField{Name: "date_start", Required: true},
			&core.DateField{Name: "date_end"},
			&core.BoolField{Name: "all_day"},
			&core.TextField{Name: "location", Max: 200},
			&core.TextField{Name: "category", Max: 100},
			&core.TextField{Name: "rrule", Max: 1000, Help: "RFC 5545 recurrence rule, optional."},
		)
		events.AddIndex("idx_events_date_start", false, "date_start", "")

		events.CreateRule = rule(beirat())
		events.ListRule = rule("")
		events.ViewRule = rule("")
		events.UpdateRule = rule(beirat())
		events.DeleteRule = rule(beirat())

		if err := app.Save(events); err != nil {
			return err
		}

		// -----------------------------------------------------------------
		// suggestions (calendar entry suggestions from residents)
		// -----------------------------------------------------------------

		suggestions := core.NewBaseCollection("suggestions")
		suggestions.Fields.Add(
			&core.TextField{Name: "title", Required: true, Max: 200},
			&core.TextField{Name: "description", Max: 5000},
			&core.DateField{Name: "date_start", Required: true},
			&core.DateField{Name: "date_end"},
			&core.BoolField{Name: "all_day"},
			&core.TextField{Name: "location", Max: 200},
			&core.TextField{Name: "category", Max: 100},
			&core.EmailField{Name: "email", Required: true, Help: "Contact email of the submitter, only visible to the Beirat."},
			&core.SelectField{Name: "status", Required: true, MaxSelect: 1, Values: []string{"pending", "accepted", "rejected"}},
			&core.TextField{Name: "decision_note", Max: 2000, Help: "Optional note of the Beirat that is sent to the submitter on accept/reject."},
			&core.DateField{Name: "decided_at"},
		)
		suggestions.AddIndex("idx_suggestions_status", false, "status", "")

		suggestions.CreateRule = rule(
			"@request.body.status = 'pending' && @request.body.decision_note:isset = false && @request.body.decided_at:isset = false",
		)
		suggestions.ListRule = rule(beirat())
		suggestions.ViewRule = rule(beirat())
		suggestions.UpdateRule = rule(beirat())
		suggestions.DeleteRule = nil

		if err := app.Save(suggestions); err != nil {
			return err
		}

		// -----------------------------------------------------------------
		// issues (community issue reports, created via custom route only)
		// -----------------------------------------------------------------

		issues := core.NewBaseCollection("issues")
		issues.Fields.Add(
			&core.TextField{Name: "title", Required: true, Max: 200},
			&core.TextField{Name: "description", Max: 5000},
			&core.TextField{Name: "category", Max: 100},
			&core.NumberField{Name: "lat", Required: true, Help: "Latitude rounded to 3 decimals (~100m), visible to approved residents."},
			&core.NumberField{Name: "lng", Required: true, Help: "Longitude rounded to 3 decimals (~100m), visible to approved residents."},
			&core.NumberField{Name: "lat_exact", Hidden: true, Help: "Exact latitude, only visible to beirat/hausmeister/hausverwaltung via the enrich hook."},
			&core.NumberField{Name: "lng_exact", Hidden: true, Help: "Exact longitude, only visible to beirat/hausmeister/hausverwaltung via the enrich hook."},
			&core.FileField{
				Name:      "photos",
				MaxSelect: 5,
				MaxSize:   5 * 1024 * 1024,
				MimeTypes: []string{"image/jpeg", "image/png", "image/webp"},
				Thumbs:    []string{"100x100", "600x0"},
				Protected: true,
			},
			&core.SelectField{Name: "status", Required: true, MaxSelect: 1, Values: []string{"pending", "open", "in_progress", "resolved", "rejected"}},
			&core.SelectField{Name: "visibility", MaxSelect: 1, Values: []string{"community", "private"}},
			&core.DateField{Name: "decided_at"},
			&core.DateField{Name: "resolved_at"},
		)
		issues.AddIndex("idx_issues_status", false, "status", "")

		issues.CreateRule = nil
		issues.ListRule = rule(
			beirat() + " || (@request.auth.id != \"\" && @request.auth.approved = true && @request.auth.verified = true" +
				" && status != 'pending' && status != 'rejected'" +
				" && (visibility = 'community' || @request.auth.role = 'hausmeister' || @request.auth.role = 'hausverwaltung'))",
		)
		issues.ViewRule = rule(
			beirat() + " || (@request.auth.id != \"\" && @request.auth.approved = true && @request.auth.verified = true" +
				" && status != 'pending' && status != 'rejected'" +
				" && (visibility = 'community' || @request.auth.role = 'hausmeister' || @request.auth.role = 'hausverwaltung'))",
		)
		issues.UpdateRule = rule(
			beirat() + " || (@request.auth.role = 'hausmeister' && @request.auth.approved = true && @request.auth.verified = true" +
				" && (status = 'open' || status = 'in_progress')" +
				" && (@request.body.status = 'in_progress' || @request.body.status = 'resolved')" +
				" && @request.body.title:isset = false && @request.body.description:isset = false" +
				" && @request.body.category:isset = false && @request.body.visibility:isset = false" +
				" && @request.body.lat:isset = false && @request.body.lng:isset = false" +
				" && @request.body.lat_exact:isset = false && @request.body.lng_exact:isset = false" +
				" && @request.body.photos:isset = false)",
		)
		issues.DeleteRule = nil

		if err := app.Save(issues); err != nil {
			return err
		}

		// -----------------------------------------------------------------
		// issue_metas (submitter contact, created via custom route only)
		// -----------------------------------------------------------------

		issueMetas := core.NewBaseCollection("issue_metas")
		issueMetas.Fields.Add(
			&core.RelationField{
				Name:          "issue",
				Required:      true,
				MaxSelect:     1,
				CollectionId:  issues.Id,
				CascadeDelete: true,
			},
			&core.EmailField{Name: "email", Required: true, Help: "Contact email of the submitter, only visible to the Beirat."},
			&core.TextField{Name: "name", Max: 200},
		)
		issueMetas.AddIndex("idx_issue_metas_issue", true, "issue", "")

		issueMetas.CreateRule = nil
		issueMetas.ListRule = rule(beirat())
		issueMetas.ViewRule = rule(beirat())
		issueMetas.UpdateRule = nil
		issueMetas.DeleteRule = nil

		if err := app.Save(issueMetas); err != nil {
			return err
		}

		// -----------------------------------------------------------------
		// notes (internal notes of the Beirat)
		// -----------------------------------------------------------------

		notes := core.NewBaseCollection("notes")
		notes.Fields.Add(
			&core.TextField{Name: "title", Required: true, Max: 200},
			&core.EditorField{Name: "body", Required: true, ConvertURLs: true},
			&core.RelationField{
				Name:         "author",
				Required:     true,
				MaxSelect:    1,
				CollectionId: users.Id,
				Presentable:  true,
			},
			&core.BoolField{Name: "pinned"},
		)

		notes.CreateRule = rule(beirat() + " && @request.body.author = @request.auth.id")
		notes.ListRule = rule(beirat())
		notes.ViewRule = rule(beirat())
		notes.UpdateRule = rule(beirat())
		notes.DeleteRule = rule(beirat())

		if err := app.Save(notes); err != nil {
			return err
		}

		// -----------------------------------------------------------------
		// portal_settings (single record, superuser only)
		// -----------------------------------------------------------------

		portalSettings := core.NewBaseCollection("portal_settings")
		portalSettings.Fields.Add(
			&core.NumberField{Name: "retention_suggestions_rejected_days", Required: true, OnlyInt: true, Min: f64(1), Max: f64(3650)},
			&core.NumberField{Name: "retention_suggestions_accepted_days", Required: true, OnlyInt: true, Min: f64(1), Max: f64(3650)},
			&core.NumberField{Name: "retention_issues_rejected_days", Required: true, OnlyInt: true, Min: f64(1), Max: f64(3650)},
			&core.NumberField{Name: "retention_issues_resolved_days", Required: true, OnlyInt: true, Min: f64(1), Max: f64(3650)},
		)

		portalSettings.CreateRule = nil
		portalSettings.ListRule = nil
		portalSettings.ViewRule = nil
		portalSettings.UpdateRule = nil
		portalSettings.DeleteRule = nil

		return app.Save(portalSettings)
	}, nil)
}
