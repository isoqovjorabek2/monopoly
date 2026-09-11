#!/usr/bin/env python3
"""
Tests for the panel's auth logic. Run on the droplet:

    python3 /opt/opspanel/test_auth.py

These cover the parts where a mistake is not a bug but a hole: signature
forgery, expiry, replay of a one-time link, and the allowlist. They use a
throwaway config and never touch the live one.
"""
import json
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import panel  # noqa: E402

FAILED = []


def check(name, cond):
    print(("  ok   " if cond else "  FAIL ") + name)
    if not cond:
        FAILED.append(name)


def use_config(**over):
    cfg = {
        "public_base_url": "https://example.test/admin",
        "allowlist": ["Allowed@Example.com"],
        "session_secret": "test-secret-not-the-real-one",
    }
    cfg.update(over)
    fh = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    json.dump(cfg, fh)
    fh.close()
    panel.CONFIG_PATH = fh.name
    panel._CACHE.clear()
    return fh.name


print("tokens")
use_config()
tok = panel.make_token("session", "allowed@example.com", 60)
check("round trips", panel.read_token(tok, "session") == "allowed@example.com")
check("wrong kind is rejected", panel.read_token(tok, "magic") is None)
check("tampered payload is rejected",
      panel.read_token("x" + tok, "session") is None)
check("stripped signature is rejected",
      panel.read_token(tok.rpartition(".")[0], "session") is None)

# A token signed with a different secret must not validate here.
other = panel.make_token("session", "allowed@example.com", 60)
use_config(session_secret="a-completely-different-secret")
check("token from another secret is rejected",
      panel.read_token(other, "session") is None)

use_config()
check("expired token is rejected",
      panel.read_token(panel.make_token("session", "allowed@example.com", -1),
                       "session") is None)

print("\nsingle use")
panel._SPENT.clear()
magic = panel.make_token("magic", "allowed@example.com", 60)
check("first use works",
      panel.read_token(magic, "magic", single_use=True) == "allowed@example.com")
check("second use is refused",
      panel.read_token(magic, "magic", single_use=True) is None)

print("\nallowlist")
check("listed address allowed", panel.allowed("allowed@example.com"))
check("case and spacing ignored", panel.allowed("  ALLOWED@example.COM  "))
check("unlisted address refused", panel.allowed("someone@else.com") is False)
check("empty refused", panel.allowed("") is False)
check("a valid token for an unlisted address is still refused",
      not panel.allowed(panel.read_token(
          panel.make_token("session", "someone@else.com", 60), "session")))

print("\nmodes and fail-closed")
use_config()
check("no credentials -> no public sign-in methods",
      panel.auth_modes() == {"google": False, "email": False})
use_config(google_client_id="id", google_client_secret="sec")
check("google enabled when both halves present", panel.auth_modes()["google"])
use_config(google_client_id="id")
check("client id without secret does not enable google",
      panel.auth_modes()["google"] is False)
use_config(smtp_host="smtp.test", smtp_from="a@b.c")
check("email enabled when host and from present", panel.auth_modes()["email"])

print("\nredirect uri")
use_config(google_client_id="id", google_client_secret="sec")
check("callback matches what must be registered with google",
      panel.google_redirect_uri() == "https://example.test/admin/auth/google/callback")
url = panel.google_login_url()
check("login url carries a signed state", "state=" in url)
check("login url requests only openid+email",
      "scope=openid+email" in url or "scope=openid%20email" in url)

print("\nmagic link does not leak the allowlist")
# A broken sender is the case that matters: if an allowlisted address
# reported the delivery error and an unknown one reported success, the form
# would confirm membership of the allowlist to anyone who asked.
use_config(smtp_host="127.0.0.1", smtp_port=1, smtp_from="a@b.c")
panel._SENT.clear()
unlisted = panel.send_magic_link("stranger@example.com")
panel._SENT.clear()
listed = panel.send_magic_link("allowed@example.com")
check("allowed and unknown addresses are indistinguishable, even when "
      "sending fails", unlisted == listed)

print()
if FAILED:
    print(f"{len(FAILED)} FAILED: " + ", ".join(FAILED))
    sys.exit(1)
print("all auth checks passed")
