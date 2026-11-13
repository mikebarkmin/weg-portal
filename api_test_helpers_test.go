package portal

import (
	"sync"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// fixture identities (see test_pb_data/README.md)
const (
	fixturePassword = "passwort123"

	emailUnapproved     = "unapproved@portal.test"
	emailResident       = "resident@portal.test"
	emailBeirat         = "beirat@portal.test"
	emailHausmeister    = "hm@portal.test"
	emailHausverwaltung = "hv@portal.test"

	superuserEmail = "super@portal.test"
)

// setupTestApp returns a test app instance bound to the fixture DB in
// test_pb_data (the directory is cloned per instance by NewTestApp).
func setupTestApp(t testing.TB) *tests.TestApp {
	testApp, err := tests.NewTestApp("./test_pb_data")
	if err != nil {
		t.Fatal(err)
	}

	bindAppHooks(testApp)

	return testApp
}

var tokenCache sync.Map // collection/email -> auth token

// getAuthToken returns an auth token for the fixture record from the given
// collection. Tokens are cached per email: the fixture DB signs them with a
// stable secret, so a token minted in one app instance is accepted by all.
func getAuthToken(t testing.TB, collection, email string) string {
	key := collection + "/" + email
	if cached, ok := tokenCache.Load(key); ok {
		return cached.(string)
	}

	app := setupTestApp(t)
	defer app.Cleanup()

	record, err := app.FindAuthRecordByEmail(collection, email)
	if err != nil {
		t.Fatalf("failed to find %q auth record with email %q: %v", collection, email, err)
	}

	token, err := record.NewAuthToken()
	if err != nil {
		t.Fatalf("failed to generate auth token for %q: %v", email, err)
	}

	tokenCache.Store(key, token)

	return token
}

// authHeader returns the Authorization header for a fixture identity.
func authHeader(t testing.TB, email string) map[string]string {
	return map[string]string{"Authorization": getAuthToken(t, "users", email)}
}

// var token different from auth: file tokens are short lived but signed by
// the same fixture secret, so minting them per test run is fine.
func getFileToken(t testing.TB, email string) string {
	app := setupTestApp(t)
	defer app.Cleanup()

	record, err := app.FindAuthRecordByEmail("users", email)
	if err != nil {
		t.Fatalf("failed to find auth record with email %q: %v", email, err)
	}

	token, err := record.NewFileToken()
	if err != nil {
		t.Fatalf("failed to generate file token for %q: %v", email, err)
	}

	return token
}

// fixturePhotoName returns the stored filename of the first photo of a
// fixture issue. PocketBase randomizes upload names, so tests must read
// the name from the fixture instead of hardcoding it.
func fixturePhotoName(t testing.TB, issueId string) string {
	app := setupTestApp(t)
	defer app.Cleanup()

	record, err := app.FindRecordById("issues", issueId)
	if err != nil {
		t.Fatalf("failed to find fixture issue %q: %v", issueId, err)
	}

	photos := record.GetStringSlice("photos")
	if len(photos) == 0 {
		t.Fatalf("fixture issue %q has no photos", issueId)
	}

	return photos[0]
}
