package hooks

import (
	"embed"
	"fmt"
	"log/slog"
	"net/mail"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/mailer"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/routine"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/template"
)

// Mail sends all portal notifications (plan.md "Notifications and email",
// BugStage fire-and-forget pattern):
//
//   - new suggestion      -> mail to all beirat users
//   - new issue           -> mail to all beirat users
//   - suggestion accepted -> mail to the submitter (fixed text + decision_note)
//   - suggestion rejected -> mail to the submitter (fixed text + decision_note)
//   - issue accepted/rejected/status changed -> mail to the submitter (via issue_metas)
//   - issue accepted      -> mail to hausmeister/hausverwaltung with notify_new_issues = true
//
// Mails are sent only when the status actually changed (Original() is
// compared) and NEVER contain user-supplied text (title, description, name)
// when addressed to a submitter address - the addresses are unverified, so
// echoing content would make the portal a spam relay. Mails to beirat/staff
// accounts may contain the content.
func Mail(app core.App) {
	// -------------------------------------------------------------------
	// new suggestion -> all beirat users
	// -------------------------------------------------------------------
	app.OnRecordAfterCreateSuccess("suggestions").BindFunc(func(e *core.RecordEvent) error {
		title := e.Record.GetString("title")
		description := e.Record.GetString("description")
		dateStart := e.Record.GetString("date_start")
		location := e.Record.GetString("location")
		category := e.Record.GetString("category")
		email := e.Record.GetString("email")

		notifyAsync(app, func() {
			data := mailBeiratSuggestionData{
				AppName:     app.Settings().Meta.AppName,
				Title:       title,
				Description: description,
				DateStart:   dateStart,
				Location:    location,
				Category:    category,
				Email:       email,
			}

			recipients, err := findRoleEmails(app, "role = 'beirat'")
			if err != nil {
				logMailError(app, err, "beirat new-suggestion mail", "")
				return
			}

			if err := sendMail(app, "beirat_new_suggestion.html", "Neuer Kalendervorschlag: "+title, data, recipients); err != nil {
				logMailError(app, err, "beirat new-suggestion mail", "")
			}
		})

		return e.Next()
	})

	// -------------------------------------------------------------------
	// new issue -> all beirat users
	// -------------------------------------------------------------------
	app.OnRecordAfterCreateSuccess("issues").BindFunc(func(e *core.RecordEvent) error {
		title := e.Record.GetString("title")
		description := e.Record.GetString("description")
		category := e.Record.GetString("category")
		lat := e.Record.GetFloat("lat")
		lng := e.Record.GetFloat("lng")

		notifyAsync(app, func() {
			data := mailBeiratIssueData{
				AppName:     app.Settings().Meta.AppName,
				Title:       title,
				Description: description,
				Category:    category,
				Lat:         lat,
				Lng:         lng,
			}

			recipients, err := findRoleEmails(app, "role = 'beirat'")
			if err != nil {
				logMailError(app, err, "beirat new-issue mail", "")
				return
			}

			if err := sendMail(app, "beirat_new_issue.html", "Neue Meldung: "+title, data, recipients); err != nil {
				logMailError(app, err, "beirat new-issue mail", "")
			}
		})

		return e.Next()
	})

	// -------------------------------------------------------------------
	// suggestion accepted / rejected -> submitter
	// -------------------------------------------------------------------
	app.OnRecordAfterUpdateSuccess("suggestions").BindFunc(func(e *core.RecordEvent) error {
		oldStatus := e.Record.Original().GetString("status")
		newStatus := e.Record.GetString("status")
		if oldStatus == newStatus {
			return e.Next() // no status change -> no mail
		}

		if newStatus != "accepted" && newStatus != "rejected" {
			return e.Next() // unreachable with the workflow hook; be defensive
		}

		submitter := e.Record.GetString("email")
		decisionNote := e.Record.GetString("decision_note")

		notifyAsync(app, func() {
			data := mailSubmitterData{
				AppName:      app.Settings().Meta.AppName,
				Decision:     newStatus,
				DecisionNote: decisionNote,
			}

			subject := "Ihr Kalendervorschlag: Entscheidung des Beirats"
			if newStatus == "accepted" {
				subject = "Ihr Kalendervorschlag wurde angenommen"
			} else {
				subject = "Ihr Kalendervorschlag wurde abgelehnt"
			}

			if err := sendMail(app, "suggestion_submitter.html", subject, data, []mail.Address{{Address: submitter}}); err != nil {
				logMailError(app, err, "suggestion submitter mail", submitter)
			}
		})

		return e.Next()
	})

	// -------------------------------------------------------------------
	// issue accepted / rejected / status changed -> submitter (via
	// issue_metas); on accept additionally hausmeister/hausverwaltung
	// with notify_new_issues = true
	// -------------------------------------------------------------------
	app.OnRecordAfterUpdateSuccess("issues").BindFunc(func(e *core.RecordEvent) error {
		oldStatus := e.Record.Original().GetString("status")
		newStatus := e.Record.GetString("status")
		if oldStatus == newStatus {
			return e.Next() // no status change -> no mail
		}

		isAccepted := oldStatus == "pending" && newStatus == "open"

		// the hook validates the transitions, so anything else here is
		// only a beirat accept/reject or an open->in_progress->resolved step
		switch {
		case isAccepted:
			// accepted
		case oldStatus == "pending" && newStatus == "rejected":
			// rejected
		case oldStatus == "open" && newStatus == "in_progress":
			// in progress
		case oldStatus == "in_progress" && newStatus == "resolved":
			// resolved
		default:
			return e.Next() // not a known transition -> no mail
		}

		issueId := e.Record.Id
		visibility := e.Record.GetString("visibility")
		title := e.Record.GetString("title")
		category := e.Record.GetString("category")
		lat := e.Record.GetFloat("lat")
		lng := e.Record.GetFloat("lng")

		subject := issueSubmitterSubject(newStatus)

		notifyAsync(app, func() {
			submitter, err := issueSubmitterAddress(app, issueId)
			if err != nil {
				logMailError(app, err, "issue submitter lookup", issueId)
				return
			}

			if submitter != "" {
				data := mailSubmitterData{
					AppName:  app.Settings().Meta.AppName,
					Decision: issueSubmitterDecisionKey(oldStatus, newStatus),
				}

				if err := sendMail(app, "issue_submitter.html", subject, data, []mail.Address{{Address: submitter}}); err != nil {
					logMailError(app, err, "issue submitter mail", submitter)
				}
			}

			if !isAccepted {
				return // staff is notified just once: when accepting
			}

			recipients, err := findNotifyNewIssuesEmails(app)
			if err != nil {
				logMailError(app, err, "staff new-issue mail", issueId)
				return
			}

			// skips silently if nobody opted in
			if len(recipients) == 0 {
				return
			}

			data := mailStaffIssueData{
				AppName:    app.Settings().Meta.AppName,
				Title:      title,
				Category:   category,
				Visibility: visibility,
				Lat:        lat,
				Lng:        lng,
			}

			if err := sendMail(app, "staff_new_issue.html", "Angenommene Meldung: "+title, data, recipients); err != nil {
				logMailError(app, err, "staff new-issue mail", issueId)
			}
		})

		return e.Next()
	})
}

