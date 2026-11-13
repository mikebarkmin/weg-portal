# Betriebshandbuch WEG-Portal

Zielgruppe: der **Beirat** (alle internen Aufgaben laufen über die
Weboberfläche des Portals) und die **Superuser** (nur Einrichtung,
Rollen und Infrastruktur). Der Beirat arbeitet **niemals** in der
PocketBase-Administration `/_/` — Superuser nur dort, wo unten genannt.

## Aufgaben des Beirats

### 1. Eigentümerkonten freigeben (`/users`)
- Konten sind **nur für Eigentümer**. Mieter nutzen die öffentlichen
  Seiten (Aktuelles, Kalender, Kontakte, öffentliche Dokumente, Melden)
  ohne Konto.
- Eigentümer registrieren sich selbst; nach Bestätigung ihrer
  E-Mail-Adresse erscheinen sie unter „Warten auf Freigabe“.
- Prüfen (Eigentümer der Anlage?), dann **Freigeben**. Erst freigegebene
  Konten sehen Pinnwand, Inhalte „Nur Eigentümer“ und „Mitreden“.
- **Verkauf**: Freigabe **zurückziehen** — wirkt sofort. Eigentümer
  können ihr Konto im Profil auch selbst löschen.

### 2. Moderation (`/moderation`)
- **Vorschläge** (Termine): bei Bedarf **Bearbeiten** (Tippfehler,
  Uhrzeit), **Kalender wählen** (Öffentlich, Eigentümer, Beirat), dann
  annehmen oder ablehnen. Die Anmerkung geht per E-Mail an den Absender.
- **Meldungen**: bei Bedarf bearbeiten, dann annehmen (Sichtbarkeit
  wählen: Gemeinschaft oder nur intern) oder ablehnen.
- **Themen** für die Eigentümerversammlung: aufnehmen oder nicht
  aufnehmen; der Eigentümer erhält die Entscheidung per E-Mail.
  Aufgenommene Themen an die Verwaltung weitergeben.

### 3. Meldungen bearbeiten (`/issues`)
- Status pflegen: angenommen → in Bearbeitung → erledigt (Beirat und
  Hausmeister). Die Einreichenden erhalten automatisch eine E-Mail.
- **Verlauf und Notizen** (nur Beirat, Hausmeister, Hausverwaltung):
  jede Statusänderung wird protokolliert; interne Notizen festhalten,
  z. B. „Firma beauftragt, Termin am …“. Notizen gehen nie an
  Eigentümer oder Einreichende.

### 4. Inhalte pflegen
- **Aktuelles** (`/aktuelles`): Aushänge öffentlich oder „Nur
  Eigentümer“ veröffentlichen, optional anheften oder mit Ablaufdatum.
  Eigentümer mit aktivierter Benachrichtigung erhalten eine E-Mail.
- **Kalender** (`/kalender`): drei Kalender — Öffentlich, Eigentümer,
  Beirat. Termine über „Neuer Termin“ anlegen, auch wiederkehrend.
- **Dokumente** (`/dokumente`): Hausordnung öffentlich, Protokolle,
  Beschlüsse, Abrechnungen „Nur Eigentümer“. Die verbindliche
  Beschluss-Sammlung (§ 24 WEG) führt weiterhin die Verwaltung.
- **Kontakte** (`/kontakte`): Notdienste, Beirat, Verwaltung,
  Hausmeister. Vor dem Eintragen von Personen deren Einverständnis
  einholen.
- **Umfragen** (`/mitreden`): nur **unverbindliche** Meinungsbilder;
  Beschlüsse fasst ausschließlich die Eigentümerversammlung. Antworten
  können nach der ersten Stimme nicht mehr geändert werden. Einzelne
  Stimmen sieht niemand, nur das Gesamtergebnis.
- **Interne Notizen** (`/notes`): nur für den Beirat.

### 5. Wer kontaktiert wen?
- Eigentümer und Mieter mit Fragen (Termin nicht sichtbar, Meldung, Zugangsprobleme)
  → **Beirat** (TODO(Beirat): E-Mail-Adresse des Beirats eintragen).
- Zugangsprobleme, Passwortzurücksetzung, Konten (anlegen, Rollen
  ändern, freigeben/verweigern, löschen) → **Administrator** über die
  Seite „Verwaltung“ (`/admin`) im Portal (TODO(Beirat): Kontaktdaten
  des Administrators eintragen; niemals Passwörter weitergeben).
- Beirat bei technischen Problemen oder Löschfristen → **Superuser**
  (TODO(Beirat): Kontaktdaten der beiden Superuser eintragen).

## Aufgaben der Administratoren (Rolle `admin`, Seite `/admin` im Portal)

- **Benutzer anlegen**: Name, E-Mail-Adresse und Rolle (Eigentümer,
  Beirat, Hausmeister, Hausverwaltung, Administrator); das
  Anfangspasswort wird erzeugt und einmalig angezeigt, um es persönlich
  zu übergeben.
- **Freigeben/verweigern und löschen**: neue Konten freigeben, Freigaben
  entziehen (z. B. nach Verkauf), Konten entfernen.
- **Rollen ändern** und **Passwörter zurücksetzen**.
- Das eigene Konto wird im Profil verwaltet; der letzte aktive
  Administrator kann weder degradiert noch gelöscht werden.

## Aufgaben der Superuser (nur `/_/` bzw. Server)

1. **Einrichtung** (siehe `docs/deploy.md`): zwei Superuser-Konten
   anlegen (`superuser upsert`), Superuser-MFA aktivieren
   (Passwort + E-Mail-OTP), Restore-Übung aus `docs/deploy.md` einmal
   durchführen.
2. **Administratoren ernennen**: die Rolle `admin` setzen (bzw. das
   erste Administratorkonto in `/_/` anlegen) — Rollen normaler Benutzer
   vergeben die Administratoren danach selbst über `/admin`; alles
   Weitere (Freigaben, Moderation) macht der Beirat über das Portal.
3. **Backups** nach `docs/deploy.md` betreiben (geplante Backups,
   verschlüsselter Offsite-Transfer; niemals die live Datenbank kopieren).
4. **Löschfristen ändern** (Sammlung `portal_settings`, Datensatz
   `portsettings000`): gilt für abgelehnte/angenommene Vorschläge und
   abgelehnte Meldungen (Standard 90 Tage) sowie erledigte Meldungen
   (Standard 365 Tage). **Pflichtfolge:** nach jeder Änderung muss die
   Datenschutzerklärung (`/datenschutz`) vom Beirat angepasst werden —
   die dort genannten Fristen müssen immer mit den Werten in
   `portal_settings` übereinstimmen. Änderung dem Beirat mitteilen.
5. Die **Datenschutzerklärung und das Impressum** (`/impressum`,
   `/datenschutz`) sind Entwürfe: bevor sie freigegeben werden, sind
   alle mit `TODO(Beirat)` markierten Stellen (Namen, Adressen,
   SMTP-Anbieter, Backup-Speicherort) auszufüllen und die Texte
   rechtlich zu prüfen.

---
Stand: Entwurf (M12).TODO(Beirat): Kontaktdaten der Superuser und des
Beirats ergänzen, Text final freigeben.
