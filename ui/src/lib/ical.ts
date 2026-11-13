// iCal subscription link. The route itself (GET /api/portal/calendar.ics)
// is implemented server-side in M5; the client just builds the URL
// against the current origin (the SPA is served by the same binary).
export function buildIcalUrl(origin = window.location.origin): string {
    return `${origin}/api/portal/calendar.ics`;
}
