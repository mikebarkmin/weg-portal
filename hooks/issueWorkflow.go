package hooks

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/types"
)

// IssueWorkflow validates every issue status transition server-side,
// regardless of the caller's role (plan.md "Issue update rule" diagram):
//
//	pending --accept (beirat, must set visibility)--> open --> in_progress --> resolved
//	   \--reject (beirat)--> rejected
//
// Anything else (e.g. resolved -> pending or a direct open -> resolved jump)
// is rejected with 400. The collection rules (beirat/HM whitelists) are the
// first gate; this hook is the second one.
//
// OnRecordUpdateRequest fires before the save, so the record can still be
// amended: the hooks sets decided_at on accept/reject and resolved_at on
// resolve. Updates without a status change (beirat edits of accepted issues)
// are not blocked.
func IssueWorkflow(app core.App) {
	app.OnRecordUpdateRequest("issues").BindFunc(func(e *core.RecordRequestEvent) error {
		oldStatus := e.Record.Original().GetString("status")
		newStatus := e.Record.GetString("status")

		// no status change -> a beirat edit of the issue fields, allowed
		if oldStatus == newStatus {
			return e.Next()
		}

		switch {
		case oldStatus == "pending" && newStatus == "open":
			// accept: the beirat must decide the visibility in the SAME request
			if err := requireVisibility(e); err != nil {
				return err
			}
			e.Record.Set("decided_at", types.NowDateTime())

		case oldStatus == "pending" && newStatus == "rejected":
			// reject
			e.Record.Set("decided_at", types.NowDateTime())

		case oldStatus == "open" && newStatus == "in_progress":
			// start working on the issue

		case oldStatus == "in_progress" && newStatus == "resolved":
			// resolve
			e.Record.Set("resolved_at", types.NowDateTime())

		default:
			return e.BadRequestError("Invalid status transition: \"" + oldStatus + "\" -> \"" + newStatus + "\".", nil)
		}

		return e.Next()
	})
}

// requireVisibility checks that the update request sets the visibility field
// (community|private) required on issue accept. Only the two approved select
// values count; anything else (missing, an empty string or the already stored
// value reused without being submitted) fails the request with 400.
func requireVisibility(e *core.RecordRequestEvent) error {
	info, err := e.RequestInfo()
	if err != nil {
		return e.BadRequestError("Failed to read the submitted data.", err)
	}

	visibility, _ := info.Body["visibility"].(string)

	if visibility != "community" && visibility != "private" {
		return e.BadRequestError("The visibility (community or private) must be set when accepting a report.", nil)
	}

	return nil
}
