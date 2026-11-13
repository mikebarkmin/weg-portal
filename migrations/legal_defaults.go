package migrations

// Initial content of the editable legal pages (generated once from the
// former locale drafts). The Beirat edits them in the portal afterwards
// (page "Rechtstexte"); they stay marked as drafts until released there.
// {{retention_*_days}} placeholders are filled from portal_settings when
// the page is shown, so the privacy policy always states the real periods.

const legalImpressumDefault = `## Angaben gemäß § 5 DDG

Betreiberin dieses Portals ist die Wohnungseigentümergemeinschaft TODO(Beirat): vollständige Bezeichnung der Gemeinschaft sowie Anschrift der Gemeinschaftsanlage (TODO(Beirat)).

Vertreten durch den Beirat der Wohnungseigentümergemeinschaft: TODO(Beirat): Namen der Beiratsmitglieder).

Kontakt: TODO(Beirat): E-Mail-Adresse des Beirats).

## Verantwortlich für den Inhalt

Verantwortlich für den Inhalt dieses Portals ist der Beirat der Wohnungseigentümergemeinschaft, TODO(Beirat): Namen der Beiratsmitglieder).

## Zweck des Portals

Dieses Portal dient ausschließlich der internen Kommunikation und Organisation innerhalb der Wohnungseigentümergemeinschaft (Terminkalender, Terminvorschläge, Mängelmeldungen und Freigabe von Eigentümerkonten). Es werden keine kommerziellen Dienste angeboten.
`

