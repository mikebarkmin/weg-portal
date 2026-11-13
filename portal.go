// Package portal wires up the WEG community portal PocketBase application.
package portal

import (
	"strings"

	"ganigeorgiev.com/pocketbase/pocketbase"
	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/hook"

	"weg-portal/hooks"
	_ "weg-portal/migrations"
	"weg-portal/ui"
)

// New creates a new portal app instance with the default config (see [pocketbase.New()]).
func New() *pocketbase.PocketBase {
	app := pocketbase.New()

	bindAppHooks(app)

	return app
}

// NewWithConfig creates a new portal app instance with the provided config (see [pocketbase.NewWithConfig()]).
func NewWithConfig(config pocketbase.Config) *pocketbase.PocketBase {
	app := pocketbase.NewWithConfig(config)

	bindAppHooks(app)

	return app
}

const defaultCSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://*.tile.openstreetmap.org data: blob:; connect-src 'self'; script-src 'self'; frame-ancestors 'none'"

func bindAppHooks(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.GET("/{path...}", apis.Static(ui.DistDirFS, true)).
			Bind(apis.Gzip()).
			Bind(&hook.Handler[*core.RequestEvent]{
				Priority: 99,
				Func: func(e *core.RequestEvent) error {
					// cache only the static assets for now
					if e.Response.Header().Get("Cache-Control") == "" {
						if strings.HasPrefix(e.Request.URL.Path, "/@static/") {
							e.Response.Header().Set("Cache-Control", "max-age=604800, stale-while-revalidate=86400")
						} else {
							// force no-store for the index fallback to prevent browser's cache heuristics
							e.Response.Header().Set("Cache-Control", "no-store")
						}
					}

					if e.Response.Header().Get("Content-Security-Policy") == "" {
						e.Response.Header().Set("Content-Security-Policy", defaultCSP)
					}

					return e.Next()
				},
			})

		return se.Next()
	})

	// ---------------------------------------------------------------

	hooks.IssueEnrich(app)
	hooks.SubmitIssue(app)
	hooks.SuggestionCreate(app)
	hooks.UsersCreate(app)
	hooks.IssueWorkflow(app)
	hooks.SuggestionWorkflow(app)
	hooks.Mail(app)
}
