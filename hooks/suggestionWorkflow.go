package hooks

import (
	"fmt"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/types"
)

// SuggestionWorkflow enforces the suggestion moderation transitions and
// creates the calendar event when a suggestion is accepted (plan.md
// "Notifications and email" / milestones M4):
//
//	pending --> accepted (creates the events record, sets decided_at)
//	pending --> rejected (sets decided_at)
//
// Any other status change (e.g. accepted -> pending, accepted -> rejected,
// rejected -> ...) is rejected with 400; submitting the SAME status as the
// stored one is rejected as well (M4 review decision: a repeated accept is
// a client error, not a no-op). decided_at is owned by the hook alone: the
// stored value is restored on every update, so a client can never forge it.
//
// The events record is created in the SAME transaction as the suggestion
// update: OnRecordUpdateExecute wraps the persist and the event insert in a
// single RunInTransaction, so a failing event insert rolls the suggestion
// back to pending.
func SuggestionWorkflow(app core.App) {
	app.OnRecordUpdateRequest("suggestions").BindFunc(func(e *core.RecordRequestEvent) error {
		oldStatus := e.Record.Original().GetString("status")
		newStatus := e.Record.GetString("status")

		// decided_at is hook-owned: restore the stored value, the
		// transition branches below set it when appropriate
		e.Record.Set("decided_at", e.Record.Original().Get("decided_at"))

		if oldStatus == newStatus {
			info, err := e.RequestInfo()
			if err != nil {
				return e.BadRequestError("Failed to read the submitted data.", err)
			}

			// the same status is not a transition: submitting it anyway
			// is a client error (e.g. a double-clicked accept)
			if _, statusSubmitted := info.Body["status"]; statusSubmitted {
				return e.BadRequestError("The suggestion is already in the status \""+oldStatus+"\". The status must only be submitted when it changes.", nil)
			}

			// no status submitted -> a beirat edit of the suggestion fields, allowed
			return e.Next()
		}

		switch {
		case oldStatus == "pending" && newStatus == "accepted":
			e.Record.Set("decided_at", types.NowDateTime())

		case oldStatus == "pending" && newStatus == "rejected":
			e.Record.Set("decided_at", types.NowDateTime())

		default:
			return e.BadRequestError("Invalid status transition: \"" + oldStatus + "\" -> \"" + newStatus + "\".", nil)
		}

		return e.Next()
	})

	app.OnRecordUpdateExecute("suggestions").BindFunc(func(e *core.RecordEvent) error {
		oldStatus := e.Record.Original().GetString("status")
		newStatus := e.Record.GetString("status")

		if oldStatus != "pending" || newStatus != "accepted" {
			return e.Next()
		}

		// suggestion update and event creation in one transaction
		return e.App.RunInTransaction(func(txApp core.App) error {
			prevApp := e.App
			e.App = txApp
			defer func() { e.App = prevApp }()

			// persist the suggestion update
			if err := e.Next(); err != nil {
				return err
			}

			return createEventFromSuggestion(txApp, e.Record)
		})
	})
}

// createEventFromSuggestion creates the calendar event for an accepted
// suggestion: title, description, date_start, date_end, all_day, location
// and category are copied, rrule stays empty (plain single events only).
func createEventFromSuggestion(txApp core.App, suggestion *core.Record) error {
	events, err := txApp.FindCachedCollectionByNameOrId("events")
	if err != nil {
		return err
	}

	event := core.NewRecord(events)
	event.Set("title", suggestion.GetString("title"))
	event.Set("description", suggestion.GetString("description"))
	event.Set("date_start", suggestion.Get("date_start"))
	event.Set("date_end", suggestion.Get("date_end"))
	event.Set("all_day", suggestion.Get("all_day"))
	event.Set("location", suggestion.GetString("location"))
	event.Set("category", suggestion.GetString("category"))

	if err := txApp.Save(event); err != nil {
		return fmt.Errorf("failed to create the event for the accepted suggestion: %w", err)
	}

	return nil
}
