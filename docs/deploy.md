# Deployment & Betrieb

Dieses Dokument beschreibt den Betrieb des WEG-Portals auf einem eigenen
Server (z. B. Hetzner-VPS, Debian 12 oder Ubuntu 24.04). Es richtet sich an
die betreuende Person (Superuser/Server-Administration), nicht an den
Beirat — für den Beirat gibt es das Betriebshandbuch.

Aufbau:

```
Caddy (Systempaket: TLS mit Let's Encrypt, HSTS, Basic-Auth für /_/)
  └── weg-portal.service (systemd, Benutzer weg-portal, 127.0.0.1:8090)
        └── /srv/weg-portal/current/weg-portal   ein statisches Go-Binary:
              API, Auth, Dateien, Realtime (PocketBase) + eingebettete Web-App
```

```
/srv/weg-portal/
├── current -> releases/v0.2.0    aktive Version (Symlink)
├── releases/v0.1.0/weg-portal    installierte Versionen (die letzten 5)
├── pb_data/                      SQLite-Datenbank + Uploads (nur weg-portal)
├── backups/                      Sicherungen vor Updates und manuelle
├── incoming/                     Upload-Ablage für neue Binaries (deploy)
├── portal.env                    Einstellungen (Zeitzone)
└── history                       wann welche Version aktiv wurde
```

Alle Betriebsaufgaben laufen über **`weg-portal-ctl`** (Datei
`deploy/weg-portal-ctl`, auf dem Server `/usr/local/sbin/weg-portal-ctl`):

| Befehl | Wirkung |
|---|---|
| `weg-portal-ctl status` | aktive Version, Dienststatus, Health, installierte Versionen |
| `weg-portal-ctl deploy vX.Y.Z` | Binary aus `incoming/` installieren, Daten sichern, umschalten, prüfen; ist die neue Version nicht gesund, **automatisch zurück** (Binary und Daten) |
| `weg-portal-ctl rollback [vX.Y.Z]` | auf die vorige (oder angegebene) Version umschalten, Daten unverändert |
| `weg-portal-ctl backup [label]` | konsistente Sicherung von `pb_data` (Portal wenige Sekunden gestoppt) |
| `weg-portal-ctl nightly` | neueste nächtliche PocketBase-Sicherung nach `backups/` kopieren |
| `weg-portal-ctl restore <datei>` | `pb_data` aus einer `.tar.gz`-Sicherung wiederherstellen (vorher wird der aktuelle Stand gesichert) |
| `weg-portal-ctl superuser <email>` | Superuser anlegen/Passwort setzen (nur als root, Passwort über stdin) |

Der Benutzer `deploy` (GitHub Actions und Ihr eigener SSH-Schlüssel) darf
per `sudo` **nur** `weg-portal-ctl` ausführen, sonst nichts.

## 1. Voraussetzungen

- Server mit Debian 12 oder Ubuntu 24.04 (amd64 oder arm64), Root-Zugang.
- DNS: `A`- (und ggf. `AAAA`-)Eintrag der Domain (z. B. `weg7026.de`) auf
  die Server-IP — sonst bekommt Caddy kein Zertifikat.
- Hetzner-Cloud-Firewall: eingehend 22, 80 und 443 erlauben.
- Ausgehende Mails: Hetzner sperrt die Ports 25 und 465; den
  SMTP-Anbieter daher über **Port 587** (STARTTLS) anbinden.

## 2. Ersteinrichtung

### 2.1 Deploy-Schlüssel erzeugen (lokal)

```bash
ssh-keygen -t ed25519 -N '' -C 'weg-portal deploy' -f weg_deploy
```

- `weg_deploy` (privat) → GitHub-Secret `DEPLOY_SSH_KEY` (Abschnitt 4.1)
- `weg_deploy.pub` → beim Setup mit `--deploy-key` übergeben

### 2.2 Server einrichten

Den Ordner `deploy/` und `portal.env.example` auf den Server kopieren und
das Setup als root ausführen:

