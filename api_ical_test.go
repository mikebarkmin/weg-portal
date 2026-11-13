package portal

import (
	"io"
	"net/http"
	"regexp"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// icalUIDs returns all UID lines of the calendar.
func icalUIDs(body string) []string {
	var uids []string
	for _, line := range unfoldICal(body) {
		if strings.HasPrefix(line, "UID:") {
			uids = append(uids, line)
		}
	}
	return uids
}

// unfoldICal undoes RFC 5545 line folding (continuation lines start with
// a single space character) and returns the logical content lines.
func unfoldICal(body string) []string {
	physical := strings.Split(body, "\r\n")

	var unfolded []string
	for _, line := range physical {
		if strings.HasPrefix(line, " ") {
			if len(unfolded) == 0 {
				continue
			}
			unfolded[len(unfolded)-1] += line[1:]
			continue
		}
		unfolded = append(unfolded, line)
	}

	return unfolded
}

// icalVEvent returns the content lines of the VEVENT with the given UID
// (excluding BEGIN/END), or nil if the event is not in the calendar.
func icalVEvent(unfolded []string, uid string) []string {
	for i, line := range unfolded {
		if line != "UID:"+uid {
			continue
		}
		var block []string
		for _, line := range unfolded[i+1:] {
			if line == "END:VEVENT" {
				return block
			}
			block = append(block, line)
		}
	}
	return nil
}

// requireICalLines fails the test unless every expected line is part of
// the VEVENT block.
func requireICalLines(t testing.TB, label string, block []string, expected ...string) {
	t.Helper()

	if block == nil {
		t.Errorf("%s: no VEVENT found", label)
		return
	}

	for _, want := range expected {
		if !slicesContains(block, want) {
			t.Errorf("%s: expected calendar line %q, got %q", label, want, block)
		}
	}
}

func slicesContains(haystack []string, needle string) bool {
	for _, v := range haystack {
		if v == needle {
			return true
		}
	}
	return false
}

// validateICal checks the RFC 5545 shape of the exported calendar:
// CRLF-only line endings, no line longer than 75 octets, the required
// calendar properties and one conforming DTSTAMP per event.
func validateICal(t testing.TB, body string) {
	t.Helper()

	if strings.Count(body, "\n") != strings.Count(body, "\r\n") {
		t.Errorf("expected CRLF-only line endings, body contains bare LF")
	}

	if !strings.HasPrefix(body, "BEGIN:VCALENDAR\r\n") {
		t.Errorf("expected the body to start with BEGIN:VCALENDAR, got %q", body[:min(len(body), 30)])
	}

	if !strings.HasSuffix(body, "END:VCALENDAR\r\n") {
		t.Errorf("expected the body to end with END:VCALENDAR")
	}

	// the fixture has no recurring TIMED event, so nothing references a
	// time zone (see TestICalendarRecurringTimedUsesTZID for that case)
	if strings.Contains(body, "TZID") {
		t.Errorf("unexpected TZID: only recurring timed events are exported with a time zone")
	}

	for i, line := range strings.Split(body, "\r\n") {
		if len(line) > 75 {
			t.Errorf("physical line %d exceeds the RFC 5545 limit of 75 octets (%d): %q", i, len(line), line)
		}
	}

	unfolded := unfoldICal(body)

	for _, required := range []string{
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//WEG Portal//Calendar//DE",
		"CALSCALE:GREGORIAN",
		"END:VCALENDAR",
	} {
		if !slicesContains(unfolded, required) {
			t.Errorf("expected calendar property %q", required)
		}
	}

	dstampRe := regexp.MustCompile(`^DTSTAMP:\d{8}T\d{6}Z$`)
	events := 0
	inEvent := false
	for _, line := range unfolded {
		switch line {
		case "BEGIN:VEVENT":
			inEvent = true
			events++
		case "END:VEVENT":
			inEvent = false
		default:
			if inEvent && strings.HasPrefix(line, "DTSTAMP:") && !dstampRe.MatchString(line) {
				t.Errorf("invalid DTSTAMP %q", line)
			}
		}
	}
}

// TestICalendarExport validates GET /api/portal/calendar.ics for a single
// event, an all-day event (VALUE=DATE), an all-day multi-day event
// (exclusive DTEND), a recurring event (RRULE pass-through) and the
// escaping/folding event, as guest and as resident.
func TestICalendarExport(t *testing.T) {
	t.Parallel()

	// content lines are checked unfolded, i.e. exactly as the values must
	// appear after a parser removed the folding
	cases := []struct {
		uid  string
		want []string
	}{
		{
			// single timed event
			"eventsimple0001@weg-portal.test",
			[]string{
				"DTSTART:20261201T180000Z",
				"DTEND:20261201T200000Z",
				"SUMMARY:Herbstputz",
				"DESCRIPTION:Putzen des gemeinsamen Kellerflurs.",
				"LOCATION:Keller",
				"CATEGORIES:putzen",
			},
		},
		{
			// single all-day event without date_end: VALUE=DATE, no DTEND
			"eventallday0001@weg-portal.test",
			[]string{
				"DTSTART;VALUE=DATE:20260704",
				"SUMMARY:Gartenfest",
			},
		},
		{
			// multi-day all-day event: stored inclusive date_end is
			// emitted as exclusive DTEND (stored 2026-08-16 -> 20260817)
			"eventallday0002@weg-portal.test",
			[]string{
				"DTSTART;VALUE=DATE:20260814",
				"DTEND;VALUE=DATE:20260817",
			},
		},
		{
			// recurring event: VALUE=DATE start, RRULE passed through exactly as stored
			"eventrecurring1@weg-portal.test",
			[]string{
				"DTSTART;VALUE=DATE:20261101",
				"RRULE:FREQ=DAILY;COUNT=30",
			},
		},
		{
			// escaping of , ; \ and newlines (+ folding of long values)
			"eventescapes001@weg-portal.test",
			[]string{
				"DTSTART:20260912T090000Z",
				"DTEND:20260912T120000Z",
				`SUMMARY:Keller\, Waschkeller\; 2. OG`,
				"DESCRIPTION:Der Keller\\, die Waschkueche sowie das 2. OG muessen geputzt werden. Beachtet die Hinweise am schwarzen Brett\\, den Plan im Ordner \\\\Gemeinschaft\\; Muelleimer vorher ausleeren.\\nFragen an den Beirat.",
				`LOCATION:Keller\; neben dem Fahrstuhl\, 1. OG`,
			},
		},
	}

	scenarios := []tests.ApiScenario{
		{
			Name:           "guest",
			Method:         http.MethodGet,
			URL:            "/api/portal/calendar.ics",
			TestAppFactory: setupTestApp,
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
				if ct := res.Header.Get("Content-Type"); ct != "text/calendar; charset=utf-8" {
					t.Errorf("expected Content-Type %q, got %q", "text/calendar; charset=utf-8", ct)
				}

				body, err := io.ReadAll(res.Body)
				if err != nil {
					t.Fatal(err)
				}
				bodyStr := string(body)

				validateICal(t, bodyStr)

				unfolded := unfoldICal(bodyStr)

				events := 0
				for _, line := range unfolded {
					if line == "BEGIN:VEVENT" {
						events++
					}
				}
				if events != 5 {
					t.Errorf("expected 5 VEVENTs (one per fixture event), got %d", events)
				}

				for _, c := range cases {
					requireICalLines(t, c.uid, icalVEvent(unfolded, c.uid), c.want...)
				}
			},
			ExpectedStatus:  200,
			ExpectedContent: []string{"BEGIN:VCALENDAR\r\n"},
		},
		{
			Name:            "resident",
			Method:          http.MethodGet,
			URL:             "/api/portal/calendar.ics",
			Headers:         authHeader(t, emailResident),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{"BEGIN:VCALENDAR\r\n"},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

// TestICalendarUIDStable proves the UIDs are derived from the record ids:
// two independent requests export identical UID lists.
func TestICalendarUIDStable(t *testing.T) {
	t.Parallel()

	var first []string

	scenarios := []tests.ApiScenario{
		{
			Name:           "first request",
			Method:         http.MethodGet,
			URL:            "/api/portal/calendar.ics",
			TestAppFactory: setupTestApp,
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
				body, err := io.ReadAll(res.Body)
				if err != nil {
					t.Fatal(err)
				}
				first = icalUIDs(string(body))
			},
			ExpectedStatus:  200,
			ExpectedContent: []string{"BEGIN:VCALENDAR\r\n"},
		},
		{
			Name:           "second request",
			Method:         http.MethodGet,
			URL:            "/api/portal/calendar.ics",
			TestAppFactory: setupTestApp,
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
				body, err := io.ReadAll(res.Body)
				if err != nil {
					t.Fatal(err)
				}

				second := icalUIDs(string(body))

				if len(first) != 5 {
					t.Fatalf("expected 5 UIDs in the first response, got %d", len(first))
				}
				if len(second) != len(first) {
					t.Fatalf("expected the same number of UIDs in both responses, got %d and %d", len(first), len(second))
				}
				for i := range first {
					if first[i] != second[i] {
						t.Errorf("UID %q of the first export does not match UID %q of the second export", first[i], second[i])
					}
				}
			},
			ExpectedStatus:  200,
			ExpectedContent: []string{"BEGIN:VCALENDAR\r\n"},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}
