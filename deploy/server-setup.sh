#!/usr/bin/env bash
# One-time (and repeatable) setup of a Debian/Ubuntu server for the WEG
# portal: Caddy, the service user, directories, the systemd unit, the admin
# command weg-portal-ctl and the deploy user. Run as root from a copy of this
# repository's deploy/ folder (docs/deploy.md, 2):
#
#   sudo bash deploy/server-setup.sh --domain weg7026.de \
#       --deploy-key "ssh-ed25519 AAAA... weg-portal deploy" \
#       --deploy-key "ssh-ed25519 AAAA... your laptop"
#
# Options:
#   --domain D            public domain (required on the first run)
#   --deploy-key KEY      public key allowed to log in as "deploy" (repeatable)
#   --new-admin-password  generate a new password for the /_/ basic auth
#
# Re-running it updates the unit, weg-portal-ctl and the Caddyfile and keeps
# data, portal.env and the /_/ password.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
BASE=/srv/weg-portal
ADMIN_FILE=/etc/caddy/weg-portal-admin

domain=""
keys=()
new_admin=0
while [ $# -gt 0 ]; do
    case "$1" in
        --domain) domain=${2:?}; shift ;;
        --deploy-key) keys+=("${2:?}"); shift ;;
        --new-admin-password) new_admin=1 ;;
        -h | --help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
    shift
done

[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
for f in weg-portal.service weg-portal-ctl Caddyfile; do
    [ -f "$here/$f" ] || { echo "missing $here/$f - copy the whole deploy/ folder" >&2; exit 1; }
done

if [ -z "$domain" ] && [ -f /etc/caddy/Caddyfile ]; then
    domain=$(sed -n 's/^# weg-portal-domain: //p' /etc/caddy/Caddyfile)
fi
[ -n "$domain" ] || { echo "--domain is required on the first run" >&2; exit 2; }
[[ "$domain" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "invalid domain '$domain'" >&2; exit 2; }

step() { echo; echo "==> $*"; }

step "Packages (caddy, curl)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
if ! apt-get install -y -qq caddy curl > /dev/null; then
    echo "Caddy is not in this distribution's package sources." >&2
    echo "Install it from https://caddyserver.com/docs/install#debian-ubuntu-raspbian, then re-run." >&2
    exit 1
fi

step "Users"
if ! id weg-portal > /dev/null 2>&1; then
    useradd --system --home-dir "$BASE" --no-create-home --shell /usr/sbin/nologin weg-portal
fi
if ! id deploy > /dev/null 2>&1; then
    useradd --create-home --shell /bin/bash deploy
    passwd -l deploy > /dev/null
fi
install -d -m 0700 -o deploy -g deploy /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys
for key in "${keys[@]}"; do
    grep -qxF "$key" /home/deploy/.ssh/authorized_keys || echo "$key" >> /home/deploy/.ssh/authorized_keys
done
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 0600 /home/deploy/.ssh/authorized_keys

step "Directories in $BASE"
install -d -m 0755 -o root -g root "$BASE" "$BASE/releases"
install -d -m 0700 -o weg-portal -g weg-portal "$BASE/pb_data"
install -d -m 0750 -o root -g deploy "$BASE/backups"
install -d -m 0700 -o deploy -g deploy "$BASE/incoming"
touch "$BASE/history"

if [ ! -f "$BASE/portal.env" ]; then
    if [ -f "$here/../portal.env.example" ]; then
        install -m 0640 -o root -g weg-portal "$here/../portal.env.example" "$BASE/portal.env"
    else
        printf 'PORTAL_TIMEZONE=Europe/Berlin\n' > "$BASE/portal.env"
        chown root:weg-portal "$BASE/portal.env"
        chmod 0640 "$BASE/portal.env"
    fi
    echo "created $BASE/portal.env - set the bounding box (PORTAL_MIN_LAT ...) before going live"
fi

step "Service, admin command and sudo rule"
install -m 0644 "$here/weg-portal.service" /etc/systemd/system/weg-portal.service
install -m 0755 -o root -g root "$here/weg-portal-ctl" /usr/local/sbin/weg-portal-ctl
sudoers=$(mktemp)
echo "deploy ALL=(root) NOPASSWD: /usr/local/sbin/weg-portal-ctl" > "$sudoers"
visudo -cf "$sudoers" > /dev/null
install -m 0440 "$sudoers" /etc/sudoers.d/weg-portal
rm -f "$sudoers"
systemctl daemon-reload
systemctl enable weg-portal > /dev/null 2>&1 || true

step "Caddy for $domain"
admin_password=""
if [ ! -f "$ADMIN_FILE" ] || [ "$new_admin" = 1 ]; then
    admin_password=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)
    admin_user=portal
    admin_hash=$(caddy hash-password --plaintext "$admin_password")
else
    read -r admin_user admin_hash < "$ADMIN_FILE"
fi
{
    echo "# weg-portal-domain: $domain"
    sed -e "s|__DOMAIN__|$domain|" -e "s|__ADMIN_USER__|$admin_user|" -e "s|__ADMIN_HASH__|$admin_hash|" "$here/Caddyfile"
} > /etc/caddy/Caddyfile.new
caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile > /dev/null 2>&1 || {
    caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile
    exit 1
}
# the credentials are stored only once the configuration is known to work,
# so a failed run never swallows a password that was not shown
(umask 077 && printf '%s %s\n' "$admin_user" "$admin_hash" > "$ADMIN_FILE")
chmod 0644 /etc/caddy/Caddyfile.new
mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile
systemctl enable caddy > /dev/null 2>&1 || true
# restart, not reload: the Caddyfile switches Caddy's local admin API off,
# which "systemctl reload caddy" would need
systemctl restart caddy

if command -v ufw > /dev/null && ufw status | grep -q "Status: active"; then
    ufw allow 80/tcp > /dev/null
    ufw allow 443/tcp > /dev/null
fi

step "Done"
echo "- Version:  $(weg-portal-ctl status | sed -n 's/^version: *//p')"
echo "- Next:     push a version tag; the release workflow deploys the binary"
echo "            (or: copy it to $BASE/incoming/weg-portal-vX.Y.Z and run"
echo "             sudo weg-portal-ctl deploy vX.Y.Z)"
echo "- Firewall: allow 22, 80 and 443 in the Hetzner Cloud firewall"
if [ -n "$admin_password" ]; then
    echo
    echo "  /_/ basic auth (store it in your password manager, it is shown only now):"
    echo "    user:     $admin_user"
    echo "    password: $admin_password"
fi
