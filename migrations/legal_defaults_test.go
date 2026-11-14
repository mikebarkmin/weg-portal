package migrations

import (
	"strings"
	"testing"
)

// The initial legal texts (formerly checked in the UI locale tests): marked
// placeholders for the Beirat, the third parties, the processed data and
// the retention periods as placeholders filled from portal_settings.
func TestLegalDefaultsContent(t *testing.T) {
	if !strings.Contains(legalImpressumDefault+legalDatenschutzDefault, "TODO(Beirat)") {
		t.Error("the drafts must mark the parts the Beirat has to fill in")
	}

	for _, want := range []string{
		// third parties
		"Hausmeister und Hausverwaltung:", "SMTP-Dienstleister", "Backups",
		// processed data
		"E-Mail-Adresse", "Fotos", "Ortsangabe", "Lageplan", "Rolle",
		"Freigabestatus", "Interne Notizen", "Umfragen", "Eigentümerversammlung",
		// retention: placeholders, never hard-coded periods
		"{{retention_suggestions_rejected_days}}", "{{retention_suggestions_accepted_days}}",
		"{{retention_issues_rejected_days}}", "{{retention_issues_resolved_days}}",
		"nicht automatisch gelöscht",
	} {
		if !strings.Contains(legalDatenschutzDefault, want) {
			t.Errorf("Datenschutz draft is missing %q", want)
		}
	}

	// the portal no longer loads third-party map tiles
	if strings.Contains(legalDatenschutzDefault, "openstreetmap") {
		t.Error("the Datenschutz draft must not mention OpenStreetMap any more")
	}

	if strings.Contains(legalDatenschutzDefault, "365 Tage") {
		t.Error("retention periods must be placeholders, not fixed numbers")
	}
}
