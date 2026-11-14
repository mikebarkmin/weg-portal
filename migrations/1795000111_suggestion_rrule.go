package migrations

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	m "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

// A calendar suggestion may describe a recurring meeting ("jede zweite
// Woche Mi-Abfalltonnen-Rückgabe"). The optional RFC 5545 rule is stored
// on the suggestion, editable by the submitter and by the Beirat in the
// moderation queue, and copied to the created event when the suggestion
// is accepted (hooks/suggestionWorkflow.go createEventFromSuggestion).
func init() {
	m.Register(func(app core.App) error {
		return setSuggestionRRule(app, true)
	}, func(app core.App) error {
		return setSuggestionRRule(app, false)
	})
}

func setSuggestionRRule(app core.App, add bool) error {
	suggestions, err := app.FindCollectionByNameOrId("suggestions")
	if err != nil {
		return err
	}

	hasField := suggestions.Fields.GetByName("rrule") != nil
	if add == hasField {
		return nil
	}

	if add {
		suggestions.Fields.Add(
			&core.TextField{Name: "rrule", Max: 1000, Help: "RFC 5545 recurrence rule, optional; copied to the event on accept."},
		)
	} else {
		suggestions.Fields.RemoveByName("rrule")
	}

	return app.Save(suggestions)
}
