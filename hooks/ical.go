package hooks

import (
	"net"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// iCalFallbackUIDDomain namespaces the per-record UIDs while no public
// application URL is configured (fresh install, tests).
const iCalFallbackUIDDomain = "weg-portal.test"

// iCalUIDDomain namespaces the stable per-record UIDs of the exported
// events ("<record id>@<domain>"): the host of the configured application
// URL, so UIDs are globally unique per deployment. NOTE: set the
// application URL before residents subscribe - changing the host later
// changes every UID, and subscribed calendars would show duplicates.
func iCalUIDDomain(app core.App) string {
	u, err := url.Parse(app.Settings().Meta.AppURL)
	if err != nil {
		return iCalFallbackUIDDomain
	}

	host := u.Hostname()
	if host == "" || host == "localhost" || net.ParseIP(host) != nil {
		return iCalFallbackUIDDomain
	}

	return host
}

// iCalCalendarContentType is served for the calendar export.
const iCalCalendarContentType = "text/calendar; charset=utf-8"

// ICal registers the public calendar export route
// GET /api/portal/calendar.ics (plan.md "Other planned items" no. 7).
//
// The export renders every events record as a VEVENT following RFC 5545:
// CRLF line endings, content lines folded at 75 octets, TEXT value
// escaping, VALUE=DATE for all-day events and the stored RRULE passed
// through unchanged.
//
// Time zones: single timed events are exported as UTC instants
// (DTSTART:...Z). RECURRING timed events repeat at the same LOCAL wall
// time in the portal time zone (PORTAL_TIMEZONE, hooks/timezone.go), so
// they are exported as DTSTART;TZID=<zone>:<local time> together with a
// VTIMEZONE block - calendar apps then keep "every Tuesday 18:30" at
// 18:30 across DST changes, exactly like the SPA's expansion. RRULE UNTIL
// values stay in their stored UTC (Z) form, as RFC 5545 requires for a
// TZID-based DTSTART. All-day DTEND dates are exclusive per RFC 5545,
// while the portal stores the last covered day, so the stored date_end
// date is emitted plus one day.
func ICal(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.GET("/api/portal/calendar.ics", func(e *core.RequestEvent) error {
			// without a token only the public calendar; the personal
			// token (POST /api/portal/calendar-token) unlocks the
			// calendars the account can see right now (checked on every
			// request, so a revoked approval takes effect immediately)
			calendars := []string{"public"}
			if token := strings.TrimSpace(e.Request.URL.Query().Get("token")); token != "" {
				user, err := e.App.FindFirstRecordByFilter("users", "ical_token = {:token}", dbx.Params{"token": token})
				if err != nil {
					return e.NotFoundError("Unknown calendar link.", nil)
				}
				calendars = calendarsFor(user)
			}
			if only := strings.TrimSpace(e.Request.URL.Query().Get("calendar")); only != "" {
				if !slices.Contains(calendars, only) {
					return e.NotFoundError("Unknown calendar.", nil)
				}
				calendars = []string{only}
			}

			calendarValues := make([]any, len(calendars))
			for i, c := range calendars {
				calendarValues[i] = c
			}

			var events []*core.Record
			if err := e.App.RecordQuery("events").
				Where(dbx.In("calendar", calendarValues...)).
				OrderBy("date_start ASC", "id ASC").
				All(&events); err != nil {
				return e.InternalServerError("Failed to load the calendar events.", err)
			}

			now := time.Now().UTC().Format("20060102T150405Z")
			uidDomain := iCalUIDDomain(e.App)

			loc, tzid := mustPortalLocation()

			var b strings.Builder

			writeICalLine(&b, "BEGIN:VCALENDAR")
			writeICalLine(&b, "VERSION:2.0")
			writeICalLine(&b, "PRODID:-//WEG Portal//Calendar//DE")
			writeICalLine(&b, "CALSCALE:GREGORIAN")
			writeICalLine(&b, "X-WR-CALNAME:"+escapeICalText(e.App.Settings().Meta.AppName))

			// the VTIMEZONE is needed only when a recurring timed event
			// references the TZID; it covers the first such series up to
			// ten years ahead
			firstZonedYear := 0
			for _, event := range events {
				if isZonedEvent(event) {
					if y := event.GetDateTime("date_start").Time().In(loc).Year(); firstZonedYear == 0 || y < firstZonedYear {
						firstZonedYear = y
					}
				}
			}
			if firstZonedYear != 0 {
				writeVTimezone(&b, loc, tzid, firstZonedYear, max(firstZonedYear, time.Now().Year())+10)
			}

			for _, event := range events {
				start := event.GetDateTime("date_start").Time()
				if start.IsZero() {
					// defensive: schema requires date_start
					continue
				}
				end := event.GetDateTime("date_end").Time()

				writeICalLine(&b, "BEGIN:VEVENT")
				writeICalLine(&b, "UID:"+event.Id+"@"+uidDomain)
				writeICalLine(&b, "DTSTAMP:"+now)

				if event.GetBool("all_day") {
					startDate := allDayDate(start)
					writeICalLine(&b, "DTSTART;VALUE=DATE:"+startDate.Format("20060102"))
					if !end.IsZero() && !end.Before(start) {
						writeICalLine(&b, "DTEND;VALUE=DATE:"+allDayDate(end).AddDate(0, 0, 1).Format("20060102"))
					}
				} else if isZonedEvent(event) {
					writeICalLine(&b, "DTSTART;TZID="+tzid+":"+start.In(loc).Format("20060102T150405"))
					if !end.IsZero() && !end.Before(start) {
						writeICalLine(&b, "DTEND;TZID="+tzid+":"+end.In(loc).Format("20060102T150405"))
					}
				} else {
					writeICalLine(&b, "DTSTART:"+start.UTC().Format("20060102T150405Z"))
					if !end.IsZero() && !end.Before(start) {
						writeICalLine(&b, "DTEND:"+end.UTC().Format("20060102T150405Z"))
					}
				}

				writeICalLine(&b, "SUMMARY:"+escapeICalText(event.GetString("title")))

				if description := event.GetString("description"); description != "" {
					writeICalLine(&b, "DESCRIPTION:"+escapeICalText(description))
				}

				if location := event.GetString("location"); location != "" {
					writeICalLine(&b, "LOCATION:"+escapeICalText(location))
				}

				if category := event.GetString("category"); category != "" {
					writeICalLine(&b, "CATEGORIES:"+escapeICalText(category))
				}

				// non-public calendars are marked so subscribers can tell
				// them apart in a combined feed
				if calendar := event.GetString("calendar"); calendar == "owners" || calendar == "beirat" {
					writeICalLine(&b, "CLASS:PRIVATE")
				}

				// passed through as stored (UNTIL values stay in their
				// stored Z form); a rule with a line break is never emitted
				// (it would inject content lines - the events hooks reject
				// it, this covers records written past them)
				if rrule := strings.TrimSpace(event.GetString("rrule")); rrule != "" && !strings.ContainsAny(rrule, "\r\n") {
					writeICalLine(&b, "RRULE:"+rrule)
				}

				writeICalLine(&b, "END:VEVENT")
			}

			writeICalLine(&b, "END:VCALENDAR")

			return e.Blob(http.StatusOK, iCalCalendarContentType, []byte(b.String()))
		})

		return se.Next()
	})
}

