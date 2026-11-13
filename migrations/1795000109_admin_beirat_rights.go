package migrations

import (
	"strings"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	m "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

// The admin role gets every Beirat capability (not only the account
// management of migration 1795000108): editing all three calendars,
// moderation, notices, documents, contacts, notes, legal texts, polls,
// meeting topics - everything the `beirat` rules previously reserved
// for the Beirat.
//
// Every collection rule that mentions `@request.auth.role = 'beirat'` is
// widened to
//
//	(@request.auth.role = 'beirat' || @request.auth.role = 'admin')
//
// by walking all collections and all five of their rule fields. The
// expansion stays inside parentheses, so the restricted parts of
// composite rules (e.g. the events calendar read rule) remain
// correctly scoped. The down migration reverses the replacement.
func init() {
	m.Register(func(app core.App) error {
		return rewriteBeiratRules(app, "(@request.auth.role = 'beirat' || @request.auth.role = 'admin')")
	}, func(app core.App) error {
		return rewriteBeiratRules(app, "@request.auth.role = 'beirat'")
	})
}

func rewriteBeiratRules(app core.App, beiratOrAdmin string) error {
	collections := []*core.Collection{}
	if err := app.CollectionQuery().All(&collections); err != nil {
		return err
	}

	for _, collection := range collections {
		changed := false
		for _, rule := range []*string{
			collection.ListRule,
			collection.ViewRule,
			collection.CreateRule,
			collection.UpdateRule,
			collection.DeleteRule,
		} {
			if rule != nil && strings.Contains(*rule, beiratRoleLiteral) {
				*rule = expandBeiratLiteral(*rule, beiratOrAdmin)
				changed = true
			}
		}
		if changed {
			if err := app.Save(collection); err != nil {
				return err
			}
		}
	}

	return nil
}

const beiratRoleLiteral = "@request.auth.role = 'beirat'"

// expandBeiratLiteral replaces the expression `expanded` stands for:
// in the UP direction every occurrence of the plain beirat literal
// becomes the parenthesized beirat-or-admin form; in the DOWN direction
// that form is folded back into the plain literal.
func expandBeiratLiteral(rule string, replacement string) string {
	const plain = beiratRoleLiteral
	const widened = "(@request.auth.role = 'beirat' || @request.auth.role = 'admin')"

	if replacement == widened {
		return strings.ReplaceAll(rule, plain, widened)
	}
	return strings.ReplaceAll(rule, widened, plain)
}