// notifyAsync wraps routine.FireAndForget and skips the notification when
// the application is already uninitialized (shutdown or short-lived test
// instances whose mails are not asserted anyway).
func notifyAsync(app core.App, fn func()) {
	routine.FireAndForget(func() {
		if !app.IsBootstrapped() {
			return
		}

		fn()
	})
}

// --------------------------------------------------------------------
// template registry (embedded hooks/templates, html/template based)
// --------------------------------------------------------------------

//go:embed all:templates
var templatesEmbed embed.FS
var templatesFS = apis.MustSubFS(templatesEmbed, "templates")

var templates = template.NewRegistry()

// sendMail renders the named content template pairs with the layout and
// sends the message to all recipients. Errors are returned to the caller
// (they are only logged there since mails are fire-and-forget).
func sendMail(app core.App, contentTemplate string, subject string, data any, recipients []mail.Address) error {
	if len(recipients) == 0 {
		return nil // nothing to send
	}

	html, err := templates.LoadFS(
		templatesFS,
		"layout.html",
		contentTemplate,
	).Render(data)
	if err != nil {
		return fmt.Errorf("failed to render the %q template: %w", contentTemplate, err)
	}

	message := &mailer.Message{
		From: mail.Address{
			Address: app.Settings().Meta.SenderAddress,
			Name:    app.Settings().Meta.SenderName,
		},
		To:      recipients,
		Subject: subject,
		HTML:    html,
	}

	return app.NewMailClient().Send(message)
}