```bash
scp -r deploy portal.env.example root@<server>:/root/weg-portal-setup/
ssh root@<server>
bash /root/weg-portal-setup/deploy/server-setup.sh --domain weg7026.de \
    --deploy-key "ssh-ed25519 AAAA... weg-portal deploy" \
    --deploy-key "ssh-ed25519 AAAA... ihr-laptop"   # für scripts/backup.sh
```

Das Setup installiert Caddy und curl, legt die Benutzer `weg-portal`
(Dienst) und `deploy` (Deployment) an, die Verzeichnisse, den
systemd-Dienst, `weg-portal-ctl` und die sudo-Regel, und schreibt die
Caddy-Konfiguration (`deploy/Caddyfile`). Am Ende zeigt es **einmalig**
das Passwort der Basic-Auth vor `/_/` an — im Passwortmanager ablegen.

Erneut ausführen ist gefahrlos: Dienst, `weg-portal-ctl` und Caddyfile
werden aktualisiert; Daten, `portal.env` und das `/_/`-Passwort bleiben
(neues Passwort: `--new-admin-password`).

### 2.3 Einstellungen in `portal.env`

`/srv/weg-portal/portal.env` (vom Setup aus `portal.env.example` angelegt)
anpassen, danach `systemctl restart weg-portal`:

- `PORTAL_TIMEZONE` (Standard `Europe/Berlin`).

Meldeorte werden nicht über Umgebungsvariablen konfiguriert: Der Beirat
legt die Bereiche (Häuser mit Geschossen, gemeinsame Flächen mit
Lageplan) im Portal unter „Bereiche & Lagepläne“ (`/bereiche`) an.

### 2.4 Erste Version ausrollen

Per GitHub Actions (Abschnitt 4): Versions-Tag pushen. Oder von Hand: das
Binary aus dem GitHub-Release nach `/srv/weg-portal/incoming/weg-portal-vX.Y.Z`
kopieren und `sudo weg-portal-ctl deploy vX.Y.Z` ausführen.

### 2.5 Die zwei Superuser anlegen

Der Beirat arbeitet **nie** in `/_/`; Superuser sind nur für Setup und
Rollenverwaltung. Mindestens zwei Personen mit Superuser-Zugang, damit kein
Single Point of Failure entsteht. Als root auf dem Server:

```bash
weg-portal-ctl superuser admin1@example.com    # fragt das Passwort ab
weg-portal-ctl superuser admin2@example.com
```

### 2.6 Superuser-MFA aktivieren (Passwort + E-Mail-OTP)

Voraussetzung: SMTP ist konfiguriert (2.7), sonst kann kein OTP per Mail
zugestellt werden.

1. `https://<domain>/_/` öffnen — Caddy fragt zuerst die Basic-Auth ab.
2. Als Superuser anmelden, unter **Superusers → [Account] → MFA** die
   Zwei-Faktor-Authentifizierung aktivieren (Passwort + OTP per E-Mail).
3. Für **beide** Superuser wiederholen; Backup-Codes sicher ablegen.

### 2.7 Application URL, SMTP und S3-Backups

Diese Einstellungen pflegt ein Superuser in der Admin-UI:

- **Application URL — zuerst setzen:** `/_/` → Settings → Application →
  „Application URL" auf die öffentliche Adresse (`https://weg7026.de`).
  Daraus entstehen die Links in allen Mails, die Bestätigungslinks der
  Registrierung und die UIDs des iCal-Feeds. **Vor** der Bekanntgabe des
  iCal-Abos setzen und danach nicht mehr ändern: ein späterer Wechsel
  ändert alle UIDs, abonnierte Kalender zeigen dann jeden Termin doppelt.
- **SMTP:** `/_/` → Settings → Mail settings (Host, **Port 587**, Benutzer,
  Passwort, Absender), danach Test-Mail senden. Für die Zustellbarkeit
  SPF/DKIM/DMARC der Absender-Domain einrichten. Mit rund 70 Eigentümern
  reichen Freemail-Limits (z. B. 50 Mails/Tag) nicht.
- **S3-Backups (offsite):** `/_/` → Settings → Backups → S3 storage
  aktivieren (z. B. Hetzner Object Storage). Ohne S3 liegen alle
  Sicherungen nur auf dem Server selbst.

## 3. Backups & Wiederherstellung

Es gibt drei Arten von Sicherungen:

