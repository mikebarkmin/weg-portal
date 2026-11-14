package hooks

import (
	"net/http"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Version is the running build's version (set by base/main.go from its
// ldflags value), returned by GET /api/portal/config for the SPA footer.
var Version = "dev"

// PortalConfig registers GET /api/portal/config: the public, per-deployment
// settings the SPA needs at runtime: the portal time zone
// (PORTAL_TIMEZONE), in which the SPA expands recurring events - the same
// zone the iCal export uses - and the app version shown in the footer.
//
// Only non-sensitive values belong here: the route is public.
func PortalConfig(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// a misconfigured zone must stop the start, not silently shift
		// every recurring event
		if _, _, err := portalLocation(); err != nil {
			return err
		}

		se.Router.GET("/api/portal/config", func(e *core.RequestEvent) error {
			_, tzName := mustPortalLocation()

			return e.JSON(http.StatusOK, map[string]any{
				"timezone": tzName,
				"version":  Version,
			})
		})

		return se.Next()
	})
}