// logMailError reports a failed mail dispatch without failing the request.
func logMailError(app core.App, err error, what string, context string) {
	app.Logger().Warn(
		"Failed to send portal mail",
		slog.String("error", err.Error()),
		slog.String("mail", what),
		slog.String("context", context),
	)
}

// findRoleEmails returns the email addresses of all users matching the
// given role filter expression (e.g. "role = 'beirat'").
func findRoleEmails(app core.App, roleFilter string) ([]mail.Address, error) {
	users, err := app.FindRecordsByFilter(
		"users",
		roleFilter,
		"",
		0,
		0,
		nil,
	)
	if err != nil {
		return nil, err
	}

	recipients := make([]mail.Address, 0, len(users))
	for _, user := range users {
		recipients = append(recipients, mail.Address{
			Address: user.Email(),
			Name:    user.GetString("name"),
		})
	}

	return recipients, nil
}

// findNotifyNewIssuesEmails returns the email addresses of all
// hausmeister/hausverwaltung users with notify_new_issues = true.
func findNotifyNewIssuesEmails(app core.App) ([]mail.Address, error) {
	users, err := app.FindRecordsByFilter(
		"users",
		"(role = 'hausmeister' || role = 'hausverwaltung') && notify_new_issues = true && verified = true",
		"",
		0,
		0,
		nil,
	)
	if err != nil {
		return nil, err
	}

	recipients := make([]mail.Address, 0, len(users))
	for _, user := range users {
		recipients = append(recipients, mail.Address{
			Address: user.Email(),
			Name:    user.GetString("name"),
		})
	}

	return recipients, nil
}

// issueSubmitterAddress returns the submitter email of the issue from its
// issue_metas record ("" if there is no meta).
func issueSubmitterAddress(app core.App, issueId string) (string, error) {
	metas, err := app.FindRecordsByFilter(
		"issue_metas",
		"issue = {:issue}",
		"",
		1,
		0,
		dbx.Params{"issue": issueId},
	)
	if err != nil {
		return "", err
	}

	if len(metas) == 0 {
		return "", nil
	}

	return metas[0].GetString("email"), nil
}

// issueSubmitterDecisionKey maps a transition to the fixed decision word
// used in the submitter mail.
func issueSubmitterDecisionKey(oldStatus, newStatus string) string {
	switch {
	case oldStatus == "pending" && newStatus == "open":
		return "accepted"
	case oldStatus == "pending" && newStatus == "rejected":
		return "rejected"
	case oldStatus == "open" && newStatus == "in_progress":
		return "in_progress"
	case oldStatus == "in_progress" && newStatus == "resolved":
		return "resolved"
	}

	return newStatus
}

// issueSubmitterSubject returns the fixed German subject for the issue
// submitter mail (no user-supplied content).
func issueSubmitterSubject(newStatus string) string {
	switch newStatus {
	case "open":
		return "Ihre Meldung im WEG-Portal wurde angenommen"
	case "rejected":
		return "Ihre Meldung im WEG-Portal wurde abgelehnt"
	case "in_progress":
		return "Ihre Meldung im WEG-Portal wird bearbeitet"
	case "resolved":
		return "Ihre Meldung im WEG-Portal wurde erledigt"
	}

	return "Ihre Meldung im WEG-Portal: Statusaenderung"
}

// --------------------------------------------------------------------
// template data structs
// --------------------------------------------------------------------

// mailSubmitterData is the data for mails to unverified submitter
// addresses: fixed text, the decision and (suggestions only) the
// trustworthy Beirat decision_note. No user-supplied content!
type mailSubmitterData struct {
	AppName      string
	Decision     string // accepted | rejected | in_progress | resolved
	DecisionNote string // Beirat-authored, trusted
}

// mailBeiratSuggestionData is the data for the new-suggestion beirat mail
// (internal recipients may see the content).
type mailBeiratSuggestionData struct {
	AppName     string
	Title       string
	Description string
	DateStart   string
	Location    string
	Category    string
	Email       string
}

// mailBeiratIssueData is the data for the new-issue beirat mail.
type mailBeiratIssueData struct {
	AppName     string
	Title       string
	Description string
	Category    string
	Lat         float64
	Lng         float64
}

// mailStaffIssueData is the data for the accepted-issue staff mail
// (hausmeister/hausverwaltung with notify_new_issues = true).
type mailStaffIssueData struct {
	AppName    string
	Title      string
	Category   string
	Visibility string
	Lat        float64
	Lng        float64
}
