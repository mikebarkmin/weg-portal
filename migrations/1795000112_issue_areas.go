package migrations

import (
	"strings"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	m "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

// Issue locations on the property instead of a geographic map.
//
// The OpenStreetMap point (lat/lng rounded + lat_exact/lng_exact) is
// replaced by a location inside the property:
//
//   - issue_areas: the selectable areas - a house with its floors, or a
//     shared area (basement, outside) with an uploaded plan image. Managed
//     by the Beirat/admins in the portal. The plan is a protected file and
//     only readable by approved accounts.
//   - issue_locations: at most one per issue - the area, an optional floor
//     and an optional pin on the area's plan (x/y normalized to 0..1, so
//     a re-uploaded plan in another resolution keeps the pins valid).
//     The record has the same id as its issue, so a client reads the
//     location of an issue with a plain view request.
//
// Who may read a location (issue_locations list/view rule):
//
//   - Beirat and admins: always
//   - the reporter (issue_metas.user): their own reports
//   - Hausmeister/Hausverwaltung: only when the Beirat shared it
//     (`shared`) and the issue is accepted
//   - everyone else: never - not even the area name
//
// Every issue_locations field is Hidden: PocketBase does not apply the
// rules of a related collection when a client filters or sorts through a
// relation, so without it a resident could probe locations with e.g.
// `?filter=issue_locations_via_issue.floor='2. OG'`. Hidden fields are not
// filterable by non-superusers; the enrich hook (hooks/issueAreas.go)
// unhides them in responses - those are gated by the rule above.
//
// Old coordinates are dropped without conversion (they cannot be mapped
// onto the plans).
func init() {
	const (
		beiratOrAdmin = "(@request.auth.role = 'beirat' || @request.auth.role = 'admin')"
		approved      = "@request.auth.id != \"\" && @request.auth.approved = true && @request.auth.verified = true"
		staff         = "(@request.auth.role = 'hausmeister' || @request.auth.role = 'hausverwaltung')"

		oldUpdateClauses = " && @request.body.lat:isset = false && @request.body.lng:isset = false" +
			" && @request.body.lat_exact:isset = false && @request.body.lng_exact:isset = false"
	)

	m.Register(func(app core.App) error {
		issues, err := app.FindCollectionByNameOrId("issues")
		if err != nil {
			return err
		}

		for _, name := range []string{"lat", "lng", "lat_exact", "lng_exact"} {
			issues.Fields.RemoveByName(name)
		}
		if issues.UpdateRule != nil {
			issues.UpdateRule = rule(strings.ReplaceAll(*issues.UpdateRule, oldUpdateClauses, ""))
		}
		if err := app.Save(issues); err != nil {
			return err
		}

		// -----------------------------------------------------------------
		// issue_areas
		// -----------------------------------------------------------------
		areas := core.NewBaseCollection("issue_areas")
		areas.Fields.Add(
			&core.TextField{Name: "name", Required: true, Max: 100, Presentable: true},
			&core.JSONField{Name: "floors", MaxSize: 4000, Help: "JSON list of floor labels (houses); empty for areas without floors."},
			&core.FileField{
				Name:      "plan",
				MaxSelect: 1,
				MaxSize:   10 * 1024 * 1024,
				// raster images only: an SVG could carry script
				MimeTypes: []string{"image/png", "image/jpeg", "image/webp"},
				Protected: true,
				Help:      "Optional plan image on which reporters place a pin.",
			},
			&core.NumberField{Name: "sort", OnlyInt: true},
			&core.BoolField{Name: "active", Help: "Inactive areas are no longer offered in the report form."},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		areas.ListRule = rule(beiratOrAdmin + " || (" + approved + ")")
		areas.ViewRule = rule(beiratOrAdmin + " || (" + approved + ")")
		areas.CreateRule = rule(beiratOrAdmin)
		areas.UpdateRule = rule(beiratOrAdmin)
		areas.DeleteRule = rule(beiratOrAdmin)
		if err := app.Save(areas); err != nil {
			return err
		}

		// -----------------------------------------------------------------
		// issue_locations (written by the server only)
		// -----------------------------------------------------------------
		locations := core.NewBaseCollection("issue_locations")
		locations.Fields.Add(
			&core.RelationField{Name: "issue", Required: true, MaxSelect: 1, CollectionId: issues.Id, CascadeDelete: true, Hidden: true},
			&core.RelationField{Name: "area", Required: true, MaxSelect: 1, CollectionId: areas.Id, Hidden: true},
			&core.TextField{Name: "floor", Max: 50, Hidden: true},
			&core.BoolField{Name: "has_pin", Hidden: true},
			&core.NumberField{Name: "x", Hidden: true, Help: "Pin position on the area plan, 0..1 from the left edge."},
			&core.NumberField{Name: "y", Hidden: true, Help: "Pin position on the area plan, 0..1 from the top edge."},
			&core.BoolField{Name: "shared", Hidden: true, Help: "The Beirat shared the location with Hausmeister/Hausverwaltung."},
		)
		locations.AddIndex("idx_issue_locations_issue", true, "issue", "")

		read := beiratOrAdmin +
			" || (" + approved + " && issue.issue_metas_via_issue.user ?= @request.auth.id)" +
			" || (" + approved + " && " + staff + " && shared = true" +
			" && issue.status != 'pending' && issue.status != 'rejected')"
		locations.ListRule = rule(read)
		locations.ViewRule = rule(read)
		locations.CreateRule = nil
		locations.UpdateRule = nil
		locations.DeleteRule = nil
		if err := app.Save(locations); err != nil {
			return err
		}

		// the stored privacy text: swap the two paragraphs about the old
		// map, but only where the Beirat has not rewritten them
		legal, err := app.FindFirstRecordByFilter("legal_pages", "slug = 'datenschutz'")
		if err == nil {
			body := legal.GetString("body")
			updated := strings.ReplaceAll(body, legalOldIssueParagraph, legalNewIssueParagraph)
			updated = strings.ReplaceAll(updated, legalOldMapParagraph, legalNewStaffParagraph)
			if updated != body {
				legal.Set("body", updated)
				if err := app.Save(legal); err != nil {
					return err
				}
			}
		}

		return nil
	}, func(app core.App) error {
		for _, name := range []string{"issue_locations", "issue_areas"} {
			collection, err := app.FindCollectionByNameOrId(name)
			if err != nil {
				continue
			}
			if err := app.Delete(collection); err != nil {
				return err
			}
		}

		issues, err := app.FindCollectionByNameOrId("issues")
		if err != nil {
			return err
		}
		issues.Fields.Add(
			&core.NumberField{Name: "lat"},
			&core.NumberField{Name: "lng"},
			&core.NumberField{Name: "lat_exact", Hidden: true},
			&core.NumberField{Name: "lng_exact", Hidden: true},
		)
		if issues.UpdateRule != nil {
			const anchor = " && @request.body.photos:isset = false"
			issues.UpdateRule = rule(strings.Replace(*issues.UpdateRule, anchor, oldUpdateClauses+anchor, 1))
		}

		return app.Save(issues)
	})
}

// The paragraphs of the original privacy draft that described the
// OpenStreetMap based location, and their replacements.
const (
	legalOldIssueParagraph = "Mängelmeldungen: Bei einer Meldung werden Titel, Beschreibung, Kategorie und die von Ihnen markierte Örtlichkeit gespeichert. Konto-basierte Nutzer (Eigentümer, Hausmeister, Hausverwaltung) sehen ausschließlich grob gerundete Koordinaten (ca. 100 m Genauigkeit); die genaue Position ist nur für den Beirat sowie Hausmeister und Hausverwaltung einsehbar. "
	legalNewIssueParagraph = "Mängelmeldungen: Bei einer Meldung werden Titel, Beschreibung und Kategorie gespeichert. Optional können Sie den Ort angeben (Bereich der Wohnanlage, ggf. Etage und eine Markierung auf dem Lageplan). Die Ortsangabe sehen nur Sie selbst (bei Meldung mit Konto) und der Beirat; der Beirat kann sie im Einzelfall für Hausmeister und Hausverwaltung freigeben, damit diese die Meldung bearbeiten können. Andere Eigentümer sehen die Ortsangabe nicht. "
	legalOldMapParagraph   = "OpenStreetMap-Karten: Das Portal bindet Kartenausschnitte des OpenStreetMap-Projekts ein. Beim Aufruf der Karten werden Verbindungsdaten (u. a. Ihre IP-Adresse) an den Tile-Server der OpenStreetMap Foundation (Großbritannien), tile.openstreetmap.org, übermittelt. Eine Anmeldung dort ist nicht erforderlich.\n\n"
	legalNewStaffParagraph = "Hausmeister und Hausverwaltung: Gibt der Beirat die Ortsangabe einer Meldung frei, erhalten die Konten von Hausmeister und Hausverwaltung Zugriff darauf. Benachrichtigungs-E-Mails enthalten keine Ortsangaben.\n\n"
)
