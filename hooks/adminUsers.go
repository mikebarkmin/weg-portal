package hooks

import (
	"crypto/rand"
	"errors"
	"math/big"
	"net/http"
	"strings"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// AdminUserPayload is the shared body of the admin routes. Only the
// fields listed here can ever be written by an admin.
type AdminUserPayload struct {
	Name            string `json:"name"`
	Email           string `json:"email"`
	Role            string `json:"role"`
	Approved        *bool  `json:"approved"`
	Verified        *bool  `json:"verified"`
	NotifyNewIssues *bool  `json:"notify_new_issues"`
	Password        string `json:"password"` // create/reset only, "" = generate
}

const adminMinPasswordLength = 8

// AdminUsers registers the account management routes for the `admin` role
// (plan.md "Roles matrix"): everything that previously required a
// superuser in the PocketBase dashboard can be done by an admin in the
// integrated /admin page.
//
//	POST   /api/portal/admin/users             create a user
//	PATCH  /api/portal/admin/users/{id}        change name/email/role/flags
//	POST   /api/portal/admin/users/{id}/reset-password
//	DELETE /api/portal/admin/users/{id}        remove a user
//
// The routes bypass the collection API on purpose (its rules keep the
// beirat/owner semantics and its hooks forbid non-superuser role writes);
// they run server-side with full record access, so every guard lives here:
//
//   - only logged-in admins (or superusers) may call them
//   - an admin never operates on their own record (profile page)
//   - the last active admin can neither be demoted nor removed
//
// A password reset either accepts an admin-chosen password or generates
// one server-side; a generated password is returned exactly once, so the
// admin can hand it over - it is neither stored nor mailed in plain text.
func AdminUsers(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.POST("/api/portal/admin/users", func(e *core.RequestEvent) error {
			if _, err := requireAdmin(e); err != nil {
				return err
			}

			body := AdminUserPayload{}
			if err := e.BindBody(&body); err != nil {
				return e.BadRequestError("Failed to read the submitted data.", err)
			}

			if body.Name = strings.TrimSpace(body.Name); body.Name == "" {
				return e.BadRequestError("Name is required.", nil)
			}
			if err := validateEmailField(body.Email); err != nil {
				return e.BadRequestError(err.Error(), nil)
			}

			roles, err := availableRoles(e)
			if err != nil {
				return e.InternalServerError("Failed to load the roles.", err)
			}
			if !isRole(roles, body.Role) {
				return e.BadRequestError("Unknown role.", nil)
			}

			if body.Password != "" && len(body.Password) < adminMinPasswordLength {
				return e.BadRequestError("The password must be at least 8 characters long.", nil)
			}

			users, err := e.App.FindCollectionByNameOrId("users")
			if err != nil {
				return e.InternalServerError("Failed to load the users collection.", err)
			}

			record := core.NewRecord(users)
			record.Set("name", body.Name)
			record.Set("email", strings.ToLower(strings.TrimSpace(body.Email)))
			record.Set("emailVisibility", true)
			record.Set("role", body.Role)

			// admin-created accounts skip the signup flow: the admin has
			// verified the person offline, so the approval and email
			// confirmation gates default to "done" unless set otherwise
			approved := true
			if body.Approved != nil {
				approved = *body.Approved
			}
			verified := true
			if body.Verified != nil {
				verified = *body.Verified
			}
			record.Set("approved", approved)
			record.Set("verified", verified)

			// keep the create hook's default for staff accounts
			if body.Role == "hausmeister" || body.Role == "hausverwaltung" {
				notify := true
				if body.NotifyNewIssues != nil {
					notify = *body.NotifyNewIssues
				}
				record.Set("notify_new_issues", notify)
			}

			password := body.Password
			if password == "" {
				password, err = generatePassword()
				if err != nil {
					return e.InternalServerError("Failed to generate a password.", err)
				}
			}
			record.SetPassword(password)

			if err := e.App.Save(record); err != nil {
				return e.BadRequestError("Failed to create the user.", err)
			}

			response := adminUserView(record)
			if body.Password == "" {
				// generated: handed over exactly once
				response["password"] = password
			}
			return e.JSON(http.StatusOK, response)
		})

		se.Router.PATCH("/api/portal/admin/users/{id}", func(e *core.RequestEvent) error {
			caller, err := requireAdmin(e)
			if err != nil {
				return err
			}

			body := AdminUserPayload{}
			if err := e.BindBody(&body); err != nil {
				return e.BadRequestError("Failed to read the submitted data.", err)
			}

			record, err := e.App.FindRecordById("users", e.Request.PathValue("id"))
			if err != nil {
				return e.NotFoundError("", nil)
			}
			if record.Id == caller.Id {
				return e.BadRequestError("Your own account is managed in the profile settings.", nil)
			}

			if body.Role != "" {
				roles, err := availableRoles(e)
				if err != nil {
					return e.InternalServerError("Failed to load the roles.", err)
				}
				if !isRole(roles, body.Role) {
					return e.BadRequestError("Unknown role.", nil)
				}
				if record.GetString("role") == "admin" && body.Role != "admin" {
					if err := assertNotLastAdmin(e, record); err != nil {
						return err
					}
				}
				record.Set("role", body.Role)
			}
			if body.Name != "" {
				record.Set("name", strings.TrimSpace(body.Name))
			}
			if body.Email != "" {
				if err := validateEmailField(body.Email); err != nil {
					return e.BadRequestError(err.Error(), nil)
				}
				// a direct change on the admin's authority: no confirmation
				// mail flow (the admin is expected to have verified the
				// address offline)
				record.Set("email", strings.ToLower(strings.TrimSpace(body.Email)))
			}
			if body.Approved != nil {
				record.Set("approved", *body.Approved)
			}
			if body.Verified != nil {
				record.Set("verified", *body.Verified)
			}
			if body.NotifyNewIssues != nil {
				record.Set("notify_new_issues", *body.NotifyNewIssues)
			}

			if err := e.App.Save(record); err != nil {
				return e.BadRequestError("Failed to save the user.", err)
			}

			return e.JSON(http.StatusOK, adminUserView(record))
		})

		se.Router.POST("/api/portal/admin/users/{id}/reset-password", func(e *core.RequestEvent) error {
			caller, err := requireAdmin(e)
			if err != nil {
				return err
			}

			body := AdminUserPayload{}
			if err := e.BindBody(&body); err != nil {
				return e.BadRequestError("Failed to read the submitted data.", err)
			}

			record, err := e.App.FindRecordById("users", e.Request.PathValue("id"))
			if err != nil {
				return e.NotFoundError("", nil)
			}
			if record.Id == caller.Id {
				return e.BadRequestError("Your own password is changed in the profile settings.", nil)
			}

			password := strings.TrimSpace(body.Password)
			if password == "" {
				password, err = generatePassword()
				if err != nil {
					return e.InternalServerError("Failed to generate a password.", err)
				}
			} else if len(password) < adminMinPasswordLength {
				return e.BadRequestError("The password must be at least 8 characters long.", nil)
			}

			record.SetPassword(password)
			if err := e.App.Save(record); err != nil {
				return e.BadRequestError("Failed to save the password.", err)
			}

			return e.JSON(http.StatusOK, map[string]any{"password": password})
		})

		se.Router.DELETE("/api/portal/admin/users/{id}", func(e *core.RequestEvent) error {
			caller, err := requireAdmin(e)
			if err != nil {
				return err
			}

			record, err := e.App.FindRecordById("users", e.Request.PathValue("id"))
			if err != nil {
				return e.NotFoundError("", nil)
			}
			if record.Id == caller.Id {
				return e.BadRequestError("Your own account is deleted in the profile settings.", nil)
			}
			if record.GetString("role") == "admin" {
				if err := assertNotLastAdmin(e, record); err != nil {
					return err
				}
			}

			if err := e.App.Delete(record); err != nil {
				return e.InternalServerError("Failed to delete the user.", err)
			}

			return e.NoContent(204)
		})

		return se.Next()
	})
}

