package migrations

import (
	"strings"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	m "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

// Issue lifecycle additions (plan.md "Issue update rule"):
//
//   - the new status value "archived": the Beirat/Admin takes an accepted
//     issue off the board (open/in_progress/resolved -> archived) without
//     deleting it. Archived issues vanish from the member and staff board;
//     the Beirat/Admin still sees them, the reporter their own entry in
//     "Meine Einreichungen". Unarchiving returns to "open".
//   - the admin role may delete an issue (rule replaces the previous
//     superuser-only delete; metas/locations/events cascade with the
//     issue record). The retention cron keeps deleting server-side.
//
// The backlog transitions (reopen/defer/unarchive) are validated by
// hooks/issueWorkflow.go, not by a rule: the Beirat/Admin update rule is
// deliberately unrestricted, the Hausmeister rule never lets a request
// take archived/open as the new status.
func init() {
	const (
		memberHiddenClause = " && status != 'pending' && status != 'rejected'"
		withArchived       = " && status != 'pending' && status != 'rejected' && status != 'archived'"
		adminOnly          = "@request.auth.role = 'admin'"
	)

	m.Register(func(app core.App) error {
		issues, err := app.FindCollectionByNameOrId("issues")
		if err != nil {
			return err
		}

		field := issues.Fields.GetByName("status").(*core.SelectField)
		if !sliceContains(field.Values, "archived") {
			field.Values = append(field.Values, "archived")
		}

		if issues.ListRule != nil {
			issues.ListRule = rule(strings.ReplaceAll(*issues.ListRule, memberHiddenClause, withArchived))
		}
		if issues.ViewRule != nil {
			issues.ViewRule = rule(strings.ReplaceAll(*issues.ViewRule, memberHiddenClause, withArchived))
		}
		issues.DeleteRule = rule(adminOnly)

		return app.Save(issues)
	}, func(app core.App) error {
		issues, err := app.FindCollectionByNameOrId("issues")
		if err != nil {
			return err
		}

		field := issues.Fields.GetByName("status").(*core.SelectField)
		filtered := make([]string, 0, len(field.Values))
		for _, value := range field.Values {
			if value != "archived" {
				filtered = append(filtered, value)
			}
		}
		field.Values = filtered

		if issues.ListRule != nil {
			issues.ListRule = rule(strings.ReplaceAll(*issues.ListRule, withArchived, memberHiddenClause))
		}
		if issues.ViewRule != nil {
			issues.ViewRule = rule(strings.ReplaceAll(*issues.ViewRule, withArchived, memberHiddenClause))
		}
		issues.DeleteRule = nil

		return app.Save(issues)
	})
}

func sliceContains(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}
