package hooks

import (
	"math"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Issue locations inside the property (migration 1795000112): the
// selectable areas (issue_areas) and the per-issue location
// (issue_locations).
//
// IssueAreas registers
//
//   - GET  /api/portal/issue-areas: the area list for the report form.
//     Public (guests report too) - it only carries names and floor labels.
//     The plan file name is added for approved accounts, the only ones
//     whose file token passes the issue_areas view rule.
//   - POST /api/portal/issues/{id}/location-share: the Beirat shares the
//     location of one issue with Hausmeister/Hausverwaltung (or revokes it).
//   - the issue_locations enrich hook and the issue_areas floor validation.
func IssueAreas(app core.App) {
	// every issue_locations field is Hidden so that nobody can filter or
	// sort by them through a relation (see the migration). Whoever gets a
	// record in a response has already passed the collection's list/view
	// rule, so the fields are unhidden for all portal accounts.
	app.OnRecordEnrich("issue_locations").BindFunc(func(e *core.RecordEnrichEvent) error {
		if e.RequestInfo != nil && e.RequestInfo.Auth != nil && e.RequestInfo.Auth.Collection().Name == "users" {
			e.Record.Unhide("issue", "area", "floor", "has_pin", "x", "y", "shared")
		}

		return e.Next()
	})

	validateArea := func(e *core.RecordRequestEvent) error {
		floors, ok := areaFloors(e.Record)
		if !ok {
			return e.BadRequestError("The floors must be a list of up to 30 distinct labels (max. 50 characters each).", nil)
		}
		// store the trimmed list ([] instead of null/garbage)
		e.Record.Set("floors", floors)
		e.Record.Set("name", strings.TrimSpace(e.Record.GetString("name")))

		return e.Next()
	}
	app.OnRecordCreateRequest("issue_areas").BindFunc(validateArea)
	app.OnRecordUpdateRequest("issue_areas").BindFunc(validateArea)

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.GET("/api/portal/issue-areas", func(e *core.RequestEvent) error {
			areas, err := e.App.FindRecordsByFilter("issue_areas", "id != ''", "sort,name", 0, 0)
			if err != nil {
				return e.InternalServerError("Failed to load the areas.", err)
			}

			withPlan := isApprovedAccount(e.Auth)

			items := make([]map[string]any, 0, len(areas))
			for _, area := range areas {
				floors, _ := areaFloors(area)
				item := map[string]any{
					"id":       area.Id,
					"name":     area.GetString("name"),
					"floors":   floors,
					"active":   area.GetBool("active"),
					"has_plan": area.GetString("plan") != "",
				}
				if withPlan {
					item["plan"] = area.GetString("plan")
				}
				items = append(items, item)
			}

			return e.JSON(http.StatusOK, map[string]any{"areas": items})
		})

		se.Router.POST("/api/portal/issues/{id}/location-share", func(e *core.RequestEvent) error {
			if e.Auth == nil {
				return e.UnauthorizedError("Please log in.", nil)
			}
			if !isApprovedAccount(e.Auth) || !isBeiratRole(e.Auth.GetString("role")) {
				return e.ForbiddenError("Only the Beirat may share a location.", nil)
			}

			body := struct {
				Shared *bool `json:"shared"`
			}{}
			if err := e.BindBody(&body); err != nil || body.Shared == nil {
				return e.BadRequestError("The field \"shared\" (true or false) is required.", err)
			}

			location, err := e.App.FindFirstRecordByData("issue_locations", "issue", e.Request.PathValue("id"))
			if err != nil {
				return e.NotFoundError("The report has no location.", nil)
			}

			location.Set("shared", *body.Shared)
			if err := e.App.Save(location); err != nil {
				return e.InternalServerError("Failed to update the location.", err)
			}

			return e.JSON(http.StatusOK, map[string]bool{"ok": true})
		})

		return se.Next()
	})
}

// isApprovedAccount reports whether auth is an approved and verified
// `users` record (the accounts that may load the area plans).
func isApprovedAccount(auth *core.Record) bool {
	return auth != nil &&
		auth.Collection().Name == "users" &&
		auth.GetBool("approved") &&
		auth.GetBool("verified")
}

