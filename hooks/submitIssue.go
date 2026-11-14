package hooks

import (
	"fmt"
	"html"
	"mime/multipart"
	"net/http"
	"net/mail"
	"strings"

	"github.com/gabriel-vasile/mimetype"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/filesystem"
)

// SubmitIssue registers the public, account-less issue submission route
// POST /api/portal/issues (multipart), see plan.md "Public submission routes".
//
// The route writes the issue (status pending), its optional location
// (issue_locations, see issueAreas.go) and its issue_metas record (submitter email - the account
// address for logged-in users) in one transaction and
// returns only {"ok": true} - never the created record.
func SubmitIssue(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.POST("/api/portal/issues", func(e *core.RequestEvent) error {
			if err := e.Request.ParseMultipartForm(32 << 20); err != nil {
				return e.BadRequestError("Failed to parse the submitted form data.", err)
			}

			form := e.Request.PostForm
			if len(form) == 0 {
				form = e.Request.Form
			}

			// spam traps
			if err := validateTrap(form.Get("honeypot"), form.Get("form_started_at")); err != nil {
				return e.BadRequestError(html.EscapeString(err.Error()), nil)
			}

			// field validation
			title := strings.TrimSpace(form.Get("title"))
			if len(title) < 1 || len(title) > 200 {
				return e.BadRequestError("Title is required (max 200 characters).", nil)
			}

			description := strings.TrimSpace(form.Get("description"))
			if len(description) > 5000 {
				return e.BadRequestError("Description is too long (max 5000 characters).", nil)
			}

			category := strings.TrimSpace(form.Get("category"))
			if len(category) > 100 {
				return e.BadRequestError("Category is too long (max 100 characters).", nil)
			}

			// NOTE: the optional name is deliberately not length-checked
			// here - its sole consumer is issue_metas, whose schema limit
			// (200) rejects overlong values inside the submission
			// transaction, rolling the issue back with the meta.
			name := strings.TrimSpace(form.Get("name"))

			// logged-in accounts report under their account address; the
			// form only asks guests for an email
			var authUser *core.Record
			if e.Auth != nil && e.Auth.Collection().Name == "users" {
				authUser = e.Auth
			}

			email := strings.TrimSpace(form.Get("email"))
			if authUser != nil {
				email = authUser.Email()
				// the form does not ask logged-in users for a name either
				name = strings.TrimSpace(authUser.GetString("name"))
				// account names may be longer than issue_metas.name (200)
				if r := []rune(name); len(r) > 200 {
					name = string(r[:200])
				}
			}
			if len(email) > 254 {
				return e.BadRequestError("Email address is invalid.", nil)
			}
			if _, err := mail.ParseAddress(email); err != nil || strings.ContainsAny(email, " \t") {
				return e.BadRequestError("Email address is invalid.", nil)
			}

			// the location (area, floor, pin on the plan) is optional
			location, locationError := parseIssueLocation(e.App, form, authUser)
			if locationError != "" {
				return e.BadRequestError(locationError, nil)
			}

			// photos
			photoHeaders := e.Request.MultipartForm.File["photos"]
			if len(photoHeaders) > maxPhotoCount {
				return e.BadRequestError(fmt.Sprintf("At most %d photos are allowed.", maxPhotoCount), nil)
			}
			if len(photoHeaders) > 0 && !truthyFormValue(form.Get("photo_consent")) {
				return e.BadRequestError("Photo consent is required to upload photos.", nil)
			}

			photoFiles := make([]*filesystem.File, 0, len(photoHeaders))
			for _, fh := range photoHeaders {
				if fh.Size > maxPhotoSize {
					return e.BadRequestError("Each photo must be 5 MB or smaller.", nil)
				}

				if err := checkPhotoMime(fh); err != nil {
					return e.BadRequestError("Photos must be JPEG, PNG or WebP images.", nil)
				}

				file, err := filesystem.NewFileFromMultipart(fh)
				if err != nil {
					return e.BadRequestError("Failed to read the uploaded photo.", err)
				}
				photoFiles = append(photoFiles, file)
			}

			issuesCollection, err := app.FindCachedCollectionByNameOrId("issues")
			if err != nil {
				return e.InternalServerError("Failed to load the issues collection.", err)
			}
			issueMetasCollection, err := app.FindCachedCollectionByNameOrId("issue_metas")
			if err != nil {
				return e.InternalServerError("Failed to load the issue_metas collection.", err)
			}

			issueLocationsCollection, err := app.FindCachedCollectionByNameOrId("issue_locations")
			if err != nil {
				return e.InternalServerError("Failed to load the issue_locations collection.", err)
			}

			// create the issue + meta (+ location) atomically; only server-controlled
			// values are set, so client-supplied status/visibility/coords
			// of other fields cannot be trusted in any way
			err = app.RunInTransaction(func(txApp core.App) error {
				issue := core.NewRecord(issuesCollection)
				issue.Set("title", title)
				issue.Set("description", description)
				issue.Set("category", category)
				issue.Set("status", "pending")
				if len(photoFiles) > 0 {
					issue.Set("photos", photoFiles)
				}

				if err := txApp.Save(issue); err != nil {
					return err
				}

				meta := core.NewRecord(issueMetasCollection)
				meta.Set("issue", issue.Id)
				meta.Set("email", email)
				// logged-in owners see their own reports under "Meine
				// Einreichungen" (the link stays Beirat-only data)
				if authUser != nil {
					meta.Set("user", authUser.Id)
				}
				if name != "" {
					meta.Set("name", name)
				}

				if err := txApp.Save(meta); err != nil {
					return err
				}

				if location == nil {
					return nil
				}

				// never shared with staff until the Beirat decides so
				// the location shares the id of its issue: clients read it
				// with a plain view request (the fields are not filterable)
				record := core.NewRecord(issueLocationsCollection)
				record.Set("id", issue.Id)
				record.Set("issue", issue.Id)
				record.Set("area", location.area)
				record.Set("floor", location.floor)
				record.Set("has_pin", location.hasPin)
				record.Set("x", location.x)
				record.Set("y", location.y)
				record.Set("shared", false)

				return txApp.Save(record)
			})
			if err != nil {
				return e.BadRequestError("Failed to submit the report.", nil)
			}

			return e.JSON(http.StatusOK, map[string]bool{"ok": true})
		})

		return se.Next()
	})
}

const (
	maxPhotoCount = 5
	maxPhotoSize  = 5 * 1024 * 1024
)

// photoMimes is the accepted server-side (sniffed) photo content types.
var photoMimes = map[string]struct{}{
	"image/jpeg": {},
	"image/png":  {},
	"image/webp": {},
}

// checkPhotoMime sniffs the actual file content instead of trusting the
// client-supplied name or content type.
func checkPhotoMime(fh *multipart.FileHeader) error {
	f, err := fh.Open()
	if err != nil {
		return err
	}
	defer f.Close()

	mt, err := mimetype.DetectReader(f)
	if err != nil {
		return err
	}

	if _, ok := photoMimes[mt.String()]; !ok {
		return fmt.Errorf("unexpected photo mime %q", mt.String())
	}

	return nil
}

func truthyFormValue(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	}

	return false
}
