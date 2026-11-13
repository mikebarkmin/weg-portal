package hooks

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// NotesAuthor keeps notes.author immutable for non-superusers: the create
// rule pins it to the creator (@request.body.author = @request.auth.id),
// but the update rule is plain beirat access, so without this hook a
// Beirat member could re-attribute a note to someone else.
func NotesAuthor(app core.App) {
	app.OnRecordUpdateRequest("notes").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.HasSuperuserAuth() {
			return e.Next()
		}

		e.Record.Set("author", e.Record.Original().GetString("author"))

		return e.Next()
	})
}
