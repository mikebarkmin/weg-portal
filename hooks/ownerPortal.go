package hooks

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"slices"
	"strings"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/types"
)

// OwnerPortal registers the server-side logic of the owner features
// (migration 1795000105): calendar defaults, server-owned author fields,
// the agenda workflow, issue history, poll validation and results, the
// "my submissions" route, account deletion rules and the personal iCal
// feed token.
func OwnerPortal(app core.App) {
	// ---------------------------------------------------------------
	// events: the calendar defaults to public (API creates without it)
	// ---------------------------------------------------------------
	app.OnRecordCreateRequest("events").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.Record.GetString("calendar") == "" {
			e.Record.Set("calendar", "public")
		}
		return e.Next()
	})

	// the rrule is written into the iCal feed as its own content line: a
	// line break would let the author inject arbitrary iCal lines
	rejectRRuleLineBreaks := func(e *core.RecordRequestEvent) error {
		if strings.ContainsAny(e.Record.GetString("rrule"), "\r\n") {
			return e.BadRequestError("The recurrence rule must not contain line breaks.", nil)
		}
		return e.Next()
	}
	app.OnRecordCreateRequest("events").BindFunc(rejectRRuleLineBreaks)
	app.OnRecordUpdateRequest("events").BindFunc(rejectRRuleLineBreaks)

	// ---------------------------------------------------------------
	// server-owned author fields stay as created
	// ---------------------------------------------------------------
	keepField := func(collection, field string) {
		app.OnRecordUpdateRequest(collection).BindFunc(func(e *core.RecordRequestEvent) error {
			if !e.HasSuperuserAuth() {
				e.Record.Set(field, e.Record.Original().Get(field))
			}
			return e.Next()
		})
	}
	keepField("announcements", "author")
	keepField("polls", "created_by")
	keepField("agenda_items", "author")

	// legal pages: who changed them is recorded by the server
	app.OnRecordUpdateRequest("legal_pages").BindFunc(func(e *core.RecordRequestEvent) error {
		e.Record.Set("slug", e.Record.Original().Get("slug"))
		if e.Auth != nil && e.Auth.Collection().Name == "users" {
			e.Record.Set("updated_by", e.Auth.Id)
		} else {
			e.Record.Set("updated_by", "")
		}
		return e.Next()
	})

	// ---------------------------------------------------------------
	// agenda items: pending -> accepted | rejected (beirat)
	// ---------------------------------------------------------------
	app.OnRecordUpdateRequest("agenda_items").BindFunc(func(e *core.RecordRequestEvent) error {
		oldStatus := e.Record.Original().GetString("status")
		newStatus := e.Record.GetString("status")

		e.Record.Set("decided_at", e.Record.Original().Get("decided_at"))

		if oldStatus == newStatus {
			info, err := e.RequestInfo()
			if err != nil {
				return e.BadRequestError("Failed to read the submitted data.", err)
			}
			if _, submitted := info.Body["status"]; submitted {
				return e.BadRequestError("The topic is already in the status \""+oldStatus+"\".", nil)
			}
			return e.Next()
		}

		if oldStatus != "pending" || (newStatus != "accepted" && newStatus != "rejected") {
			return e.BadRequestError("Invalid status transition: \""+oldStatus+"\" -> \""+newStatus+"\".", nil)
		}
		e.Record.Set("decided_at", types.NowDateTime())

		return e.Next()
	})

	// ---------------------------------------------------------------
	// issue history: every status change becomes an issue_events entry
	// (written by the server, so it cannot be forged)
	// ---------------------------------------------------------------
	app.OnRecordUpdateRequest("issues").BindFunc(func(e *core.RecordRequestEvent) error {
		oldStatus := e.Record.Original().GetString("status")

		if err := e.Next(); err != nil {
			return err
		}

		newStatus := e.Record.GetString("status")
		if oldStatus == newStatus {
			return nil
		}

		actor := ""
		if e.Auth != nil && e.Auth.Collection().Name == "users" {
			actor = e.Auth.Id
		}
		if err := recordIssueEvent(e.App, e.Record.Id, actor, "status", oldStatus, newStatus, ""); err != nil {
			e.App.Logger().Warn("Failed to record the issue history", "issue", e.Record.Id, "error", err.Error())
		}

		return nil
	})

	app.OnRecordAfterCreateSuccess("issues").BindFunc(func(e *core.RecordEvent) error {
		if err := recordIssueEvent(e.App, e.Record.Id, "", "status", "", e.Record.GetString("status"), ""); err != nil {
			e.App.Logger().Warn("Failed to record the issue history", "issue", e.Record.Id, "error", err.Error())
		}
		return e.Next()
	})

	// notes: the API rule already requires actor = self; status fields
	// are never client-set
	app.OnRecordCreateRequest("issue_events").BindFunc(func(e *core.RecordRequestEvent) error {
		e.Record.Set("from_status", "")
		e.Record.Set("to_status", "")
		if strings.TrimSpace(e.Record.GetString("note")) == "" {
			return e.BadRequestError("The note must not be empty.", nil)
		}
		return e.Next()
	})

	// ---------------------------------------------------------------
	// polls: 2-10 non-empty options; options are frozen once voted on
	// ---------------------------------------------------------------
	validatePoll := func(e *core.RecordRequestEvent) error {
		options, ok := pollOptions(e.Record)
		if !ok {
			return e.BadRequestError("A poll needs 2 to 10 answer options (max. 200 characters each).", nil)
		}
		if !e.Record.IsNew() {
			original, _ := pollOptions(e.Record.Original())
			if !slices.Equal(original, options) {
				votes, err := e.App.CountRecords("poll_votes", dbx.HashExp{"poll": e.Record.Id})
				if err != nil {
					return e.InternalServerError("Failed to check the votes.", err)
				}
				if votes > 0 {
					return e.BadRequestError("The answer options cannot be changed after the first vote.", nil)
				}
			}
		}
		return e.Next()
	}
	app.OnRecordCreateRequest("polls").BindFunc(validatePoll)
	app.OnRecordUpdateRequest("polls").BindFunc(validatePoll)

	validateVote := func(e *core.RecordRequestEvent) error {
		poll, err := e.App.FindRecordById("polls", e.Record.GetString("poll"))
		if err != nil {
			return e.BadRequestError("Unknown poll.", nil)
		}
		options, _ := pollOptions(poll)
		option := e.Record.GetInt("option")
		if option < 0 || option >= len(options) {
			return e.BadRequestError("Unknown answer option.", nil)
		}
		return e.Next()
	}
	app.OnRecordCreateRequest("poll_votes").BindFunc(validateVote)
	app.OnRecordUpdateRequest("poll_votes").BindFunc(validateVote)

	// ---------------------------------------------------------------
	// accounts: owners may delete themselves; beirat and staff accounts
	// are managed by a superuser (they author notes/announcements and
	// their role was assigned by one)
	// ---------------------------------------------------------------
	app.OnRecordDeleteRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.HasSuperuserAuth() {
			return e.Next()
		}
		if e.Record.GetString("role") != "resident" {
			return e.ForbiddenError("Beirat, Hausmeister and Hausverwaltung accounts are deleted by a superuser. Please contact the Beirat.", nil)
		}
		return e.Next()
	})

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// -----------------------------------------------------------
		// GET /api/portal/my-submissions: what the logged-in owner has
		// submitted while logged in (issues regardless of visibility -
		// they are the reporter), never other people's data
		// -----------------------------------------------------------
		se.Router.GET("/api/portal/my-submissions", func(e *core.RequestEvent) error {
			if e.Auth == nil || e.Auth.Collection().Name != "users" {
				return e.UnauthorizedError("Please log in.", nil)
			}

			metas, err := e.App.FindRecordsByFilter("issue_metas", "user = {:user}", "", 0, 0, dbx.Params{"user": e.Auth.Id})
			if err != nil {
				return e.InternalServerError("Failed to load the reports.", err)
			}
			issueItems := make([]map[string]any, 0, len(metas))
			for _, meta := range metas {
				issue, err := e.App.FindRecordById("issues", meta.GetString("issue"))
				if err != nil {
					continue
				}
				issueItems = append(issueItems, map[string]any{
					"id":          issue.Id,
					"title":       issue.GetString("title"),
					"status":      issue.GetString("status"),
					"visibility":  issue.GetString("visibility"),
					"created":     issue.GetString("created"),
					"decided_at":  issue.GetString("decided_at"),
					"resolved_at": issue.GetString("resolved_at"),
					// the reporter always sees where they reported
					"location": issueLocationView(e.App, issue.Id),
				})
			}

			suggestions, err := e.App.FindRecordsByFilter("suggestions", "user = {:user}", "-created", 0, 0, dbx.Params{"user": e.Auth.Id})
			if err != nil {
				return e.InternalServerError("Failed to load the suggestions.", err)
			}
			suggestionItems := make([]map[string]any, 0, len(suggestions))
			for _, s := range suggestions {
				suggestionItems = append(suggestionItems, map[string]any{
					"id":            s.Id,
					"title":         s.GetString("title"),
					"status":        s.GetString("status"),
					"date_start":    s.GetString("date_start"),
					"all_day":       s.GetBool("all_day"),
					"decision_note": s.GetString("decision_note"),
					"created":       s.GetString("created"),
					"decided_at":    s.GetString("decided_at"),
				})
			}

			return e.JSON(http.StatusOK, map[string]any{
				"issues":      issueItems,
				"suggestions": suggestionItems,
			})
		})

		// -----------------------------------------------------------
		// GET /api/portal/retention: the current deletion periods (days)
		// for the privacy policy placeholders - public, nothing secret
		// -----------------------------------------------------------
		se.Router.GET("/api/portal/retention", func(e *core.RequestEvent) error {
			settings, err := e.App.FindFirstRecordByFilter("portal_settings", "id != ''")
			if err != nil {
				return e.NotFoundError("No retention settings.", nil)
			}
			result := map[string]int{}
			for _, field := range []string{
				"retention_suggestions_rejected_days",
				"retention_suggestions_accepted_days",
				"retention_issues_rejected_days",
				"retention_issues_resolved_days",
			} {
				result[field] = settings.GetInt(field)
			}
			return e.JSON(http.StatusOK, result)
		})

		// -----------------------------------------------------------
		// GET /api/portal/polls/{id}/results: aggregated counts only
		// -----------------------------------------------------------
		se.Router.GET("/api/portal/polls/{id}/results", func(e *core.RequestEvent) error {
			poll, err := e.App.FindRecordById("polls", e.Request.PathValue("id"))
			if err != nil {
				return e.NotFoundError("", nil)
			}
			info, err := e.RequestInfo()
			if err != nil {
				return e.BadRequestError("", err)
			}
			if ok, _ := e.App.CanAccessRecord(poll, info, poll.Collection().ViewRule); !ok {
				return e.NotFoundError("", nil)
			}

			options, _ := pollOptions(poll)
			counts := make([]int, len(options))
			var rows []struct {
				Option int `db:"option"`
				Total  int `db:"total"`
			}
			if err := e.App.DB().
				Select("option", "count(*) as total").
				From("poll_votes").
				Where(dbx.HashExp{"poll": poll.Id}).
				GroupBy("option").
				All(&rows); err != nil {
				return e.InternalServerError("Failed to count the votes.", err)
			}
			total := 0
			for _, row := range rows {
				if row.Option >= 0 && row.Option < len(counts) {
					counts[row.Option] = row.Total
					total += row.Total
				}
			}

			return e.JSON(http.StatusOK, map[string]any{"counts": counts, "total": total})
		})

		// -----------------------------------------------------------
		// POST /api/portal/calendar-token: the secret of the personal
		// iCal feed (created on first use; {"renew": true} replaces it,
		// which invalidates every subscribed copy of the old URL)
		// -----------------------------------------------------------
		se.Router.POST("/api/portal/calendar-token", func(e *core.RequestEvent) error {
			if e.Auth == nil || e.Auth.Collection().Name != "users" {
				return e.UnauthorizedError("Please log in.", nil)
			}
			body := struct {
				Renew bool `json:"renew"`
			}{}
			_ = e.BindBody(&body)

			user, err := e.App.FindRecordById("users", e.Auth.Id)
			if err != nil {
				return e.NotFoundError("", nil)
			}
			token := user.GetString("ical_token")
			if token == "" || body.Renew {
				token, err = randomToken()
				if err != nil {
					return e.InternalServerError("Failed to create the token.", err)
				}
				user.Set("ical_token", token)
				if err := e.App.Save(user); err != nil {
					return e.InternalServerError("Failed to save the token.", err)
				}
			}

			return e.JSON(http.StatusOK, map[string]string{"token": token})
		})

		return se.Next()
	})
}

