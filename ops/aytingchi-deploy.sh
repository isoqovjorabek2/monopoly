#!/bin/bash
# Deploys the game to https://partyhall.io from GitHub Actions.
#
# Installed as /usr/local/bin/aytingchi-deploy and bound to one SSH key in
# root's authorized_keys as a forced command:
#
#   command="/usr/local/bin/aytingchi-deploy",restrict ssh-ed25519 AAAA... github-actions-deploy
#
# so that key can do exactly this and nothing else - no shell, no forwarding,
# and whatever command the client asks for is ignored. It reads a gzipped
# tar of the built site on stdin and swaps it in.
#
# The archive is untrusted input to a root process, so it is unpacked by an
# unprivileged user that can write nowhere but the staging directory, capped
# in size, and refused if it is not a site build or contains a symlink.
set -euo pipefail
umask 022

WWW=/var/www
LIVE=$WWW/aytingchi
STAGE=$WWW/aytingchi.new
KEEP_BACKUPS=3
MAX_BYTES=60000000
UNPACKER=sitedeploy

exec 9>/run/aytingchi-deploy.lock
flock -n 9 || { echo "another deploy is running" >&2; exit 1; }

id "$UNPACKER" >/dev/null 2>&1 \
  || useradd --system --no-create-home --shell /usr/sbin/nologin "$UNPACKER"

rm -rf "$STAGE"
install -d -o "$UNPACKER" -g "$UNPACKER" -m 755 "$STAGE"

refuse() { echo "refused: $1" >&2; rm -rf "$STAGE"; exit 1; }

head -c "$MAX_BYTES" \
  | runuser -u "$UNPACKER" -- tar -xzf - -C "$STAGE" --no-same-owner --no-same-permissions \
  || refuse "the archive did not unpack"

[ -f "$STAGE/index.html" ] && [ -d "$STAGE/assets" ] || refuse "not a site build"
if find "$STAGE" -type l | grep -q .; then refuse "symlinks in the archive"; fi

# A tab still open on the last build lazy-loads its chunks by hashed name, so
# recent old assets stay available. Only recent ones: copied with their dates,
# they age out after a few days instead of piling up forever.
if [ -d "$LIVE/assets" ]; then
  find "$LIVE/assets" -maxdepth 1 -type f -mtime -3 \
    -exec cp --update=none --preserve=timestamps {} "$STAGE/assets/" \;
fi

chown -R www-data:www-data "$STAGE"
STAMP=$(date +%Y%m%d-%H%M%S)
if [ -d "$LIVE" ]; then mv "$LIVE" "$WWW/aytingchi.bak-$STAMP"; fi
mv "$STAGE" "$LIVE"

ls -1dt "$WWW"/aytingchi.bak-* 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -rf
echo "deployed; previous build kept as aytingchi.bak-$STAMP"
