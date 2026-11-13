#!/usr/bin/env bash
# Makes a backup on the server and downloads it to this computer.
#
#   scripts/backup.sh                    fresh, consistent snapshot of pb_data
#                                        (the portal is offline for a few seconds)
#   scripts/backup.sh --latest-nightly   newest nightly PocketBase backup, no downtime
#
# Settings (environment variables or flags):
#   WEG_SSH          user@host of the server            (-s, required)
#   WEG_BACKUP_DIR   local target directory             (-o, default ~/weg-portal-backups)
#
# Uses your normal ssh configuration (keys, ~/.ssh/config). Your key must be
# allowed for the deploy user (deploy/server-setup.sh --deploy-key), which
# may run the server's backup command weg-portal-ctl via sudo.
#
# The archives contain personal data (owner accounts, submitter emails,
# photos): keep them on an encrypted disk and delete old copies.
set -euo pipefail

target=${WEG_SSH:-}
out_dir=${WEG_BACKUP_DIR:-$HOME/weg-portal-backups}
mode=snapshot

usage() {
    sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

while [ $# -gt 0 ]; do
    case "$1" in
        --latest-nightly) mode=nightly ;;
        -s) target=${2:?}; shift ;;
        -o) out_dir=${2:?}; shift ;;
        -h | --help) usage 0 ;;
        *) echo "unknown argument: $1" >&2; usage 2 ;;
    esac
    shift
done

if [ -z "$target" ]; then
    echo "Set the server: WEG_SSH=deploy@weg7026.de $0  (or -s deploy@host)" >&2
    exit 2
fi

ssh_cmd=(ssh -o BatchMode=yes "$target")

echo "==> Backup on $target ($mode)"
if [ "$mode" = nightly ]; then
    remote_file=$("${ssh_cmd[@]}" "sudo -n /usr/local/sbin/weg-portal-ctl nightly" | tail -n 1)
else
    remote_file=$("${ssh_cmd[@]}" "sudo -n /usr/local/sbin/weg-portal-ctl backup manual" | tail -n 1)
fi

case "$remote_file" in
    /srv/weg-portal/backups/*) ;;
    *) echo "The server did not report a backup file (got: '$remote_file')." >&2; exit 1 ;;
esac

mkdir -p "$out_dir"
chmod 700 "$out_dir"
local_file="$out_dir/$(basename "$remote_file")"

echo "==> Downloading $remote_file"
scp -q -o BatchMode=yes "$target:$remote_file" "$local_file"
chmod 600 "$local_file"

echo "==> Verifying"
remote_sum=$("${ssh_cmd[@]}" "sha256sum '$remote_file'" | cut -d' ' -f1)
local_sum=$(sha256sum "$local_file" | cut -d' ' -f1)
if [ "$remote_sum" != "$local_sum" ]; then
    echo "Checksum mismatch - the download is incomplete: $local_file" >&2
    exit 1
fi
case "$local_file" in
    *.tar.gz) tar -tzf "$local_file" > /dev/null ;;
    *.zip) python3 -c 'import sys, zipfile; sys.exit(zipfile.ZipFile(sys.argv[1]).testzip() is not None)' "$local_file" ;;
esac

size=$(du -h "$local_file" | cut -f1)
echo "==> Saved $local_file ($size, sha256 $local_sum)"
echo "    Contains personal data - store it encrypted."
