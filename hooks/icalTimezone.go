package hooks

import (
	"fmt"
	"strings"
	"time"
)

// writeVTimezone writes the VTIMEZONE component for loc, covering the
// years fromYear..toYear (RFC 5545 §3.6.5). Every UTC offset change in that
// span becomes its own STANDARD/DAYLIGHT sub-component with a fixed
// DTSTART (no RRULE), derived from Go's zone database, so the block is
// correct for any IANA zone without hand-maintained rules. Calendar apps
// usually map the IANA TZID to their own zone database anyway; the block
// is what the standard requires for every TZID that is referenced.
func writeVTimezone(b *strings.Builder, loc *time.Location, tzid string, fromYear, toYear int) {
	writeICalLine(b, "BEGIN:VTIMEZONE")
	writeICalLine(b, "TZID:"+tzid)

	spanStart := time.Date(fromYear, 1, 1, 0, 0, 0, 0, loc)
	name, offset := spanStart.Zone()

	// baseline: the offset in effect at the start of the span
	writeVTimezoneComponent(b, spanStart.IsDST(), spanStart, offset, offset, name)

	for _, tr := range zoneTransitions(loc, fromYear, toYear) {
		writeVTimezoneComponent(b, tr.at.In(loc).IsDST(), tr.at, tr.fromOffset, tr.toOffset, tr.name)
	}

	writeICalLine(b, "END:VTIMEZONE")
}

func writeVTimezoneComponent(b *strings.Builder, dst bool, at time.Time, fromOffset, toOffset int, name string) {
	kind := "STANDARD"
	if dst {
		kind = "DAYLIGHT"
	}

	writeICalLine(b, "BEGIN:"+kind)
	// DTSTART is the local time of the transition in the OLD offset
	writeICalLine(b, "DTSTART:"+at.UTC().Add(time.Duration(fromOffset)*time.Second).Format("20060102T150405"))
	writeICalLine(b, "TZOFFSETFROM:"+formatUTCOffset(fromOffset))
	writeICalLine(b, "TZOFFSETTO:"+formatUTCOffset(toOffset))
	if name != "" {
		writeICalLine(b, "TZNAME:"+escapeICalText(name))
	}
	writeICalLine(b, "END:"+kind)
}

type zoneTransition struct {
	at                   time.Time // the instant the new offset applies
	fromOffset, toOffset int       // seconds east of UTC
	name                 string    // abbreviation after the transition
}

// zoneTransitions finds every UTC offset change of loc in the given years:
// a daily scan finds the day, a binary search the exact second.
func zoneTransitions(loc *time.Location, fromYear, toYear int) []zoneTransition {
	var result []zoneTransition

	cur := time.Date(fromYear, 1, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(toYear+1, 1, 1, 0, 0, 0, 0, time.UTC)
	_, curOffset := cur.In(loc).Zone()

	for cur.Before(end) {
		next := cur.Add(24 * time.Hour)
		_, nextOffset := next.In(loc).Zone()

		if nextOffset != curOffset {
			lo, hi := cur, next // offset(lo) = old, offset(hi) = new
			for hi.Sub(lo) > time.Second {
				mid := lo.Add(hi.Sub(lo) / 2)
				if _, o := mid.In(loc).Zone(); o == curOffset {
					lo = mid
				} else {
					hi = mid
				}
			}
			name, _ := hi.In(loc).Zone()
			result = append(result, zoneTransition{at: hi, fromOffset: curOffset, toOffset: nextOffset, name: name})
			curOffset = nextOffset
		}

		cur = next
	}

	return result
}

// formatUTCOffset renders seconds east of UTC as RFC 5545 UTC-OFFSET
// (+hhmm, or +hhmmss when seconds are present).
func formatUTCOffset(seconds int) string {
	sign := "+"
	if seconds < 0 {
		sign = "-"
		seconds = -seconds
	}
	h, m, s := seconds/3600, seconds%3600/60, seconds%60
	if s != 0 {
		return fmt.Sprintf("%s%02d%02d%02d", sign, h, m, s)
	}
	return fmt.Sprintf("%s%02d%02d", sign, h, m)
}
