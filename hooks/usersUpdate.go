package hooks

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// UsersUpdate is the second guard (next to the users update rule) of
// plan.md "Users: updates and approval": a non-superuser request can never
// change a user's role, whatever the collection rules allow, and an admin
// account is only ever changed by its owner (profile) through this API.
func UsersUpdate(app core.App) {
	app.OnRecordUpdateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.HasSuperuserAuth() {
			return e.Next()
		}

		if e.Record.GetString("role") != e.Record.Original().GetString("role") {
			return e.ForbiddenError("Only a superuser can change the role of a user.", nil)
		}

		// admin accounts are managed by other admins through the admin
		// routes (hooks/adminUsers.go) only: the users update rule lets the
		// Beirat set approved/verified, which would otherwise allow it to
		// lock every admin out
		if e.Record.Original().GetString("role") == "admin" && (e.Auth == nil || e.Auth.Id != e.Record.Id) {
			return e.ForbiddenError("Admin accounts are managed on the admin page.", nil)
		}

		return e.Next()
	})
}
