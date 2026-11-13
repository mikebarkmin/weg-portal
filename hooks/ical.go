package hooks

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// iCalUIDDomain namespaces the stable per-record UIDs of the exported
// events (UID is "<record id>@<domain>" so it stays stable as long as
// the record exists).
const iCalUIDDomain = "weg-portal.test"

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
// Per the M6 review decision, DTSTART/DTEND are emitted in UTC form
// with a trailing Z ("UTC wall-clock semantics", matching the DB
// storage and the SPA's client-side expansion) and NO TZID parameter is
// set. All-day DTEND dates are exclusive per RFC 5545, while the portal
// stores the last covered day, so the stored date_end date is emitted
// plus one day.
func ICal(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.GET("/api/portal/calendar.ics", func(e *core.RequestEvent) error {
			var events []*core.Record
			if err := e.App.RecordQuery("events").
				OrderBy("date_start ASC", "id ASC").
				All(&events); err != nil {
				return e.InternalServerError("Failed to load the calendar events.", err)
			}

			now := time.Now().UTC().Format("20060102T150405Z")

			var b strings.Builder

			writeICalLine(&b, "BEGIN:VCALENDAR")
			writeICalLine(&b, "VERSION:2.0")
			writeICalLine(&b, "PRODID:-//WEG Portal//Calendar//DE")
			writeICalLine(&b, "CALSCALE:GREGORIAN")

			for _, event := range events {
				start := event.GetDateTime("date_start").Time()
				if start.IsZero() {
					// defensive: schema requires date_start
					continue
				}
				end := event.GetDateTime("date_end").Time()

				writeICalLine(&b, "BEGIN:VEVENT")
				writeICalLine(&b, "UID:"+event.Id+"@"+iCalUIDDomain)
				writeICalLine(&b, "DTSTAMP:"+now)

				if event.GetBool("all_day") {
					writeICalLine(&b, "DTSTART;VALUE=DATE:"+start.Format("20060102"))
					if !end.IsZero() && !end.Before(start) {
						writeICalLine(&b, "DTEND;VALUE=DATE:"+end.AddDate(0, 0, 1).Format("20060102"))
					}
				} else {
					writeICalLine(&b, "DTSTART:"+start.Format("20060102T150405Z"))
					if !end.IsZero() && !end.Before(start) {
						writeICalLine(&b, "DTEND:"+end.Format("20060102T150405Z"))
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

				// passed through exactly as stored (no TZID, UNTIL
				// values stay in their stored Z form)
				if rrule := strings.TrimSpace(event.GetString("rrule")); rrule != "" {
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
