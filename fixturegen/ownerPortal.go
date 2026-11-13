package main

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/filesystem"
)

// minimal valid one-page PDF used as the fixture document file
var fixturePDF = []byte("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
	"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
	"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
	"trailer<</Root 1 0 R>>\n%%EOF\n")

// seedOwnerPortal adds the records of the owner features (migration
// 1795000105): events in the owners/beirat calendars, announcements,
// contacts, documents, agenda items and a poll with one vote. See
// test_pb_data/README.md for the ids.
func seedOwnerPortal(app core.App, events *core.Collection, residentId, beiratId string) error {
	save := func(collection string, id string, fields map[string]any) (*core.Record, error) {
		c, err := app.FindCollectionByNameOrId(collection)
		if err != nil {
			return nil, err
		}
		r := core.NewRecord(c)
		r.Set("id", id)
		for k, v := range fields {
			r.Set(k, v)
		}
		return r, app.Save(r)
	}

	steps := []struct {
		collection, id string
		fields         map[string]any
	}{
		{"events", "eventowners0001", map[string]any{
			"title": "Eigentuemerversammlung", "date_start": "2026-12-10 18:00:00.000Z",
			"date_end": "2026-12-10 20:30:00.000Z", "location": "Gemeinschaftsraum", "calendar": "owners",
		}},
		{"events", "eventbeirat0001", map[string]any{
			"title": "Beiratssitzung", "date_start": "2026-12-03 18:30:00.000Z",
			"location": "Wohnung 3", "calendar": "beirat",
		}},
		{"announcements", "annpublic000001", map[string]any{
			"title": "Wasser wird abgestellt", "body": "Am **Dienstag** wird von 9 bis 12 Uhr das Wasser abgestellt.",
			"visibility": "public", "pinned": true, "author": beiratId,
		}},
		{"announcements", "annowners000001", map[string]any{
			"title": "Protokoll der Versammlung", "body": "Das Protokoll liegt unter Dokumente.",
			"visibility": "owners", "author": beiratId,
		}},
		{"announcements", "annexpired00001", map[string]any{
			"title": "Abgelaufen", "body": "Nicht mehr aktuell.", "visibility": "public",
			"expires_at": "2020-01-01 00:00:00.000Z", "author": beiratId,
		}},
		{"contacts", "contactbeirat01", map[string]any{
			"name": "Erika Beispiel", "function": "Beiratsvorsitz", "category": "beirat",
			"email": "beirat@portal.test", "visibility": "public", "sort": 1,
		}},
		{"contacts", "contactnotdst01", map[string]any{
			"name": "Heizungs-Notdienst", "category": "notdienst", "phone": "0202 123456",
			"visibility": "public", "sort": 1,
		}},
		{"contacts", "contactowners01", map[string]any{
			"name": "Kontoverbindung Ruecklage", "category": "verwaltung", "note": "Nur fuer Eigentuemer",
			"visibility": "owners", "sort": 2,
		}},
		{"agenda_items", "agendapending01", map[string]any{
			"title": "Fahrradstaender erneuern", "description": "Die Staender rosten.",
			"author": residentId, "status": "pending",
		}},
		{"agenda_items", "agendaaccept001", map[string]any{
			"title": "Dachsanierung", "author": beiratId, "status": "accepted",
			"decided_at": "2026-11-01 10:00:00.000Z",
		}},
		{"polls", "pollopen0000001", map[string]any{
			"question": "Sommerfest am 12. oder 19. Juli?", "options": []string{"12. Juli", "19. Juli"},
			"created_by": beiratId,
		}},
		{"poll_votes", "pollvote0000001", map[string]any{
			"poll": "pollopen0000001", "user": residentId, "option": 1,
		}},
	}
	for _, step := range steps {
		if _, err := save(step.collection, step.id, step.fields); err != nil {
			return err
		}
	}

	for _, doc := range []struct{ id, title, category, visibility string }{
		{"docpublic000001", "Hausordnung", "hausordnung", "public"},
		{"docowners000001", "Protokoll Eigentuemerversammlung 2026", "protokoll", "owners"},
	} {
		file, err := filesystem.NewFileFromBytes(fixturePDF, doc.id+".pdf")
		if err != nil {
			return err
		}
		if _, err := save("documents", doc.id, map[string]any{
			"title": doc.title, "category": doc.category, "visibility": doc.visibility,
			"file": file, "document_date": "2026-06-01 00:00:00.000Z",
		}); err != nil {
			return err
		}
	}

	return nil
}
