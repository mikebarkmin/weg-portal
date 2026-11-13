package hooks

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// UsersCreate hardens the public signup:
//   - non-superuser creates are always unapproved residents (role, approved
//     and verified are forced server-side regardless of the submitted body)
//   - hausmeister/hausverwaltung accounts created by a superuser get
//     notify_new_issues = true unless explicitly set
//
// see plan.md "Users: updates and approval" and the roles matrix.
func UsersCreate(app core.App) {
	app.OnRecordCreateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		info, err := e.RequestInfo()
		if err != nil {
			return e.BadRequestError("Failed to read the submitted data.", err)
		}

		if !info.HasSuperuserAuth() {
			e.Record.Set("role", "resident")
			e.Record.Set("approved", false)
			e.Record.Set("verified", false)
		} else {
			switch e.Record.GetString("role") {
			case "hausmeister", "hausverwaltung":
				if _, isset := info.Body["notify_new_issues"]; !isset {
					e.Record.Set("notify_new_issues", true)
				}
			}
		}

		return e.Next()
	})
}