const legalDatenschutzDefault = `## Verantwortlicher

Verantwortlicher für die Datenverarbeitung auf diesem Portal ist der Beirat der Wohnungseigentümergemeinschaft, TODO(Beirat): vollständige Bezeichnung und Anschrift der Gemeinschaft, E-Mail-Adresse).

## Welche Daten werden verarbeitet?

Terminkalender: Die veröffentlichten Termine (Titel, Beschreibung, Termin, Ort, Kategorie) sind öffentlich einsehbar. Sie werden vom Beirat gepflegt.

Terminvorschläge: Bei einem Terminvorschlag werden Titel, Beschreibung, Termin, Ort und Kategorie sowie Ihre E-Mail-Adresse gespeichert. Die E-Mail-Adresse dient ausschließlich dazu, Ihnen die Entscheidung (Annahme oder Ablehnung samt Begründung) mitzuteilen; sie ist nur für den Beirat einsehbar.

Mängelmeldungen: Bei einer Meldung werden Titel, Beschreibung, Kategorie und die von Ihnen markierte Örtlichkeit gespeichert. Konto-basierte Nutzer (Eigentümer, Hausmeister, Hausverwaltung) sehen ausschließlich grob gerundete Koordinaten (ca. 100 m Genauigkeit); die genaue Position ist nur für den Beirat sowie Hausmeister und Hausverwaltung einsehbar. Angehängte Fotos werden vor dem Hochladen auf Ihrem Gerät neu codiert, wobei Aufnahme-Metadaten (u. a. GPS) entfernt werden. Ihre E-Mail-Adresse (und ein freiwillig angegebener Name) werden zur Rückmeldung getrennt von der Meldung gespeichert und sind nur für den Beirat einsehbar.

Benutzerkonten: Für Konten werden Name, E-Mail-Adresse, Rolle (Eigentümer/in, Beirat, Hausmeister, Hausverwaltung) und der Freigabestatus verarbeitet. Neue Konten sind erst nach Bestätigung der E-Mail-Adresse und Freigabe durch den Beirat nutzbar. Hausmeister und Hausverwaltung können optional Benachrichtigungen zu neuen Meldungen erhalten (Einwilligung, jederzeit widerrufbar).

Interne Notizen: Der Beirat kann interne Notizen (Titel, Text, Verfasser/in) anlegen. Diese sind ausschließlich für Beiratsmitglieder zugänglich.

Konten für Eigentümer: Konten sind ausschließlich für Eigentümerinnen und Eigentümer der Wohnanlage vorgesehen (sowie für Beirat, Hausmeister und Hausverwaltung). Zusätzlich gespeichert werden Ihre Einstellungen zu E-Mail-Benachrichtigungen (Aushänge, Termine) und – falls Sie ihn erzeugen – ein geheimer Schlüssel für Ihren persönlichen Kalender-Link.

Einreichungen mit Konto: Senden Sie eine Meldung oder einen Terminvorschlag angemeldet ab, wird die Einreichung mit Ihrem Konto verknüpft, damit Sie sie unter „Meine Einreichungen“ sehen. Die Verknüpfung ist nur für Sie und den Beirat sichtbar.

Verlauf von Meldungen: Statusänderungen einer Meldung werden mit Zeitpunkt und handelndem Konto protokolliert. Beirat, Hausmeister und Hausverwaltung können interne Notizen zu Meldungen erfassen; Verlauf und Notizen sind nur für diese Personen sichtbar.

Aushänge, Kontakte und Dokumente: Der Beirat veröffentlicht Aushänge (mit Verfasser/in), eine Kontaktliste (Name, Funktion, Telefon, E-Mail) und Dokumente (z. B. Hausordnung, Protokolle). Inhalte sind entweder öffentlich oder nur für angemeldete Eigentümer sichtbar. TODO(Beirat): Einwilligung der in der Kontaktliste genannten Personen einholen.

Themen für die Eigentümerversammlung: Eingereichte Themen werden mit Titel, Beschreibung und Ihrem Konto gespeichert. Angenommene Themen sehen alle angemeldeten Eigentümer – ohne Namen der Einreichenden.

Umfragen: Bei unverbindlichen Umfragen wird Ihre Stimme mit Ihrem Konto gespeichert, damit Sie nur einmal abstimmen und Ihre Stimme ändern können. Andere Eigentümer und der Beirat sehen nur das Gesamtergebnis, nicht Ihre einzelne Stimme.

## Empfänger und Dienstleister (Drittanbieter)

OpenStreetMap-Karten: Das Portal bindet Kartenausschnitte des OpenStreetMap-Projekts ein. Beim Aufruf der Karten werden Verbindungsdaten (u. a. Ihre IP-Adresse) an den Tile-Server der OpenStreetMap Foundation (Großbritannien), tile.openstreetmap.org, übermittelt. Eine Anmeldung dort ist nicht erforderlich.

E-Mail-Versand: Der Versand der Benachrichtigungs-E-Mails erfolgt über den SMTP-Dienstleister TODO(Beirat): Name und Adresse des Anbieters). Für die Zustellung werden die jeweils erforderlichen Empfänger- und Absenderdaten verarbeitet.

Sicherungskopien (Backups) der Portaldaten werden verschlüsselt extern gespeichert bei TODO(Beirat): Anbieter/Standort des Backupspeichers).

Eine darüberhinausgehende Weitergabe Ihrer Daten an Dritte findet nicht statt. Es findet keine Vermarktung oder Profilbildung statt.

## Speicherdauer und Löschfristen

Abgelehnte Terminvorschläge werden {{retention_suggestions_rejected_days}} Tage nach der Entscheidung gelöscht.

Angenommene Terminvorschläge werden {{retention_suggestions_accepted_days}} Tage nach der Entscheidung gelöscht; der veröffentlichte Termin selbst bleibt im Kalender bestehen, bis der Beirat ihn entfernt.

Abgelehnte Meldungen (einschließlich Fotos und hinterlegter E-Mail-Adresse) werden {{retention_issues_rejected_days}} Tage nach der Entscheidung gelöscht.

Erledigte Meldungen (einschließlich Fotos und hinterlegter E-Mail-Adresse) werden {{retention_issues_resolved_days}} Tage nach Erledigung gelöscht.

Noch nicht abschließend bearbeitete (offene) Vorschläge und Meldungen werden nicht automatisch gelöscht.

Benutzerkonten können Sie jederzeit selbst im Profil löschen. Dabei werden Konto, Name, E-Mail-Adresse, Benachrichtigungseinstellungen und Ihre Umfragestimmen gelöscht; Meldungen und eingereichte Themen bleiben ohne Bezug zu Ihrem Konto erhalten. Nach einem Verkauf entzieht der Beirat die Freigabe.

Verlauf und interne Notizen einer Meldung werden zusammen mit der Meldung gelöscht (siehe oben). Aushänge, Kontakte, Dokumente, Themen und Umfragen löscht der Beirat, sobald sie nicht mehr benötigt werden. TODO(Beirat): feste Fristen für Themen und Umfragen festlegen.

Die genannten Fristen werden automatisch aus den aktuellen Einstellungen des Portals übernommen.

## Ihre Rechte

Sie haben das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16 DSGVO), Löschung (Art. 17 DSGVO), Einschränkung der Verarbeitung (Art. 18 DSGVO), Datenübertragbarkeit (Art. 20 DSGVO) sowie Widerspruch gegen die Verarbeitung (Art. 21 DSGVO). Wenden Sie sich dazu an den Beirat: TODO(Beirat): Kontakt).

Die Einwilligung zur Veröffentlichung von Fotos (Foto-Einwilligung bei Meldungen) ist freiwillig und kann jederzeit mit Wirkung für die Zukunft widerrufen werden.

Ihnen steht zudem ein Beschwerderecht bei der zuständigen Aufsichtsbehörde zu.
`
