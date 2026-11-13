# Deployment & Betrieb (M11)

Dieses Dokument beschreibt den Betrieb des WEG-Portals mit Docker Compose
(`compose.yaml`: `caddy` + `portal`). Es richtet sich an die betreuende Person
(Superuser/Server-Administration), nicht an den Beirat — für den Beirat gibt es
das Betriebshandbuch (M12).

Stack-Übersicht:

```
Caddy (TLS-Terminierung, HSTS, Basic-Auth für /_/)
  └── portal (Container: ein statisches Go-Binary "/app/weg-portal")
        ├── API, Auth, Dateien, Realtime (PocketBase-Kern)
        ├── eingebettete SPA (React, ui/dist)
        └── /app/pb_data  (benanntes Docker-Volume pb_data: SQLite + Uploads)
```

## 1. Voraussetzungen

- Docker (oder Podman + podman-compose) auf dem VPS; Ports 80/443 frei.
- DNS-A-Record der Domain auf den Server (Produktion).
- Die Images: `caddy:2-alpine` (folgt `compose.yaml`), das Portal-Image wird
  aus diesem Repository gebaut (`docker compose build`).

## 2. Ersteinrichtung

### 2.1 Env-Dateien anlegen

```bash
cp portal.env.example portal.env
cp caddy.env.example caddy.env
```

- `portal.env`: Bounding-Box der WEG (`PORTAL_MIN_LAT` … `PORTAL_MAX_LNG`)
  setzen — sie begrenzt, wo Mängelmeldungen gesetzt werden dürfen.
- `caddy.env`:
  - `WEG_SITE_ADDRESS` — lokal zum Testen `localhost`, Produktion die echte Domain;
  - `WEG_ADMIN_BASIC_HASH` — bcrypt-Hash des Passworts für `/_/`, erzeugen mit:

    ```bash
    docker run --rm docker.io/library/caddy:2-alpine \
        caddy hash-password --plaintext 'GEHEIM'
    ```

Die env-Dateien stehen in `.gitignore` und werden **niemals committet**
(dort stehen keine Klartext-Passwörter, aber der Hash der Admin-Auth und
die Deployment-Konfiguration bleiben privat).

### 2.2 Bauen und Starten

```bash
docker compose build
docker compose up -d
```

- Der Build ist mehrstufig: Node baut die SPA (ui/dist), Go baut das
  statische Binary (`CGO_ENABLED=0`), die Laufzeitstufe ist Alpine mit
  unprivilegiertem User `nonroot`.
- Das Volume `pb_data` wird beim ersten Start angelegt; Migrationen
  (Collections, Rules, Rate-Limits, Backup-Cron `0 2 * * *`) laufen
  automatisch.
- Caddy terminiert TLS. Lokal ohne DNS nutzt Caddy seine interne CA
  (`tls internal`) — `curl -k https://localhost/` funktioniert; Browser
  brauchen einmalig das Importieren der CA oder eine Ausnahme.
