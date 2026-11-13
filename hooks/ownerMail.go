package hooks

import (
	"net/mail"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// OwnerMail sends the opt-in notifications of the owner features:
//
//   - new announcement -> accounts with notify_announcements = true that
//     can see it (public: every verified account; owners: approved ones)
//   - new calendar event -> accounts with notify_events = true that can
//     see its calendar (beirat calendar: Beirat only)
//   - new agenda topic -> all Beirat members
//   - agenda decision -> the author (a verified account, so the topic
//     title may be quoted)
//
// Recipients are verified accounts; every mail goes to ONE recipient so
// no address is disclosed to the others.
func OwnerMail(app core.App) {
	app.OnRecordAfterCreateSuccess("announcements").BindFunc(func(e *core.RecordEvent) error {
		// "public" | "owners": only accounts that may read the announcement
		// in the portal are mailed (an unapproved account sees "public" only)
		visibility := e.Record.GetString("visibility")
		data := mailAnnouncementData{
			Title: e.Record.GetString("title"),
			Body:  e.Record.GetString("body"),
			Link:  portalLink(app, "/aktuelles#"+e.Record.Id),
		}
		notifyAsync(app, func() {
			data.AppName = app.Settings().Meta.AppName
			recipients, err := findOptInEmails(app, "notify_announcements", []string{visibility})
			if err != nil {
				logMailError(app, err, "announcement mail", "")
				return
			}
			sendEach(app, "announcement.html", "Neuer Aushang: "+data.Title, data, recipients, "announcement mail")
		})
		return e.Next()
	})

	app.OnRecordAfterCreateSuccess("events").BindFunc(func(e *core.RecordEvent) error {
		calendar := e.Record.GetString("calendar")
		data := mailEventData{
			Title:    e.Record.GetString("title"),
			Date:     formatMailDate(e.Record.GetDateTime("date_start").Time(), e.Record.GetBool("all_day")),
			Location: e.Record.GetString("location"),
			Calendar: calendarLabel(calendar),
			Link:     portalLink(app, "/events/"+e.Record.Id),
		}
		notifyAsync(app, func() {
			data.AppName = app.Settings().Meta.AppName
			recipients, err := findOptInEmails(app, "notify_events", []string{calendar})
			if err != nil {
				logMailError(app, err, "event mail", "")
				return
			}
			sendEach(app, "event_new.html", "Neuer Termin: "+data.Title, data, recipients, "event mail")
		})
		return e.Next()
	})

	app.OnRecordAfterCreateSuccess("agenda_items").BindFunc(func(e *core.RecordEvent) error {
		data := mailAgendaData{
			Title:       e.Record.GetString("title"),
			Description: e.Record.GetString("description"),
			Link:        portalLink(app, "/moderation"),
		}
		notifyAsync(app, func() {
			data.AppName = app.Settings().Meta.AppName
			recipients, err := findRoleEmails(app, beiratRecipientsFilter)
			if err != nil {
				logMailError(app, err, "agenda beirat mail", "")
				return
			}
			sendEach(app, "beirat_new_agenda.html", "Neues Thema für die Versammlung: "+data.Title, data, recipients, "agenda beirat mail")
		})
		return e.Next()
	})

	app.OnRecordAfterUpdateSuccess("agenda_items").BindFunc(func(e *core.RecordEvent) error {
		oldStatus := e.Record.Original().GetString("status")
		newStatus := e.Record.GetString("status")
		authorId := e.Record.GetString("author")
		if oldStatus == newStatus || authorId == "" {
			return e.Next()
		}
		data := mailAgendaData{
			Title:        e.Record.GetString("title"),
			Decision:     newStatus,
			DecisionNote: e.Record.GetString("decision_note"),
			Link:         portalLink(app, "/mitreden"),
		}
		notifyAsync(app, func() {
			data.AppName = app.Settings().Meta.AppName
			author, err := app.FindRecordById("users", authorId)
			if err != nil || !author.Verified() {
				return
			}
			subject := "Ihr Thema für die Versammlung wurde angenommen"
			if newStatus == "rejected" {
				subject = "Ihr Thema für die Versammlung wurde nicht aufgenommen"
			}
			sendEach(app, "agenda_decision.html", subject, data,
				[]mail.Address{{Address: author.Email(), Name: author.GetString("name")}}, "agenda decision mail")
		})
		return e.Next()
	})
}

// findOptInEmails returns verified accounts that opted in via flag and can
// see at least one of the calendars/visibilities.
func findOptInEmails(app core.App, flag string, visible []string) ([]mail.Address, error) {
	users, err := app.FindRecordsByFilter("users", flag+" = true && verified = true", "", 0, 0, dbx.Params{})
	if err != nil {
		return nil, err
	}
	result := make([]mail.Address, 0, len(users))
	for _, user := range users {
		allowed := calendarsFor(user)
		for _, v := range visible {
			if containsString(allowed, v) {
				result = append(result, mail.Address{Address: user.Email(), Name: user.GetString("name")})
				break
			}
		}
	}
	return result, nil
}

func containsString(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

// sendEach sends one mail per recipient (no shared To: header).
func sendEach(app core.App, tpl, subject string, data any, recipients []mail.Address, what string) {
	for _, recipient := range recipients {
		if err := sendMail(app, tpl, subject, data, []mail.Address{recipient}); err != nil {
			logMailError(app, err, what, recipient.Address)
		}
	}
}

func calendarLabel(calendar string) string {
	switch calendar {
	case "owners":
		return "Eigentümer"
	case "beirat":
		return "Beirat"
	}
	return "Öffentlich"
}

type mailAnnouncementData struct {
	AppName string
	Title   string
	Body    string
	Link    string
}

type mailEventData struct {
	AppName  string
	Title    string
	Date     string
	Location string
	Calendar string
	Link     string
}

type mailAgendaData struct {
	AppName      string
	Title        string
	Description  string
	Decision     string
	DecisionNote string
	Link         string
}