// isBeiratRole: admins have every Beirat capability (migration 1795000109).
func isBeiratRole(role string) bool {
	return role == "beirat" || role == "admin"
}

// areaFloors returns the area's floor labels (trimmed) and whether the
// stored value is a valid list: up to 30 distinct, non-empty labels of at
// most 50 characters. A missing value is an empty list.
func areaFloors(record *core.Record) ([]string, bool) {
	floors := []string{}

	raw := strings.TrimSpace(record.GetString("floors"))
	if raw == "" || raw == "null" {
		return floors, true
	}

	var items []any
	if err := record.UnmarshalJSONField("floors", &items); err != nil {
		return floors, false
	}
	if len(items) > 30 {
		return floors, false
	}
	for _, item := range items {
		s, isString := item.(string)
		s = strings.TrimSpace(s)
		if !isString || s == "" || len([]rune(s)) > 50 || slices.Contains(floors, s) {
			return []string{}, false
		}
		floors = append(floors, s)
	}

	return floors, true
}

// issueLocationInput is a validated location of a new report.
type issueLocationInput struct {
	area   string
	floor  string
	hasPin bool
	x, y   float64
}

// parseIssueLocation validates the optional location of a report:
//
//   - no area: no location (floor and pin must then be empty too)
//   - the area must exist and be active
//   - the floor is optional and must be one of the area's floor labels
//   - the pin (x and y, 0..1) needs an area with a plan and an approved
//     account - nobody else can see the plan to place it
func parseIssueLocation(app core.App, form url.Values, auth *core.Record) (*issueLocationInput, string) {
	areaId := strings.TrimSpace(form.Get("area"))
	floor := strings.TrimSpace(form.Get("floor"))
	rawX := strings.TrimSpace(form.Get("x"))
	rawY := strings.TrimSpace(form.Get("y"))

	if areaId == "" {
		if floor != "" || rawX != "" || rawY != "" {
			return nil, "A floor or pin needs an area."
		}
		return nil, ""
	}

	area, err := app.FindRecordById("issue_areas", areaId)
	if err != nil || !area.GetBool("active") {
		return nil, "Unknown area."
	}

	if floor != "" {
		floors, _ := areaFloors(area)
		if !slices.Contains(floors, floor) {
			return nil, "Unknown floor for this area."
		}
	}

	location := &issueLocationInput{area: area.Id, floor: floor}

	if rawX == "" && rawY == "" {
		return location, ""
	}

	if area.GetString("plan") == "" || !isApprovedAccount(auth) {
		return nil, "A pin is not possible for this area."
	}

	x, errX := strconv.ParseFloat(rawX, 64)
	y, errY := strconv.ParseFloat(rawY, 64)
	// strconv.ParseFloat also accepts NaN/Inf, which would pass a plain
	// range comparison
	if errX != nil || errY != nil || math.IsNaN(x) || math.IsNaN(y) || x < 0 || x > 1 || y < 0 || y > 1 {
		return nil, "The pin must be a position on the plan."
	}

	location.hasPin = true
	location.x = x
	location.y = y

	return location, ""
}

// issueLocationView is the location of an issue as plain data for the
// custom routes (never use it for other people's issues without an
// access check), or nil when the issue has none.
func issueLocationView(app core.App, issueId string) map[string]any {
	location, err := app.FindFirstRecordByData("issue_locations", "issue", issueId)
	if err != nil {
		return nil
	}

	areaName := ""
	if area, err := app.FindRecordById("issue_areas", location.GetString("area")); err == nil {
		areaName = area.GetString("name")
	}

	return map[string]any{
		"area":      location.GetString("area"),
		"area_name": areaName,
		"floor":     location.GetString("floor"),
		"has_pin":   location.GetBool("has_pin"),
		"x":         location.GetFloat("x"),
		"y":         location.GetFloat("y"),
		"shared":    location.GetBool("shared"),
	}
}
