# Betriebshandbuch WEG-Portal

Zielgruppe: der **Beirat** (alle internen Aufgaben laufen über die
Weboberfläche des Portals) und die **Superuser** (nur Einrichtung,
Rollen und Infrastruktur). Der Beirat arbeitet **niemals** in der
PocketBase-Administration `/_/` — Superuser nur dort, wo unten genannt.

## Aufgaben des Beirats

### 1. Bewohnerkonten freigeben (`/users`)
- Neue Bewohner registrieren sich selbst; nach Bestätigung ihrer
  E-Mail-Adresse erscheinen sie unter „Warten auf Freigabe“.
- Prüfen (gehört die Person zur Gemeinschaft?), dann **Freigeben**.
  Erst freigegebene Konten sehen die Pinnwand.
- **Auszug**: Freigabe **zurückziehen** — wirkt sofort, das Konto
  verliert den Zugriff (Rolle „Bewohner“ bleibt für einen möglichen
  Wiedereinzug erhalten, Name/E-Mail bleiben unverändert).

### 2. Terminvorschläge bearbeiten (`/moderation`)
- Vorschläge **annehmen** oder **ablehnen**; eine kurze Begründung
  (Entscheidungsnotiz) wird dem Einreichenden per E-Mail mitgeteilt.
- Angenommene Vorschläge erscheinen automatisch im öffentlichen Kalender.

### 3. Meldungen bearbeiten (`/issues`)
- Jede Meldung **annehmen** (dabei Sichtbarkeit wählen:
  „für die Gemeinschaft sichtbar“ oder „nur intern (privat)“) oder
  **ablehnen**. Die Entscheidung geht per E-Mail an die hinterlegte
  Adresse.
- Status pflegen: offen → in Arbeit → erledigt (Beirat und Hausmeister).
  Auch hier erhalten die Einreichenden automatisch eine E-Mail.
- Bei Meldungen mit Fotos gilt: Foto-Einwilligung wurde beim Einreichen
  eingeholt.

### 4. Interne Notizen (`/notes`)
- Notizen für den Beirat anlegen, anpinnen, bearbeiten, löschen. Nur der
  Beirat sieht diesen Bereich.

### 5. Wer kontaktiert wen?
- Bewohner mit Fragen (Termin nicht sichtbar, Meldung, Zugangsprobleme)
  → **Beirat** (TODO(Beirat): E-Mail-Adresse des Beirats eintragen).
- Beirat bei technischen Problemen, Rollenänderungen
  (Hausmeister/Hausverwaltung/Beirat) oder Löschfristen → **Superuser**
  (TODO(Beirat): Kontaktdaten der beiden Superuser eintragen; niemals
  Passwörter weitergeben).

## Aufgaben der Superuser (nur `/_/` bzw. Server)

1. **Einrichtung** (siehe `docs/deploy.md`): zwei Superuser-Konten
   anlegen (`superuser upsert`), Superuser-MFA aktivieren
   (Passwort + E-Mail-OTP), Restore-Übung aus `docs/deploy.md` einmal
   durchführen.
2. **Rollen vergeben**: Rolle `beirat`, `hausmeister` oder
   `hausverwaltung` setzen — alles Weitere (Freigaben, Moderation)
   macht der Beirat selbst über das Portal.
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
