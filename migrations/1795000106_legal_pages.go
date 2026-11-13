package migrations

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	m "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

// Editable legal pages (Impressum, Datenschutz): one Markdown record per
// page, readable by everyone, edited by the Beirat in the portal. Created
// once here with the former drafts (legal_defaults.go), marked as draft.
func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}

		legal := core.NewBaseCollection("legal_pages")
		legal.Fields.Add(
			&core.SelectField{Name: "slug", Required: true, MaxSelect: 1, Values: []string{"impressum", "datenschutz"}},
			&core.TextField{Name: "body", Max: 100000, Help: "Markdown. Placeholders {{retention_*_days}} are filled from portal_settings."},
			&core.BoolField{Name: "draft", Help: "Shows the 'draft, legal review pending' notice until released."},
			&core.RelationField{Name: "updated_by", MaxSelect: 1, CollectionId: users.Id},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		legal.AddIndex("idx_legal_pages_slug", true, "slug", "")

		public := ""
		legal.ListRule = &public
		legal.ViewRule = &public
		legal.CreateRule = nil
		legal.UpdateRule = rule("@request.auth.role = 'beirat' && @request.body.slug:isset = false")
		legal.DeleteRule = nil
		if err := app.Save(legal); err != nil {
			return err
		}

		for slug, body := range map[string]string{
			"impressum":   legalImpressumDefault,
			"datenschutz": legalDatenschutzDefault,
		} {
			record := core.NewRecord(legal)
			record.Set("slug", slug)
			record.Set("body", body)
			record.Set("draft", true)
			if err := app.Save(record); err != nil {
				return err
			}
		}

		return nil
	}, nil)
}