- Für die Produktion: in `caddy.env` die Domain setzen und im `Caddyfile`
  die Zeile `tls internal` durch den unter "PRODUCTION VARIANT" dort
  dokumentierten Block ersetzen (Let's Encrypt, `tls1.2 tls1.3`).

### 2.3 Die zwei Superuser anlegen

Der Beirat arbeitet **nie** in `/_/` (plan.md); Superuser sind nur für
Setup und Rollenverwaltung. Mindestens zwei Personen mit Superuser-Zugang,
damit kein Single Point of Failure entsteht.

Superuser werden **nicht** über Umgebungsvariablen konfiguriert, sondern per
CLI im laufenden Container (das Binary unterstützt `superuser upsert`; es
liegt im Image unter `/app/weg-portal`):

```bash
docker compose exec portal /app/weg-portal superuser upsert admin1@example.com 'STARKES-PASSWORT-1'
docker compose exec portal /app/weg-portal superuser upsert admin2@example.com 'STARKES-PASSWORT-2'
```

(Entwicklung/ohne Container: `go run ./base superuser upsert …`.)

### 2.4 Superuser-MFA aktivieren (Passwort + E-Mail-OTP)

Voraussetzung: SMTP ist konfiguriert (nächster Abschnitt), sonst kann kein
OTP per Mail zugestellt werden.

1. `https://<domain>/_/` öffnen — Caddy fragt zuerst die Basic-Auth ab
   (der Username/Hash aus `caddy.env`).
2. Als Superuser-Passwort anmelden, dann in der Admin-UI unter
   **Superusers → [Account] → MFA** die Zwei-Faktor-Authentifizierung
   aktivieren: bei PocketBase bedeutet MFA Passwort + OTP; das OTP wird
   an die hinterlegte Superuser-E-Mail versendet.
3. Für **beide** Superuser wiederholen.

Ab dem nächsten Login wird nach dem Passwort zusätzlich der E-Mail-OTP
verlangt. Backup-Codes erzeugt PocketBase bei Aktivierung ("recovery")
— sicher ablegen.

### 2.5 SMTP und S3-Backups konfigurieren

SMTP- und S3-Einstellungen werden **nicht** aus der Umgebung gelesen,
sondern von einem Superuser in der Admin-UI gepflegt (Details/Platzhalter
siehe `portal.env.example`):

- SMTP: `/_/` → Settings → Mail settings (Host, Port, Benutzer, Passwort,
  Absender). Danach Test-Mail senden. Grundlage der Zustellbarkeit sind
  SPF/DKIM/DMARC der Absender-Domain.
- S3-Backups: `/_/` → Settings → Backups → S3 storage aktivieren und
  Zugangsdaten hinterlegen. Bis dahin legt der Backup-Cron nur lokale
  Zip-Dateien in `pb_data/backups/` ab (täglich 02:00, behält 5 Versionen).

## 3. Backups & Restore-Durchführung

Täglich um 02:00 erzeugt PocketBase automatisch eine konsistente
SQLite-Sicherung als Zip im Volume (`pb_data/backups/`). Diese Zip-Dateien
sollen zusätzlich an S3 (offsite) hochgeladen werden. Manuell anstoßen oder
herunterladen kann ein Superuser das Backup über `/_/` → Settings → Backups.

**Restore (Disaster Recovery):** Ziel ist, aus einer Backup-Zip die
Anwendung wiederherzustellen — Stop → Volume ersetzen → Start → prüfen.

```bash
# 0) Backup-Zip besorgen (entweder aus einem S3-Download oder aus dem
#    laufenden Container):
docker cp portal:/app/pb_data/backups/<name>.zip /srv/weg-portal/restore.zip

# 1) Stack stoppen
docker compose down          # KEIN -v! Das würde das Volume löschen

# 2) Volume-Inhalt durch das Backup ersetzen (WICHTIG: inkl. der
#    dotfiles ausleeren und die Dateien auf den Runtime-User des
#    Images chownen (UID/GID 10001), sonst kann die App die
#    wiederhergestellte SQLite-DB nicht öffnen/schreiben):
docker run --rm -v <projekt>_pb_data:/data \
    -v /srv/weg-portal/restore.zip:/restore.zip alpine:3.21 \
    sh -c 'cd /data && rm -rf .[!.]* * && unzip -q /restore.zip && chown -R 10001:10001 /data'

# 3) Stack starten und prüfen (z. B. einen bekannten Kalendereintrag, die
#    Superuser und /api/health):
docker compose up -d
curl -fsS https://localhost/api/health
```

Der obige Ablauf wurde während M11 einmal komplett durchgespielt
(Protokoll in `reviews/M11-handoff.md`): Datensatz angelegt → Backup
erstellt → Volume geleert und aus der Zip wiederhergestellt → Datensatz
wieder abrufbar.

**Nie** die live `data.db` per Dateikopie sichern, während der Server läuft
(plan.md): entweder die PocketBase-Backup-Funktion (konsistenter Snapshot)
oder ein SQLite-Level-Backup.

## 4. Update-Prozedur

Vor jedem Update (neue Portal-Version, neue PocketBase-Version) gilt:
**erst gegen eine Kopie von `pb_data` testen**, dann die Produktion.

```bash
# 1) Kopie des Produktions-Volumes in ein Test-Volume ziehen:
docker run --rm \
    -v weg-portal-m11_pb_data:/from:ro \
    -v weg-portal-update-test:/to alpine:3.21 sh -c 'cp -a /from/. /to/'

# 2) Test-Stack mit der Kopie starten (compose override oder temporäres
#    compose file, das pb_data durch weg-portal-update-test ersetzt und
#    andere Ports für caddy nutzt) + neue Version bauen:
docker compose build
#    Migrationen laufen automatisch; API prüfen und Test-Accounts
#    durchklicken: Kalender, Login, Mängelbilder, /_/

# 3) Bei Erfolg: Produktion aktualisieren
docker compose down
git pull            # bzw. Release auschecken
docker compose build && docker compose up -d

# 4) Test-Volume wieder entfernen
docker volume rm weg-portal-update-test
```

Rollback: vorherige Image-Version behalten (z. B. `docker tag
weg-portal:latest weg-portal:rollback-YYYYMMDD` vor dem Update) und bei
Problemen die alte Version mit dem unveränderten Volume starten. SQLite-
Downgrades von PocketBase sind nicht vorgesehen — vor einem PocketBase-
Upgrade immer das Backup prüfen.

## 5. Umgebungsvariablen (Referenz)

| Variable | Service | Bedeutung |
|---|---|---|
| `PORTAL_MIN_LAT` | portal | Min Latitude des Melde-Gebiets (Standard 51.0) |
| `PORTAL_MAX_LAT` | portal | Max Latitude (Standard 51.5) |
| `PORTAL_MIN_LNG` | portal | Min Longitude (Standard 7.0) |
| `PORTAL_MAX_LNG` | portal | Max Longitude (Standard 7.5) |
| `WEG_SITE_ADDRESS` | caddy | Site-Label des Caddyfile-Site-Blocks: `localhost` (test) oder echte Domain |
| `WEG_ADMIN_BASIC_USER` | caddy | Basic-Auth-Benutzername für `/_/` (Default `portal`) |
| `WEG_ADMIN_BASIC_HASH` | caddy | bcrypt-Hash des Basic-Auth-Passworts (Pflicht!) |
| — | — | SMTP/S3: **nicht** per env, sondern in `/_/` (Abschnitt 2.5); Superuser-Passwörter: nur per CLI (Abschnitt 2.3) |

## 6. Caddy-Varianten für `/_/`

Voreingestellt (und hier getestet): **Basic-Auth** im `Caddyfile`-Block
`handle /_*`. Das schützt die Admin-UI; die Admin-API selbst verlangt
zusätzlich einen Superuser-Token (Verteidigung in der Tiefe).

Produktions-Alternative: **IP-Allowlist** über `remote_ip` — im `Caddyfile`
unter "ALTERNATIVE /_/-SCHUTZ: IP-ALLOWLIST VARIANT" auskommentiert
dokumentiert. Beide Mechanismen lassen sich auch kombinieren (erst
Allowlist, dann Basic-Auth).

TLS: lokal `tls internal` (interne CA, Browser-Warnung unkritisch, Tests mit
`curl -k`). Produktion: echte Domain + Let's Encrypt — die nötige Änderung
steht im `Caddyfile` unter "PRODUCTION VARIANT" (Domain, `tls`-Block mit
`protocols tls1.2 tls1.3`, optional erst Staging-CA gegen Rate-Limits).

## 7. Lokale Verifikation des Stacks (ohne DNS/Let's Encrypt)

Genau dieser Ablauf wurde für die Abnahme von M11 durchlaufen.

**Rootless-Podman-Einschränkung:** Unprivilegiertes Podman kann Ports < 1024
nicht binden. `compose.yaml` erlaubt deshalb die Host-Ports über Variablen
zu überschreiben — für die lokale Verifikation eine `.env` (nicht committet):

```bash
cat > .env <<'EOF'
HTTP_PORT=8081
HTTPS_PORT=8443
EOF

docker compose build
docker compose up -d
# Health des Portals (das im Image definierte HEALTHCHECK wird von
# podman im OCI-Format aktuell ignoriert -> hier manuell prüfen):
docker compose ps
podman exec weg-portal-m11_portal_1 wget -qO- http://127.0.0.1:8080/api/health
# SPA via Caddy (interne CA -> curl -k):
curl -kI https://localhost:8443/          # 200, CSP + HSTS Header
# Admin-UI ohne Basic-Auth -> 401, mit -> 200:
curl -kI https://localhost:8443/_/                     # 401
curl -kI -u portal:PASSWORT https://localhost:8443/_/  # 200
```

Unter echtem Docker (Produktion) fällt die `.env` weg: dann laufen die
Standardports 80/443 und `docker compose ps` zeigt den Health-Status des
Portals aus dem im Image definierten HEALTHCHECK (/api/health).

Zum Testen ohne Produktionsgefahr: das Acceptance-Setup benutzt bewusst
Wegwerf-Passwörter und wird mit `docker compose down -v` vollständig
(inkl. Volumes) beseitigt — Daten im `pb_data`-Volume gehen dabei verloren,
also `-v` nur für Test-Instanzen verwenden.
