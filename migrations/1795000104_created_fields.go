package migrations

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	m "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

// Adds a server-set "created" timestamp (autodate on create) to issues and
// suggestions, so the moderation queue and the issue board can show when
// something was submitted. Autodate values cannot be set by clients.
// Records that existed before this migration keep an empty value.
func init() {
	m.Register(func(app core.App) error {
		for _, name := range []string{"issues", "suggestions"} {
			collection, err := app.FindCollectionByNameOrId(name)
			if err != nil {
				return err
			}

			if collection.Fields.GetByName("created") != nil {
				continue
			}

			collection.Fields.Add(&core.AutodateField{
				Name:     "created",
				OnCreate: true,
			})

			if err := app.Save(collection); err != nil {
				return err
			}
		}

		return nil
	}, func(app core.App) error {
		for _, name := range []string{"issues", "suggestions"} {
			collection, err := app.FindCollectionByNameOrId(name)
			if err != nil {
				return err
			}

			collection.Fields.RemoveByName("created")

			if err := app.Save(collection); err != nil {
				return err
			}
		}

		return nil
	})
}
