package portal

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/mailer"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// M4: workflow transition + notification tests.

// doJSON performs an authorized JSON request against the mux.
func doJSON(t testing.TB, mux http.Handler, method, url, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()

	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(method, url, nil)
	} else {
		req = httptest.NewRequest(method, url, strings.NewReader(body))
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	return rec
}

// waitTestMailerMails waits until at least [count] mails have been collected
// by the test mailer (the hook sends them fire-and-forget in a goroutine).
func waitTestMailerMails(t *testing.T, app *tests.TestApp, count int, what string) {
	t.Helper()

	deadline := time.Now().Add(3 * time.Second)
	for app.TestMailer.TotalSend() < count {
		if time.Now().After(deadline) {
			t.Fatalf("expected at least %d mail(s) (%s), got %d", count, what, app.TestMailer.TotalSend())
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// waitTestMailerIdle waits a bit and returns the total collected mails,
// used to assert that no mail was sent at all.
func waitTestMailerIdle(app *tests.TestApp, what string) int {
	time.Sleep(150 * time.Millisecond)
	return app.TestMailer.TotalSend()
}

// mailSummary renders subject + recipients of the collected mails for
// assertion failure messages.
func mailSummary(msgs []*mailer.Message) string {
	parts := make([]string, len(msgs))
	for i, m := range msgs {
		recipients := make([]string, len(m.To))
		for j, to := range m.To {
			recipients[j] = to.Address
		}
		parts[i] = fmt.Sprintf("{to:%v subject:%q}", recipients, m.Subject)
	}
	return strings.Join(parts, " ")
}

// toAddresses returns the flat list of all recipient addresses.
func toAddresses(m *mailer.Message) []string {
	addresses := make([]string, len(m.To))
	for i, to := range m.To {
		addresses[i] = to.Address
	}
	return addresses
}

// findBySubject returns the first collected mail with the given subject.
func findBySubject(t *testing.T, app *tests.TestApp, subject string) *mailer.Message {
	t.Helper()

	for _, m := range app.TestMailer.Messages() {
		if m.Subject == subject {
			msg := *m
			return &msg
		}
	}

	t.Fatalf("no mail with subject %q found, got: %s", subject, mailSummary(app.TestMailer.Messages()))
	return nil
}

// ---------------------------------------------------------------------------
// issue transition validation
// ---------------------------------------------------------------------------

func TestIssueWorkflowTransitions(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		// valid transitions
		{
			Name:            "beirat accept requires visibility",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issuepcom000001",
			Body:            strings.NewReader(`{"status":"open"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "beirat accept with visibility",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issuepcom000001",
			Body:            strings.NewReader(`{"status":"open","visibility":"community"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"status":"open"`},
		},
		{
			Name:            "beirat accept with invalid visibility value",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issuepcom000001",
			Body:            strings.NewReader(`{"status":"open","visibility":"internal"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "beirat reject",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issuepcom000001",
			Body:            strings.NewReader(`{"status":"rejected"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"status":"rejected"`},
		},
		{
			Name:            "beirat starts working on an open issue",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issueocom000001",
			Body:            strings.NewReader(`{"status":"in_progress"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"status":"in_progress"`},
		},
		{
			Name:            "beirat resolves an in_progress issue",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issueicom000001",
			Body:            strings.NewReader(`{"status":"resolved"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"status":"resolved"`},
		},
		{
			Name:            "beirat may edit an issue without status change",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issueocom000001",
			Body:            strings.NewReader(`{"title":"Neuer Titel"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"Neuer Titel"`},
		},
		// valid rule-wise but invalid per the transition diagram
		{
			Name:            "hausmeister direct jump open->resolved",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issueocom000001",
			Body:            strings.NewReader(`{"status":"resolved"}`),
			Headers:         authHeader(t, emailHausmeister),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		// invalid transitions for beirat too
		{
			Name:            "beirat pending->in_progress",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issuepcom000001",
			Body:            strings.NewReader(`{"status":"in_progress"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "beirat open->resolved direct jump",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issueocom000001",
			Body:            strings.NewReader(`{"status":"resolved"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "beirat resolved->pending",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issuercom000001",
			Body:            strings.NewReader(`{"status":"pending"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "beirat resolved->open",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issuercom000001",
			Body:            strings.NewReader(`{"status":"open","visibility":"community"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "beirat rejected->pending",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issuejcom000001",
			Body:            strings.NewReader(`{"status":"pending"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "beirat in_progress->open backwards",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issueicom000001",
			Body:            strings.NewReader(`{"status":"open","visibility":"community"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			// submitting the same status is a client error, not a no-op
			Name:            "beirat repeat accept (same status submitted)",
			Method:          http.MethodPatch,
			URL:             "/api/collections/issues/records/issueocom000001",
			Body:            strings.NewReader(`{"status":"open","visibility":"community"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

// TestIssueWorkflowTimestamps checks the server-set decided_at/resolved_at.
func TestIssueWorkflowTimestamps(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	mux := serveMux(t, app)

	// accept
	rec := doJSON(t, mux, http.MethodPatch, "/api/collections/issues/records/issuepcom000001",
		`{"status":"open","visibility":"private"}`, authHeader(t, emailBeirat))
	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	issue, err := app.FindRecordById("issues", "issuepcom000001")
	if err != nil {
		t.Fatal(err)
	}
	if issue.GetString("decided_at") == "" {
		t.Fatal("expected decided_at to be set on accept")
	}
	if issue.GetString("resolved_at") != "" {
		t.Fatal("expected resolved_at to stay empty on accept")
	}

	// progress + resolve
	rec = doJSON(t, mux, http.MethodPatch, "/api/collections/issues/records/issuepcom000001",
		`{"status":"in_progress"}`, authHeader(t, emailHausmeister))
	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	rec = doJSON(t, mux, http.MethodPatch, "/api/collections/issues/records/issuepcom000001",
		`{"status":"resolved"}`, authHeader(t, emailHausmeister))
	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	issue, err = app.FindRecordById("issues", "issuepcom000001")
	if err != nil {
		t.Fatal(err)
	}
	if issue.GetString("resolved_at") == "" {
		t.Fatal("expected resolved_at to be set on resolve")
	}

	// reject sets only decided_at
	rec = doJSON(t, mux, http.MethodPatch, "/api/collections/issues/records/issuepprv000001",
		`{"status":"rejected"}`, authHeader(t, emailBeirat))
	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	issue, err = app.FindRecordById("issues", "issuepprv000001")
	if err != nil {
		t.Fatal(err)
	}
	if issue.GetString("decided_at") == "" {
		t.Fatal("expected decided_at to be set on reject")
	}
	if issue.GetString("resolved_at") != "" {
		t.Fatal("expected resolved_at to stay empty on reject")
	}
}

const forgedTimestamp = "2000-01-01 00:00:00.000Z"

// TestWorkflowTimestampsOwnedByHook checks that decided_at/resolved_at are
// written by the hook alone: client-submitted values are ignored on
// transitions AND on non-status edits (the beirat update rule is otherwise
// unrestricted, so the hook is the only guard).
func TestWorkflowTimestampsOwnedByHook(t *testing.T) {
	t.Run("issue transition with forged timestamps", func(t *testing.T) {
		app := setupTestApp(t)
		defer app.Cleanup()

		mux := serveMux(t, app)

		rec := doJSON(t, mux, http.MethodPatch, "/api/collections/issues/records/issuepcom000001",
			`{"status":"rejected","decided_at":"2000-01-01 00:00:00.000Z","resolved_at":"2000-01-01 00:00:00.000Z"}`, authHeader(t, emailBeirat))
		if rec.Code != 200 {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		issue, err := app.FindRecordById("issues", "issuepcom000001")
		if err != nil {
			t.Fatal(err)
		}
		if issue.GetString("decided_at") == "" || issue.GetString("decided_at") == forgedTimestamp {
			t.Fatalf("expected the hook-set decided_at, got %q", issue.GetString("decided_at"))
		}
		if issue.GetString("resolved_at") != "" {
			t.Fatalf("expected resolved_at to stay empty on reject, got %q", issue.GetString("resolved_at"))
		}
	})

	t.Run("issue non-status edit cannot change the timestamps", func(t *testing.T) {
		app := setupTestApp(t)
		defer app.Cleanup()

		mux := serveMux(t, app)

		rec := doJSON(t, mux, http.MethodPatch, "/api/collections/issues/records/issueocom000001",
			`{"title":"Neuer Titel","decided_at":"2000-01-01 00:00:00.000Z"}`, authHeader(t, emailBeirat))
		if rec.Code != 200 {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		issue, err := app.FindRecordById("issues", "issueocom000001")
		if err != nil {
			t.Fatal(err)
		}
		if issue.GetString("title") != "Neuer Titel" {
			t.Fatalf("expected the edited title, got %q", issue.GetString("title"))
		}
		if issue.GetString("decided_at") != "2026-11-01 10:00:00.000Z" {
			t.Fatalf("expected decided_at to keep its stored value, got %q", issue.GetString("decided_at"))
		}

		// the resolved_at of a resolved issue must not be forgeable either
		rec = doJSON(t, mux, http.MethodPatch, "/api/collections/issues/records/issuercom000001",
			`{"description":"Ergaenzt","resolved_at":"2000-01-01 00:00:00.000Z"}`, authHeader(t, emailBeirat))
		if rec.Code != 200 {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		issue, err = app.FindRecordById("issues", "issuercom000001")
		if err != nil {
			t.Fatal(err)
		}
		if issue.GetString("resolved_at") != "2026-11-10 12:00:00.000Z" {
			t.Fatalf("expected resolved_at to keep its stored value, got %q", issue.GetString("resolved_at"))
		}
	})

	t.Run("suggestion accept ignores a forged decided_at", func(t *testing.T) {
		app := setupTestApp(t)
		defer app.Cleanup()

		mux := serveMux(t, app)

		rec := doJSON(t, mux, http.MethodPatch, "/api/collections/suggestions/records/suggpending0001",
			`{"status":"accepted","decided_at":"2000-01-01 00:00:00.000Z"}`, authHeader(t, emailBeirat))
		if rec.Code != 200 {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		suggestion, err := app.FindRecordById("suggestions", "suggpending0001")
		if err != nil {
			t.Fatal(err)
		}
		if suggestion.GetString("decided_at") == "" || suggestion.GetString("decided_at") == forgedTimestamp {
			t.Fatalf("expected the hook-set decided_at, got %q", suggestion.GetString("decided_at"))
		}
	})
}

// ---------------------------------------------------------------------------
// suggestion transition validation + event creation
// ---------------------------------------------------------------------------

func TestSuggestionWorkflowTransitions(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "beirat accepts",
			Method:          http.MethodPatch,
			URL:             "/api/collections/suggestions/records/suggpending0001",
			Body:            strings.NewReader(`{"status":"accepted"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"status":"accepted"`},
		},
		{
			Name:            "beirat rejects",
			Method:          http.MethodPatch,
			URL:             "/api/collections/suggestions/records/suggpending0001",
			Body:            strings.NewReader(`{"status":"rejected"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"status":"rejected"`},
		},
		{
			Name:            "beirat may edit a suggestion without status change",
			Method:          http.MethodPatch,
			URL:             "/api/collections/suggestions/records/suggpending0001",
			Body:            strings.NewReader(`{"title":"Umformuliert"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"Umformuliert"`},
		},
		{
			Name:            "beirat accepted->pending",
			Method:          http.MethodPatch,
			URL:             "/api/collections/suggestions/records/suggaccepted001",
			Body:            strings.NewReader(`{"status":"pending"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "beirat accepted->rejected",
			Method:          http.MethodPatch,
			URL:             "/api/collections/suggestions/records/suggaccepted001",
			Body:            strings.NewReader(`{"status":"rejected"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "beirat rejected->accepted",
			Method:          http.MethodPatch,
			URL:             "/api/collections/suggestions/records/suggrejected001",
			Body:            strings.NewReader(`{"status":"accepted"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			Name:            "beirat rejected->pending",
			Method:          http.MethodPatch,
			URL:             "/api/collections/suggestions/records/suggrejected001",
			Body:            strings.NewReader(`{"status":"pending"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
		{
			// submitting the same status is a client error, not a no-op
			Name:            "beirat repeat accept (same status submitted)",
			Method:          http.MethodPatch,
			URL:             "/api/collections/suggestions/records/suggaccepted001",
			Body:            strings.NewReader(`{"status":"accepted"}`),
			Headers:         authHeader(t, emailBeirat),
			TestAppFactory:  setupTestApp,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":400`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

// TestSuggestionAcceptEvent checks that accepting creates the calendar
// event with the copied fields and an empty rrule, and that the atomicity
// holds: when the event insert fails, the suggestion update is rolled back.
func TestSuggestionAcceptEvent(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	mux := serveMux(t, app)

	eventsBefore := countRecords(t, app, "events")

	// 1. accept creates the event
	rec := doJSON(t, mux, http.MethodPatch, "/api/collections/suggestions/records/suggpending0001",
		`{"status":"accepted"}`, authHeader(t, emailBeirat))
	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	events := findRecordsByTitle(t, app, "events", "Vorschlag Sommerfest")
	if len(events) != 1 {
		t.Fatalf("expected exactly 1 created event, got %d", len(events))
	}

	event := events[0]
	suggestion, err := app.FindRecordById("suggestions", "suggpending0001")
	if err != nil {
		t.Fatal(err)
	}

	if event.GetString("title") != suggestion.GetString("title") {
		t.Fatalf("expected event title %q, got %q", suggestion.GetString("title"), event.GetString("title"))
	}
	if event.GetString("description") != suggestion.GetString("description") {
		t.Fatalf("expected copied description, got %q", event.GetString("description"))
	}
	if event.GetString("date_start") != suggestion.GetString("date_start") {
		t.Fatalf("expected copied date_start, got %q", event.GetString("date_start"))
	}
	if event.GetString("location") != suggestion.GetString("location") {
		t.Fatalf("expected copied location, got %q", event.GetString("location"))
	}
	if event.GetString("category") != suggestion.GetString("category") {
		t.Fatalf("expected copied category, got %q", event.GetString("category"))
	}
	if event.GetString("rrule") != "" {
		t.Fatalf("expected empty rrule, got %q", event.GetString("rrule"))
	}
	if suggestion.GetString("decided_at") == "" {
		t.Fatal("expected decided_at to be set on accept")
	}

	// 2. repeating the accept is rejected (submitting the same status is
	//    a client error, not a no-op): no second event
	rec = doJSON(t, mux, http.MethodPatch, "/api/collections/suggestions/records/suggpending0001",
		`{"status":"accepted"}`, authHeader(t, emailBeirat))
	if rec.Code != 400 {
		t.Fatalf("expected 400 (same status submitted = no valid transition), got %d", rec.Code)
	}
	if got := countRecords(t, app, "events"); got != eventsBefore+1 {
		t.Fatalf("expected %d events after the repeated accept, got %d", eventsBefore+1, got)
	}

	// 3. reset the suggestion to pending server-side (programmatic saves
	//    bypass the request hooks) and reject it -> no event, decided_at set
	suggestion.Set("status", "pending")
	suggestion.Set("decided_at", "")
	if err := app.Save(suggestion); err != nil {
		t.Fatal(err)
	}

	rec = doJSON(t, mux, http.MethodPatch, "/api/collections/suggestions/records/suggpending0001",
		`{"status":"rejected"}`, authHeader(t, emailBeirat))
	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	suggestion, err = app.FindRecordById("suggestions", "suggpending0001")
	if err != nil {
		t.Fatal(err)
	}
	if suggestion.GetString("status") != "rejected" {
		t.Fatalf("expected rejected, got %q", suggestion.GetString("status"))
	}
	if suggestion.GetString("decided_at") == "" {
		t.Fatal("expected decided_at to be set on reject")
	}

	// exactly the 1 accept event was created, the rejection added none
	if got := countRecords(t, app, "events"); got != eventsBefore+1 {
		t.Fatalf("expected %d events, got %d", eventsBefore+1, got)
	}

	// 4. atomicity: a failing event insert must roll the suggestion back
	//    (simulate the failure with a failing events create hook)
	app.OnRecordCreate("events").BindFunc(func(e *core.RecordEvent) error {
		return errors.New("simulated event insert failure")
	})

	// reset to pending and retry the accept
	suggestion.Set("status", "pending")
	suggestion.Set("decided_at", "")
	if err := app.Save(suggestion); err != nil {
		t.Fatal(err)
	}

	rec = doJSON(t, mux, http.MethodPatch, "/api/collections/suggestions/records/suggpending0001",
		`{"status":"accepted"}`, authHeader(t, emailBeirat))
	if rec.Code != 400 {
		t.Fatalf("expected 400 when the event insert fails, got %d: %s", rec.Code, rec.Body.String())
	}

	// the transaction must have been rolled back
	suggestion, err = app.FindRecordById("suggestions", "suggpending0001")
	if err != nil {
		t.Fatal(err)
	}
	if suggestion.GetString("status") != "pending" {
		t.Fatalf("expected the suggestion to stay pending after a failed accept, got %q", suggestion.GetString("status"))
	}
	if suggestion.GetString("decided_at") != "" {
		t.Fatal("expected decided_at to be rolled back too")
	}
	eventsAfterFailedAccept := countRecords(t, app, "events")
	if eventsAfterFailedAccept != eventsBefore+1 {
		t.Fatalf("expected no additional event after the failed accept, got %d instead of %d", eventsAfterFailedAccept, eventsBefore+1)
	}
}

// ---------------------------------------------------------------------------
// notifications
// ---------------------------------------------------------------------------

// stateful test: which mail goes to whom for every trigger.
func TestWorkflowMailsIssues(t *testing.T) {
	t.Run("issue accepted mails the submitter and opted-in staff", func(t *testing.T) {
		app := setupTestApp(t)
		defer app.Cleanup()

		mux := serveMux(t, app)

		rec := doJSON(t, mux, http.MethodPatch, "/api/collections/issues/records/issuepcom000001",
			`{"status":"open","visibility":"community"}`, authHeader(t, emailBeirat))
		if rec.Code != 200 {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		waitTestMailerMails(t, app, 2, "submitter + staff new-issue mails")

		// exactly 2 mails: submitter + staff (beirat gets no update mail)
		if got := app.TestMailer.TotalSend(); got != 2 {
			t.Fatalf("expected exactly 2 mails, got %d: %s", got, mailSummary(app.TestMailer.Messages()))
		}

		submitterMail := findBySubject(t, app, "Ihre Meldung im WEG-Portal wurde angenommen")
		if to := toAddresses(submitterMail); len(to) != 1 || to[0] != "submitter@example.com" {
			t.Fatalf("expected submitter mail to submitter@example.com, got %v", to)
		}
		// no user-supplied content in the submitter mail
		for _, forbidden := range []string{"Defekte Laterne", "Fixture issue description", "Max Mustermann"} {
			if strings.Contains(submitterMail.HTML, forbidden) {
				t.Fatalf("submitter mail must not contain user-supplied text %q", forbidden)
			}
		}

		staffMail := findBySubject(t, app, "Angenommene Meldung: Defekte Laterne")
		to := toAddresses(staffMail)
		if len(to) != 1 || to[0] != emailHausmeister {
			t.Fatalf("expected staff mail only to the opted-in hausmeister %s, got %v", emailHausmeister, to)
		}
		// the opted-out hausverwaltung must receive nothing
		for _, addr := range to {
			if addr == emailHausverwaltung {
				t.Fatal("hausverwaltung with notify_new_issues=false must get no new-issue mail")
			}
		}
		// staff mails may contain the content
		if !strings.Contains(staffMail.HTML, "Defekte Laterne") {
			t.Fatal("expected the issue title in the staff mail")
		}
	})

	t.Run("issue rejected mails only the submitter", func(t *testing.T) {
		app := setupTestApp(t)
		defer app.Cleanup()

		mux := serveMux(t, app)

		rec := doJSON(t, mux, http.MethodPatch, "/api/collections/issues/records/issuepprv000001",
			`{"status":"rejected"}`, authHeader(t, emailBeirat))
		if rec.Code != 200 {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		waitTestMailerMails(t, app, 1, "submitter rejected mail")

		if got := app.TestMailer.TotalSend(); got != 1 {
			t.Fatalf("expected exactly 1 mail, got %d: %s", got, mailSummary(app.TestMailer.Messages()))
		}

		submitterMail := findBySubject(t, app, "Ihre Meldung im WEG-Portal wurde abgelehnt")
		if to := toAddresses(submitterMail); len(to) != 1 || to[0] != "submitter@example.com" {
			t.Fatalf("expected submitter mail to submitter@example.com, got %v", to)
		}
		for _, forbidden := range []string{"Unbekannte Person im Kellerflur", "Fixture issue description", "Max Mustermann"} {
			if strings.Contains(submitterMail.HTML, forbidden) {
				t.Fatalf("submitter mail must not contain user-supplied text %q", forbidden)
			}
		}
	})

	t.Run("issue status changes mail the submitter", func(t *testing.T) {
		app := setupTestApp(t)
		defer app.Cleanup()

		mux := serveMux(t, app)

		// hausmeister progresses an open community issue
		rec := doJSON(t, mux, http.MethodPatch, "/api/collections/issues/records/issueocom000001",
			`{"status":"in_progress"}`, authHeader(t, emailHausmeister))
		if rec.Code != 200 {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		waitTestMailerMails(t, app, 1, "submitter in-progress mail")

		submitterMail := findBySubject(t, app, "Ihre Meldung im WEG-Portal wird bearbeitet")
		if to := toAddresses(submitterMail); len(to) != 1 || to[0] != "submitter@example.com" {
			t.Fatalf("expected submitter mail to submitter@example.com, got %v", to)
		}
		if strings.Contains(submitterMail.HTML, "Kaputte Gartenbank") {
			t.Fatal("submitter mail must not contain the issue title")
		}

		// beirat resolves the in_progress issue
		rec = doJSON(t, mux, http.MethodPatch, "/api/collections/issues/records/issueicom000001",
			`{"status":"resolved"}`, authHeader(t, emailBeirat))
		if rec.Code != 200 {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		waitTestMailerMails(t, app, 2, "submitter resolved mail")

		submitterMail = findBySubject(t, app, "Ihre Meldung im WEG-Portal wurde erledigt")
		if to := toAddresses(submitterMail); len(to) != 1 || to[0] != "submitter@example.com" {
			t.Fatalf("expected submitter mail to submitter@example.com, got %v", to)
		}
		if strings.Contains(submitterMail.HTML, "Lampe im Treppenhaus defekt") {
			t.Fatal("submitter mail must not contain the issue title")
		}
	})

	t.Run("non-status updates send no mail", func(t *testing.T) {
		app := setupTestApp(t)
		defer app.Cleanup()

		mux := serveMux(t, app)

		rec := doJSON(t, mux, http.MethodPatch, "/api/collections/issues/records/issueocom000001",
			`{"title":"Umbenannt"}`, authHeader(t, emailBeirat))
		if rec.Code != 200 {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}
		// invalid transitions send no mail either
		rec = doJSON(t, mux, http.MethodPatch, "/api/collections/issues/records/issueocom000001",
			`{"status":"resolved"}`, authHeader(t, emailBeirat))
		if rec.Code != 400 {
			t.Fatalf("expected 400, got %d", rec.Code)
		}

		if got := waitTestMailerIdle(app, "issue non-status updates"); got != 0 {
			t.Fatalf("expected no mail on non-status updates, got %d: %s", got, mailSummary(app.TestMailer.Messages()))
		}
	})

	t.Run("new issue mails all beirat members", func(t *testing.T) {
		app := setupTestApp(t)
		defer app.Cleanup()

		mux := serveMux(t, app)

		fields := validIssueFields()
		submit := doIssueSubmission(t, mux, fields, nil)
		if submit.Code != 200 {
			t.Fatalf("expected 200, got %d: %s", submit.Code, submit.Body.String())
		}

		waitTestMailerMails(t, app, 1, "beirat new-issue mail")

		if got := app.TestMailer.TotalSend(); got != 1 {
			t.Fatalf("expected exactly 1 mail, got %d: %s", got, mailSummary(app.TestMailer.Messages()))
		}

		beirat := findBySubject(t, app, "Neue Meldung: Meldefall test")
		if to := toAddresses(beirat); len(to) != 1 || to[0] != emailBeirat {
			t.Fatalf("expected the new-issue mail only for the beirat member, got %v", to)
		}
		if !strings.Contains(beirat.HTML, "Meldefall test") {
			t.Fatal("expected the issue title in the beirat mail (internal recipients may see the content)")
		}
	})
}

func TestWorkflowMailsSuggestions(t *testing.T) {
	t.Run("suggestion accepted mails the submitter with decision note", func(t *testing.T) {
		app := setupTestApp(t)
		defer app.Cleanup()

		mux := serveMux(t, app)

		rec := doJSON(t, mux, http.MethodPatch, "/api/collections/suggestions/records/suggpending0001",
			`{"status":"accepted","decision_note":"Wir freuen uns auf das Fest."}`, authHeader(t, emailBeirat))
		if rec.Code != 200 {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		waitTestMailerMails(t, app, 1, "suggestion accepted mail")

		m := findBySubject(t, app, "Ihr Kalendervorschlag wurde angenommen")
		if to := toAddresses(m); len(to) != 1 || to[0] != "submitter@example.com" {
			t.Fatalf("expected submitter mail to submitter@example.com, got %v", to)
		}
		if !strings.Contains(m.HTML, "Wir freuen uns auf das Fest.") {
			t.Fatal("expected the trusted decision note in the submitter mail")
		}
		for _, forbidden := range []string{"Vorschlag Sommerfest", "Ein Sommerfest im Innenhof."} {
			if strings.Contains(m.HTML, forbidden) {
				t.Fatalf("submitter mail must not contain user-supplied text %q", forbidden)
			}
		}
	})

	t.Run("suggestion rejected mails the submitter with decision note", func(t *testing.T) {
		app := setupTestApp(t)
		defer app.Cleanup()

		mux := serveMux(t, app)

		rec := doJSON(t, mux, http.MethodPatch, "/api/collections/suggestions/records/suggpending0001",
			`{"status":"rejected","decision_note":"Kein Budget in diesem Jahr."}`, authHeader(t, emailBeirat))
		if rec.Code != 200 {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		waitTestMailerMails(t, app, 1, "suggestion rejected mail")

		m := findBySubject(t, app, "Ihr Kalendervorschlag wurde abgelehnt")
		if to := toAddresses(m); len(to) != 1 || to[0] != "submitter@example.com" {
			t.Fatalf("expected submitter mail to submitter@example.com, got %v", to)
		}
		if !strings.Contains(m.HTML, "Kein Budget in diesem Jahr.") {
			t.Fatal("expected the decision note in the submitter mail")
		}
		if strings.Contains(m.HTML, "Vorschlag Sommerfest") {
			t.Fatal("submitter mail must not contain the suggestion title")
		}

		// no mail for beirat edits without a status change
		rec = doJSON(t, mux, http.MethodPatch, "/api/collections/suggestions/records/suggpending0001",
			`{"location":"Innenhof"}`, authHeader(t, emailBeirat))
		if rec.Code != 200 {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}
		if got := waitTestMailerIdle(app, "non-status suggestion update"); got != 1 {
			t.Fatalf("expected still only the 1 rejection mail, got %d: %s", got, mailSummary(app.TestMailer.Messages()))
		}
	})

	t.Run("new suggestion mails all beirat members", func(t *testing.T) {
		app := setupTestApp(t)
		defer app.Cleanup()

		mux := serveMux(t, app)

		body := fmt.Sprintf(`{"title":"Neuer Vorschlag per API","description":"Beschreibung","date_start":"2027-01-01 10:00:00.000Z","email":"neuer@example.com","status":"pending","honeypot":"","form_started_at":%d}`, trapMS())

		// public guest create (the normal submission channel)
		rec := doJSON(t, mux, http.MethodPost, "/api/collections/suggestions/records", body, nil)
		if rec.Code != 200 {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		waitTestMailerMails(t, app, 1, "beirat new-suggestion mail")

		m := findBySubject(t, app, "Neuer Kalendervorschlag: Neuer Vorschlag per API")
		if to := toAddresses(m); len(to) != 1 || to[0] != emailBeirat {
			t.Fatalf("expected the new-suggestion mail only for the beirat member, got %v", to)
		}
		if !strings.Contains(m.HTML, "Neuer Vorschlag per API") {
			t.Fatal("expected the suggestion title in the beirat mail")
		}
	})
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func countRecords(t testing.TB, app *tests.TestApp, collection string) int {
	t.Helper()

	records, err := app.FindAllRecords(collection)
	if err != nil {
		t.Fatal(err)
	}

	return len(records)
}

func findRecordsByTitle(t testing.TB, app *tests.TestApp, collection, title string) []*core.Record {
	t.Helper()

	records, err := app.FindAllRecords(collection)
	if err != nil {
		t.Fatal(err)
	}

	var filtered []*core.Record
	for _, r := range records {
		if r.GetString("title") == title {
			filtered = append(filtered, r)
		}
	}

	return filtered
}
