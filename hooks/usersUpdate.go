package hooks

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// UsersUpdate is the second guard (next to the users update rule) of
// plan.md "Users: updates and approval": a non-superuser request can never
// change a user's role, whatever the collection rules allow.
func UsersUpdate(app core.App) {
	app.OnRecordUpdateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.HasSuperuserAuth() {
			return e.Next()
		}

		if e.Record.GetString("role") != e.Record.Original().GetString("role") {
			return e.ForbiddenError("Only a superuser can change the role of a user.", nil)
		}

		return e.Next()
	})
}