// requireAdmin guards every admin route: the caller must be a logged-in,
// approved and verified `users` record with the role admin - or a
// superuser (the routes are a subset of what /_/ offers anyway).
func requireAdmin(e *core.RequestEvent) (*core.Record, error) {
	if e.Auth == nil {
		return nil, e.UnauthorizedError("Please log in.", nil)
	}

	if e.Auth.Collection().Name == "_superusers" {
		return e.Auth, nil
	}

	if e.Auth.Collection().Name != "users" ||
		e.Auth.GetString("role") != "admin" ||
		!e.Auth.GetBool("approved") ||
		!e.Auth.GetBool("verified") {
		return nil, e.ForbiddenError("Only admins may manage accounts.", nil)
	}

	return e.Auth, nil
}

// availableRoles returns the valid `users.role` values from the collection
// schema, so the select field (migration 1795000108) stays the single
// source of truth.
func availableRoles(e *core.RequestEvent) ([]string, error) {
	users, err := e.App.FindCollectionByNameOrId("users")
	if err != nil {
		return nil, err
	}
	if field, ok := users.Fields.GetByName("role").(*core.SelectField); ok {
		return field.Values, nil
	}
	return nil, nil
}

func isRole(roles []string, role string) bool {
	for _, r := range roles {
		if r == role {
			return true
		}
	}
	return false
}

func validateEmailField(email string) error {
	email = strings.TrimSpace(email)
	if email == "" {
		return errors.New("Email is required.")
	}
	// a minimal shape check - PocketBase validates the field again on save
	if !strings.Contains(email, "@") || strings.ContainsAny(email, " \t") {
		return errors.New("Invalid email address.")
	}
	return nil
}

// assertNotLastAdmin refuses demote/delete when no other active
// (approved + verified) admin remains besides the target. An admin never
// operates on their own record (see the route guards), so the caller
// themself does not keep the target deletable.
func assertNotLastAdmin(e *core.RequestEvent, target *core.Record) error {
	others, err := e.App.FindRecordsByFilter(
		"users",
		"role = 'admin' && approved = true && verified = true && id != {:exclude}",
		"", 1, 0,
		dbx.Params{"exclude": target.Id},
	)
	if err != nil {
		return e.InternalServerError("Failed to check the admin accounts.", err)
	}
	if len(others) == 0 {
		return e.BadRequestError("At least one other active admin must remain.", nil)
	}
	return nil
}

// generatePassword creates a 14 character random password from an
// unambiguous alphabet (no 0/O, 1/l/I) that survives being handed over
// in person or read over the phone.
func generatePassword() (string, error) {
	alphabet := "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ"
	password := make([]byte, 14)
	for i := range password {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			return "", err
		}
		password[i] = alphabet[n.Int64()]
	}
	return string(password), nil
}

// adminUserView is the response shape of the create/update routes: the
// fields the admin page needs - never a password hash or auth internals.
func adminUserView(record *core.Record) map[string]any {
	return map[string]any{
		"id":       record.Id,
		"name":     record.GetString("name"),
		"email":    record.Email(),
		"role":     record.GetString("role"),
		"approved": record.GetBool("approved"),
		"verified": record.GetBool("verified"),
	}
}