- **Nächtlich** (02:00, PocketBase, die letzten 5): Zip-Dateien in
  `pb_data/backups/`, bei aktiviertem S3 zusätzlich offsite.
- **Vor jedem Update** (`weg-portal-ctl deploy`): `backups/pre-<version>-<zeit>.tar.gz`.
- **Manuell** (`weg-portal-ctl backup`, `scripts/backup.sh`):
  `backups/manual-<zeit>.tar.gz`.

Von den Sicherungen in `/srv/weg-portal/backups/` bleiben je Art die
neuesten 10.

**Nie** die live `data.db` per Dateikopie sichern, während der Dienst
läuft: entweder die PocketBase-Sicherung oder `weg-portal-ctl backup`
(stoppt den Dienst für die Kopie).

### 3.1 Backup erstellen und herunterladen

Auf einem Rechner, dessen Schlüssel beim Setup mit `--deploy-key`
hinterlegt wurde:

```bash
# frische, konsistente Sicherung (Portal ist dafür wenige Sekunden offline)
WEG_SSH=deploy@weg7026.de scripts/backup.sh

# oder ohne Unterbrechung: die neueste nächtliche PocketBase-Sicherung
WEG_SSH=deploy@weg7026.de scripts/backup.sh --latest-nightly
```

Die Datei landet in `~/weg-portal-backups/` (`-o` für ein anderes Ziel);
Prüfsumme und Archiv werden kontrolliert. Die Archive enthalten
personenbezogene Daten (Konten, E-Mail-Adressen, Fotos): nur auf
verschlüsselten Datenträgern ablegen und alte Kopien löschen.

### 3.2 Wiederherstellen

**Aus einer `.tar.gz`-Sicherung** (vor Updates, manuell):

```bash
sudo weg-portal-ctl restore backups/manual-20261113-190935.tar.gz
```

Eine heruntergeladene Datei vorher nach `/srv/weg-portal/backups/`
kopieren (als root). `restore` sichert den aktuellen Stand zuerst als
`before-restore-…` und startet den Dienst danach wieder.

**Aus einer nächtlichen Zip-Sicherung** (auch aus S3), als root:

```bash
systemctl stop weg-portal
weg-portal-ctl backup before-zip-restore      # Sicherheitskopie des Ist-Stands
cd /srv/weg-portal/pb_data
find . -mindepth 1 -delete
unzip -q /pfad/zur/sicherung.zip              # apt install unzip, falls nötig
chown -R weg-portal:weg-portal /srv/weg-portal/pb_data
systemctl start weg-portal && weg-portal-ctl status
```

Danach prüfen: einen bekannten Termin, das Login, `/_/`.

## 4. Releases per GitHub Actions

Der Workflow `.github/workflows/release.yml` baut und installiert eine neue
Version, sobald ein Versions-Tag gepusht wird:

```bash
git tag v0.2.0          # Semver: vMAJOR.MINOR.PATCH
git push origin v0.2.0
```

Ablauf: alle Tests (Go + UI) → GitHub-Release mit statischen Binaries
(amd64 und arm64) → das zum Server passende Binary per SSH nach
`incoming/` → `sudo weg-portal-ctl deploy v0.2.0` → Prüfung über
`https://<DEPLOY_HOST>/api/health`.

### 4.1 Einmalige Einrichtung in GitHub

Settings → Environments → `production`:

| Art | Name | Wert (Beispiel) |
|---|---|---|
| Secret | `DEPLOY_SSH_KEY` | privater Schlüssel `weg_deploy` (ganze Datei) |
| Secret | `DEPLOY_SSH_HOST` | IP oder Hostname des Servers |
| Secret | `DEPLOY_SSH_USER` | `deploy` |
| Secret | `DEPLOY_SSH_KNOWN_HOSTS` | Host-Key des Servers: Ausgabe von `ssh-keyscan <DEPLOY_SSH_HOST>` (empfohlen) |
| Variable | `DEPLOY_HOST` | `weg7026.de` (für die Prüfung von außen) |