// isZonedEvent reports whether the event is exported with a TZID: timed
// events with a recurrence rule (see the ICal doc comment).
func isZonedEvent(event *core.Record) bool {
	return !event.GetBool("all_day") && strings.TrimSpace(event.GetString("rrule")) != ""
}

// allDayDate returns the calendar date of a stored all-day value. The SPA
// stores all-day dates as UTC midnight; values written by older clients
// hold local midnight converted to UTC (e.g. 23:00Z of the previous day
// for Germany), so the value is rounded to the NEAREST UTC midnight.
func allDayDate(t time.Time) time.Time {
	return t.UTC().Add(12 * time.Hour).Truncate(24 * time.Hour)
}

// writeICalLine writes one content line (folding it to the RFC 5545
// length limit) including the trailing CRLF.
func writeICalLine(b *strings.Builder, line string) {
	b.WriteString(foldICalLine(line))
	b.WriteString("\r\n")
}

// foldICalLine folds a content line at 75 octets per RFC 5545 §3.1 by
// inserting CRLF followed by a single space character. Fold points are
// moved back so that multi-byte UTF-8 sequences are never split.
func foldICalLine(line string) string {
	const (
		firstLineLimit  = 75 // octets, excluding the line break
		followLineLimit = 74 // the continuation space counts against the limit
	)

	if len(line) <= firstLineLimit {
		return line
	}

	var b strings.Builder

	limit := firstLineLimit
	for {
		if len(line) <= limit {
			b.WriteString(line)
			break
		}

		cut := limit
		// never split in the middle of a UTF-8 rune
		for cut > 0 && !utf8.RuneStart(line[cut]) {
			cut--
		}

		b.WriteString(line[:cut])
		b.WriteString("\r\n ")
		line = line[cut:]
		limit = followLineLimit
	}

	return b.String()
}

// escapeICalText escapes a TEXT property value per RFC 5545 §3.3.11:
// backslash, semicolon and comma are escaped, and line breaks are
// encoded as literal "\n" (a newline must never appear inside a value).
func escapeICalText(value string) string {
	replacer := strings.NewReplacer(
		"\\", "\\\\",
		";", "\\;",
		",", "\\,",
		"\r\n", "\\n",
		"\r", "\\n",
		"\n", "\\n",
	)

	return replacer.Replace(value)
}
