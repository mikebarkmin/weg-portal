package hooks

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// SuggestionCreate enforces the honeypot + time-trap on public suggestion
// submissions and hides the submitter email from the create response
// (plan.md "Public submission routes", M3 milestones).
func SuggestionCreate(app core.App) {
	app.OnRecordCreateRequest("suggestions").BindFunc(func(e *core.RecordRequestEvent) error {
		info, err := e.RequestInfo()
		if err != nil {
			return e.BadRequestError("Failed to read the submitted data.", err)
		}

		// the honeypot must be a present, empty string; any other value
		// (non-empty, number, bool, ...) is treated as a filled trap
		// (multipart bodies always deliver strings, JSON may not)
		honeypot := ""
		if v, ok := info.Body["honeypot"]; ok {
			s, isString := v.(string)
			if !isString || s != "" {
				return e.BadRequestError("Failed to submit the suggestion.", nil)
			}
			honeypot = s
		}

		if err := validateTrap(honeypot, info.Body["form_started_at"]); err != nil {
			return e.BadRequestError("Failed to submit the suggestion.", nil)
		}

		// never echo the submitter email back in the create response
		e.Record.Hide("email")

		return e.Next()
	})
}