// recordIssueEvent appends one entry to the issue history.
func recordIssueEvent(app core.App, issueId, actor, kind, from, to, note string) error {
	collection, err := app.FindCachedCollectionByNameOrId("issue_events")
	if err != nil {
		return err
	}
	event := core.NewRecord(collection)
	event.Set("issue", issueId)
	event.Set("actor", actor)
	event.Set("type", kind)
	event.Set("from_status", from)
	event.Set("to_status", to)
	event.Set("note", note)
	return app.Save(event)
}

// pollOptions returns the poll's answer options and whether they are a
// valid list of 2-10 non-empty strings (max. 200 characters each).
func pollOptions(record *core.Record) ([]string, bool) {
	var raw []any
	if err := record.UnmarshalJSONField("options", &raw); err != nil {
		return nil, false
	}
	options := make([]string, 0, len(raw))
	for _, item := range raw {
		s, isString := item.(string)
		s = strings.TrimSpace(s)
		if !isString || s == "" || len([]rune(s)) > 200 {
			return nil, false
		}
		options = append(options, s)
	}
	return options, len(options) >= 2 && len(options) <= 10
}

// calendarsFor returns the calendars an account may see (the rules of
// the events collection, for the iCal feed and the event mails).
func calendarsFor(user *core.Record) []string {
	if user == nil {
		return []string{"public"}
	}
	// admins see what the Beirat sees (beirat calendar included)
	if user.GetString("role") == "beirat" || user.GetString("role") == "admin" {
		return []string{"public", "owners", "beirat"}
	}
	if user.GetBool("approved") && user.Verified() {
		return []string{"public", "owners"}
	}
	return []string{"public"}
}

func randomToken() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}
