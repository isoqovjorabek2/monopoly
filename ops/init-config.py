#!/usr/bin/env python3
"""
Creates /etc/opspanel/config.json if it is not already there.

Run on the droplet. The session secret is generated here, on the machine that
will use it, so it never travels. The OAuth and SMTP fields are left blank for
you to fill in by hand — those are your credentials, and they should reach the
server from you, not through anything else.

Re-running is safe: an existing config is left completely alone.
"""
import json
import os
import secrets

PATH = "/etc/opspanel/config.json"

TEMPLATE = {
    "_comment": "Secrets for the status panel. Root-owned, 0640, never in git.",
    "public_base_url": "https://aytingchi.uz/admin",
    "allowlist": ["isoqovjorabek774@gmail.com"],
    "session_secret": "",

    "_google": ("Google Cloud Console > APIs & Services > Credentials > "
                "Create OAuth client ID > Web application. Authorised redirect "
                "URI must be exactly: https://aytingchi.uz/admin/auth/google/callback"),
    "google_client_id": "",
    "google_client_secret": "",

    "_smtp": ("Any SMTP sender. For Gmail: smtp.gmail.com / 587 / your address / "
              "an App Password (not your account password). Leave blank to turn "
              "magic-link sign-in off."),
    "smtp_host": "",
    "smtp_port": 587,
    "smtp_user": "",
    "smtp_password": "",
    "smtp_from": "",
}

if os.path.exists(PATH):
    print(f"{PATH} already exists — leaving it untouched.")
else:
    cfg = dict(TEMPLATE)
    cfg["session_secret"] = secrets.token_urlsafe(48)
    os.makedirs(os.path.dirname(PATH), exist_ok=True)
    with open(PATH, "w") as fh:
        json.dump(cfg, fh, indent=2)
        fh.write("\n")
    os.chmod(PATH, 0o640)
    print(f"wrote {PATH} with a fresh session secret")

with open(PATH) as fh:
    live = json.load(fh)
SECRET_KEYS = {"session_secret", "google_client_secret", "smtp_password"}
print("\ncurrent settings:")
for k, v in live.items():
    if k.startswith("_"):
        continue
    if k in SECRET_KEYS:
        print(f"  {k:22} {'<set>' if v else '<empty>'}")
    else:
        print(f"  {k:22} {v!r}")

modes = []
if live.get("google_client_id") and live.get("google_client_secret"):
    modes.append("google")
if live.get("smtp_host") and live.get("smtp_from"):
    modes.append("email magic link")
print("\npublic sign-in methods enabled: " + (", ".join(modes) if modes else
      "NONE — the public route will refuse to serve until one is configured"))
