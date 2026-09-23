#!/bin/bash
# Moves Party Hall onto partyhall.io, on the droplet. Run it from the repo on
# your own machine:
#
#   bash ops/migrate-to-partyhall.sh            # uses the `aitutor` SSH alias
#   bash ops/migrate-to-partyhall.sh myhost
#
# What it does, in order, stopping at the first failure:
#   1. Copies the current ops/ files (panel, lobbies, accounts, their tests
#      and service units) to the droplet, backing up each file it replaces.
#   2. Gives partyhall.io the routes aytingchi.uz had: /peer/ (matchmaking),
#      /lobbies/ (public rooms) and /admin/ (the operator panel). nginx is
#      tested before it reloads; a failed test puts the old config back.
#   3. Sends page loads on aytingchi.uz to partyhall.io. Its /auth/, /peer/,
#      /lobbies/, /admin/ and /api/ keep answering, so copies of the app
#      still cached under the old address, and the other app on /api/, keep
#      working.
#   4. Points the panel's public address at https://partyhall.io/admin.
#   5. Restarts the three services and runs the account, auth and ban tests.
#
# Nothing here touches DNS, certificates, the relay (coturn) or the deploy key.
set -euo pipefail
HOST="${1:-aitutor}"
HERE="$(cd "$(dirname "$0")" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"

echo "== copying ops files to $HOST:/tmp/partyhall-$STAMP"
ssh "$HOST" "mkdir -p /tmp/partyhall-$STAMP"
scp -q "$HERE"/panel.py "$HERE"/lobbies.py "$HERE"/accounts.py \
       "$HERE"/test_accounts.py "$HERE"/test_auth.py "$HERE"/test_bans.py \
       "$HERE"/accounts.service "$HERE"/lobbies.service "$HERE"/opspanel.service \
       "$HOST:/tmp/partyhall-$STAMP/"

ssh "$HOST" STAMP="$STAMP" 'bash -s' <<'REMOTE'
set -euo pipefail
SRC=/tmp/partyhall-$STAMP

echo "== installing services (backups end in .bak-$STAMP)"
for f in panel.py lobbies.py accounts.py test_accounts.py test_auth.py test_bans.py; do
  [ -f /opt/opspanel/$f ] && cp -a /opt/opspanel/$f /opt/opspanel/$f.bak-$STAMP
  install -m 0644 $SRC/$f /opt/opspanel/$f
done
for u in accounts lobbies opspanel; do
  unit=$(systemctl show -p FragmentPath --value $u)
  [ -n "$unit" ] && cp -a "$unit" "$unit.bak-$STAMP"
  install -m 0644 $SRC/$u.service "${unit:-/etc/systemd/system/$u.service}"
done
systemctl daemon-reload

echo "== nginx"
PH=$(readlink -f /etc/nginx/sites-enabled/partyhall)
AY=$(readlink -f /etc/nginx/sites-enabled/aytingchi)
cp -a "$PH" "$PH.bak-$STAMP"
cp -a "$AY" "$AY.bak-$STAMP"
restore() { cp -a "$PH.bak-$STAMP" "$PH"; cp -a "$AY.bak-$STAMP" "$AY"; echo "nginx config restored" >&2; }

python3 - "$PH" "$AY" <<'PY'
import sys
ph, ay = sys.argv[1], sys.argv[2]

routes = """    # Party Hall's backends: matchmaking, the public room list, and the
    # operator panel (behind sign-in).
    location /peer/ {
        proxy_pass http://127.0.0.1:9300;
        proxy_http_version 1.1;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
    location /lobbies/ {
        proxy_pass http://127.0.0.1:9100/;
        proxy_http_version 1.1;
        proxy_set_header Host            $host;
        proxy_set_header X-Real-IP       $remote_addr;
        proxy_set_header Origin          $http_origin;
        proxy_read_timeout 15s;
    }
    location = /admin { return 301 /admin/; }
    location /admin/ {
        proxy_pass http://127.0.0.1:9000/;
        proxy_http_version 1.1;
        proxy_set_header Host             $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Panel-Public   1;
        proxy_read_timeout 30s;
    }
"""
s = open(ph).read()
if "location /lobbies/" not in s:
    start = s.index("server_name partyhall.io;")
    at = s.index("    location /auth/ {", start)
    s = s[:at] + routes + s[at:]
    open(ph, "w").write(s)
    print("partyhall.io: /peer/ /lobbies/ /admin/ added")
else:
    print("partyhall.io: routes already there")

# aytingchi.uz: page loads go to partyhall.io; every backend path stays.
a = open(ay).read()
old = "    location / { try_files $uri $uri/ /index.html; }"
new = "    # Party Hall lives at partyhall.io now; the backends above stay for\n    # copies of the app still cached under this address.\n    location / { return 301 https://partyhall.io$request_uri; }"
first = a.index("server_name aytingchi.uz www.aytingchi.uz;")
at = a.find(old, first)
if at != -1:
    a = a[:at] + new + a[at + len(old):]
    open(ay, "w").write(a)
    print("aytingchi.uz: page loads now redirect to partyhall.io")
else:
    print("aytingchi.uz: redirect already in place")
PY
nginx -t || { restore; exit 1; }
systemctl reload nginx

echo "== panel address"
python3 - <<'PY'
import json, os
p = "/etc/opspanel/config.json"
c = json.load(open(p))
c["public_base_url"] = "https://partyhall.io/admin"
st = os.stat(p)
tmp = p + ".tmp"
with open(tmp, "w") as f:
    json.dump(c, f, indent=2)
# The panel runs as its own user and reads this through the file's group:
# the new file has to keep the old one's owner, group and mode.
os.chown(tmp, st.st_uid, st.st_gid)
os.chmod(tmp, st.st_mode & 0o777)
os.replace(tmp, p)
print("public_base_url = https://partyhall.io/admin")
PY

echo "== restarting"
systemctl restart accounts lobbies opspanel
sleep 2
systemctl is-active accounts lobbies opspanel peerserver

echo "== tests"
cd /opt/opspanel
python3 test_accounts.py | tail -1
python3 test_auth.py | tail -1
python3 test_bans.py | tail -1
rm -rf "$SRC"
REMOTE

echo "== from outside"
for p in lobbies/rooms admin/ auth/health; do
  printf '%-28s %s\n' "partyhall.io/$p" "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' https://partyhall.io/$p)"
done
printf '%-28s %s\n' "aytingchi.uz/" "$(curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}' https://aytingchi.uz/)"
echo "done. Tell Claude to deploy the site."
