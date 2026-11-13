package hooks

import (
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
	_ "time/tzdata" // the runtime image may ship without a zoneinfo database
)

// defaultPortalTimezone is the zone of the property the portal serves.
const defaultPortalTimezone = "Europe/Berlin"

var (
	portalTZMu    sync.Mutex
	portalTZName  string
	portalTZValue *time.Location
)

// portalLocation returns the portal's time zone (env PORTAL_TIMEZONE, IANA
// name, default Europe/Berlin). It is the one zone in which
//   - recurring timed events repeat (same LOCAL wall time across DST),
//   - the iCal export writes DTSTART;TZID=... for recurring events,
//   - mails show dates.
//
// The SPA reads the same value from GET /api/portal/config.
func portalLocation() (*time.Location, string, error) {
	name := strings.TrimSpace(os.Getenv("PORTAL_TIMEZONE"))
	if name == "" {
		name = defaultPortalTimezone
	}

	portalTZMu.Lock()
	defer portalTZMu.Unlock()

	if portalTZValue != nil && portalTZName == name {
		return portalTZValue, name, nil
	}

	// "Local" would silently depend on the host - not allowed
	if strings.EqualFold(name, "Local") {
		return nil, name, fmt.Errorf("invalid PORTAL_TIMEZONE %q: use an IANA zone name", name)
	}

	loc, err := time.LoadLocation(name)
	if err != nil {
		return nil, name, fmt.Errorf("invalid PORTAL_TIMEZONE %q: %w", name, err)
	}

	portalTZName, portalTZValue = name, loc

	return loc, name, nil
}

// mustPortalLocation is portalLocation for code paths that run after the
// startup validation (PortalConfig refuses to serve with an invalid zone).
func mustPortalLocation() (*time.Location, string) {
	loc, name, err := portalLocation()
	if err != nil {
		return time.UTC, "UTC"
	}
	return loc, name
}

// PortalLocationForTest exposes portalLocation to the API tests in the
// root package (the startup validation path is not reachable there).
func PortalLocationForTest() (*time.Location, string, error) {
	return portalLocation()
}
