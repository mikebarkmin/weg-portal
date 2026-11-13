package migrations

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	m "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

// The portal always runs behind Caddy on the same host
// (deploy/Caddyfile, the service listens on 127.0.0.1 only), so without a
// trusted proxy header every request has the remote address 127.0.0.1 and
// ALL visitors share one rate limit bucket: five issue reports would block
// reporting for everyone, and two login attempts per three seconds would
// be a global cap.
//
// Caddy replaces X-Forwarded-For with the real client address (it ignores
// a client-supplied value unless trusted_proxies is configured), and
// PocketBase reads the rightmost address of the last header value
// (UseLeftmostIP = false), so a client cannot spoof its address.
//
// An already configured header list (set by a superuser in /_/) is kept.
func init() {
	m.Register(func(app core.App) error {
		settings := app.Settings()

		if len(settings.TrustedProxy.Headers) > 0 {
			return nil
		}

		settings.TrustedProxy.Headers = []string{"X-Forwarded-For"}
		settings.TrustedProxy.UseLeftmostIP = false

		return app.Save(settings)
	}, nil)
}
