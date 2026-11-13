package hooks

import (
	"net/http"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// PortalConfig registers GET /api/portal/config: the public, per-deployment
// settings the SPA needs at runtime. Today that is the reportable bounding
// box (the same PORTAL_MIN_LAT/... env values that POST /api/portal/issues
// enforces), so the map and the client-side validation always match the
// server (M8 review, open question 1).
//
// It also returns the portal time zone (PORTAL_TIMEZONE), in which the
// SPA expands recurring events - the same zone the iCal export uses.
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
			bounds, err := issueBounds()
			if err != nil {
				return e.InternalServerError("The portal bounding box is misconfigured.", err)
			}

			_, tzName := mustPortalLocation()

			return e.JSON(http.StatusOK, map[string]any{
				"timezone": tzName,
				"bounds": map[string]float64{
					"minLat": bounds.minLat,
					"maxLat": bounds.maxLat,
					"minLng": bounds.minLng,
					"maxLng": bounds.maxLng,
				},
			})
		})

		return se.Next()
	})
}
