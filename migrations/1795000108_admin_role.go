package migrations

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	m "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

// The admin role: an in-app account manager (previously a superuser-only
// task in /_/, see the roles matrix). Users with this role manage other
// accounts through the integrated /admin page - creating users, changing
// their role, approving/denying them, resetting their password and
// removing them - via the custom routes in hooks/adminUsers.go.
//
// This migration only widens the `role` select values and lets admins
// list/view `users` records (the admin page needs the full list). All
// write operations go exclusively through the admin routes; the
// collection rules and the usersCreate/usersUpdate hooks stay
// authoritative for every other endpoint.
func init() {
	m.Register(func(app core.App) error {
		return setAdminRole(app, true)
	}, func(app core.App) error {
		return setAdminRole(app, false)
	})
}

func setAdminRole(app core.App, enabled bool) error {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}

	roleField, ok := users.Fields.GetByName("role").(*core.SelectField)
	if !ok {
		return nil
	}

	hasAdmin := false
	for _, v := range roleField.Values {
		if v == "admin" {
			hasAdmin = true
			break
		}
	}
	if enabled && !hasAdmin {
		roleField.Values = append(roleField.Values, "admin")
	}
	if !enabled && hasAdmin {
		values := make([]string, 0, len(roleField.Values))
		for _, v := range roleField.Values {
			if v != "admin" {
				values = append(values, v)
			}
		}
		roleField.Values = values
	}

	own := "@request.auth.id = id"
	beirat := "@request.auth.role = 'beirat'"
	admin := "@request.auth.role = 'admin'"
	rule := own + " || " + beirat
	if enabled {
		rule = own + " || " + beirat + " || " + admin
	}
	users.ListRule = &rule
	users.ViewRule = &rule

	return app.Save(users)
}