`DEPLOY_SSH_KNOWN_HOSTS` pinnt den Host-Key: ohne das Secret liest der
Workflow den Schlüssel bei jedem Lauf ungeprüft aus dem Netz (Warnung im
Log). Die Ausgabe von `ssh-keyscan` einmal mit dem Server vergleichen
(`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` dort) und nach einer
Neuinstallation des Servers erneuern.

Optional: „Required reviewers" setzen, dann wartet das Ausrollen auf eine
Freigabe.

### 4.2 Rollback

**Automatisch:** wird die neue Version nicht innerhalb von 45 Sekunden
gesund, stellt `weg-portal-ctl deploy` die vorige Version **und** den
Datenstand von vor dem Update wieder her; der Workflow schlägt dann fehl
und zeigt die Log-Zeilen.

**Von Hand** (die neue Version läuft, hat aber einen Fehler):

```bash
sudo weg-portal-ctl rollback            # vorige Version, Daten unverändert
sudo weg-portal-ctl rollback v0.1.0     # bestimmte installierte Version
```

Hatte die neue Version Datenbank-Migrationen, läuft die alte Version nicht
auf den migrierten Daten: dann zusätzlich die Sicherung von vor dem Update
zurückspielen (`sudo weg-portal-ctl restore backups/pre-v0.2.0-….tar.gz`).
Daten, die seit dem Update eingegeben wurden, gehen dabei verloren.

Eine ältere Version kann auch per Actions → Release → „Run workflow" mit
dem alten Tag und „deploy only" erneut ausgerollt werden.

### 4.3 Vor größeren Updates

Bei neuen PocketBase-Versionen oder umfangreichen Migrationen zuerst lokal
gegen eine Kopie der Daten testen: Sicherung mit `scripts/backup.sh`
herunterladen, entpacken und die neue Version damit starten
(`weg-portal serve --dir <entpacktes pb_data>`).

## 5. Logs und Fehlersuche

```bash
sudo weg-portal-ctl status
journalctl -u weg-portal -n 100      # Portal
journalctl -u caddy -n 100           # TLS, Zertifikate, Proxy
```

Die Portal-Logs (inkl. fehlgeschlagener Mails) zeigt zusätzlich `/_/` →
Logs.

## 6. Umgebungsvariablen (Referenz, `portal.env`)

| Variable | Bedeutung |
|---|---|
| `PORTAL_TIMEZONE` | Zeitzone der Anlage, IANA-Name (Standard `Europe/Berlin`). Serientermine wiederholen sich zur gleichen Ortszeit (auch im iCal-Feed); Mails zeigen Zeiten darin. Ungültiger Wert → Start bricht ab. |

SMTP/S3: **nicht** per Umgebung, sondern in `/_/` (2.7). Superuser:
`weg-portal-ctl superuser` (2.5).

## 7. Schutz von `/_/`

Standard ist HTTP-Basic-Auth vor `/_/` (zusätzlich zum Superuser-Login mit
MFA). Alternativ oder zusätzlich eine IP-Allowlist: siehe Kommentar am Ende
von `deploy/Caddyfile`; nach der Änderung `server-setup.sh` erneut
ausführen. Caddy wird mit `systemctl restart caddy` (nicht `reload`) neu
geladen, weil seine lokale Admin-Schnittstelle abgeschaltet ist.

## 8. Lokal ausführen

```bash
make ui-build && make build          # Binary ./weg-portal mit eingebetteter Web-App
./weg-portal serve --http=127.0.0.1:8090
# oder während der Entwicklung:
go run ./base serve
```

## 9. Getestet / nicht getestet

Getestet (Debian 12 mit systemd im Container): `server-setup.sh`, der
gehärtete Dienst, `deploy` inkl. automatischem Rollback einer defekten
Version (Binary und Daten), `rollback`, `backup`, `nightly`, `restore`,
`superuser`, die sudo-Beschränkung des Benutzers `deploy` sowie die
Caddy-Konfiguration (`caddy validate`).

Erst beim ersten echten Deployment prüfbar:

- Let's Encrypt mit der echten Domain (DNS muss stimmen).
- Der GitHub-Workflow selbst (braucht die Secrets).
- S3-Offsite-Upload und der nächtliche Backup-Lauf.
- Mail-Versand über den gewählten SMTP-Anbieter.
