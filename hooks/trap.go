package hooks

import (
	"errors"
	"strconv"
	"strings"
	"time"
)

// honeypot + time-trap validation shared by the public submission endpoints
// (see plan.md "Public submission routes").
const trapMinDuration = 3 * time.Second

var (
	errTrapHoneypot = errors.New("submission rejected")
	errTrapTooFast  = errors.New("submission was too fast, please try again")
	errTrapMissing  = errors.New("submission form data is invalid")
)

// validateTrap checks that the hidden honeypot field is empty and that at
// least [trapMinDuration] has passed since form_started_at (epoch ms).
func validateTrap(honeypot string, startedAt any) error {
	if honeypot != "" {
		return errTrapHoneypot
	}

	var startedMs int64
	switch v := startedAt.(type) {
	case string:
		n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
		if err != nil {
			return errTrapMissing
		}
		startedMs = n
	case float64:
		startedMs = int64(v)
	case int64:
		startedMs = v
	case int:
		startedMs = int64(v)
	default:
		return errTrapMissing
	}

	if time.Now().UnixMilli()-startedMs < trapMinDuration.Milliseconds() {
		return errTrapTooFast
	}

	return nil
}
