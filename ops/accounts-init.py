#!/usr/bin/env python3
"""
Sets up player accounts on the droplet. Run as root. Safe to re-run: it
never replaces a key or a secret that already exists.

- creates the ``playerauth`` system user the service runs as
- generates the ECDSA P-256 signing key, here, so it never travels
- writes /etc/playerauth/config.json with fresh state and uid secrets, and
  the Google client id and secret copied from the status panel's config -
  the same OAuth client serves both, with one more redirect URI on it
- prints the public key, which is what the game gets built with
"""

import grp
import json
import os
import pwd
import secrets
import subprocess

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

DIR = "/etc/playerauth"
CONFIG = f"{DIR}/config.json"
KEY = f"{DIR}/signing-key.pem"
PANEL_CONFIG = "/etc/opspanel/config.json"
USER = "playerauth"

try:
    pwd.getpwnam(USER)
except KeyError:
    subprocess.run(["useradd", "--system", "--no-create-home", "--shell", "/usr/sbin/nologin", USER], check=True)
    print(f"created system user {USER}")
gid = grp.getgrnam(USER).gr_gid

os.makedirs(DIR, exist_ok=True)
os.chown(DIR, 0, gid)
os.chmod(DIR, 0o750)

if os.path.exists(KEY):
    print(f"{KEY} already exists - keeping it")
else:
    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                            serialization.NoEncryption())
    fd = os.open(KEY, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o640)
    with os.fdopen(fd, "wb") as fh:
        fh.write(pem)
    print(f"generated {KEY}")
os.chown(KEY, 0, gid)
os.chmod(KEY, 0o640)

cfg = {}
if os.path.exists(CONFIG):
    with open(CONFIG, encoding="utf-8") as fh:
        cfg = json.load(fh)
panel = {}
if os.path.exists(PANEL_CONFIG):
    with open(PANEL_CONFIG, encoding="utf-8") as fh:
        panel = json.load(fh)

cfg.setdefault("_comment", "Player sign-in. Root-owned, 0640, never in git.")
cfg.setdefault("redirect_uri", "https://partyhall.io/auth/google/callback")
for field in ("state_secret", "uid_secret"):
    if not cfg.get(field):
        cfg[field] = secrets.token_urlsafe(48)
for field in ("google_client_id", "google_client_secret"):
    if not cfg.get(field) and panel.get(field):
        cfg[field] = panel[field]

with open(CONFIG, "w", encoding="utf-8") as fh:
    json.dump(cfg, fh, indent=2)
    fh.write("\n")
os.chown(CONFIG, 0, gid)
os.chmod(CONFIG, 0o640)

print("\nsettings:")
for k, v in cfg.items():
    if k.startswith("_"):
        continue
    shown = v if k in ("redirect_uri", "google_client_id") else ("<set>" if v else "<empty>")
    print(f"  {k:22} {shown}")
