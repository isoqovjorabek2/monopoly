#!/usr/bin/env python3
"""
Tests for player sign-in. Run anywhere with ``cryptography`` installed:

    python3 ops/test_accounts.py

A mistake here is not a bug but a hole - a forged pass is somebody else's
seat - so these cover forgery, tampering, expiry, where a pass may be sent,
and that a pass never carries anything identifying beyond an opaque id. They
use throwaway keys and secrets and never touch the live ones.

It also writes a pass signed by a throwaway key to ``ops/.pass-fixture.json``
when asked (``--fixture``), so the browser-side verifier can be tested
against a signature produced by this exact code rather than by a re-creation
of it.
"""
import json
import os
import sys
import time

from cryptography.hazmat.primitives.asymmetric import ec

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import accounts  # noqa: E402

FAILED = []


def check(name, cond):
    print(("  ok   " if cond else "  FAIL ") + name)
    if not cond:
        FAILED.append(name)


key = ec.generate_private_key(ec.SECP256R1())
other = ec.generate_private_key(ec.SECP256R1())
now = time.time()

print("passes")
token = accounts.mint_pass("u_abc123", "  Asil   Ikramov  the Great Player ", key=key, now=now)
claims = accounts.verify_pass(token, key=key, now=now + 60)
check("a minted pass verifies", claims is not None)
check("it names the player by opaque id", claims and claims["sub"] == "u_abc123")
check("the name is collapsed and capped for the table", claims and claims["name"] == "Asil Ikramov the G")
check("it carries no email", claims and "email" not in claims)
check("it lasts thirty days", claims and claims["exp"] - claims["iat"] == 30 * 24 * 3600)
check("a pass signed by another key is refused", accounts.verify_pass(token, key=other, now=now) is None)
check("an expired pass is refused", accounts.verify_pass(token, key=key, now=now + 31 * 24 * 3600) is None)

head, body, sig = token.split(".")
forged_body = json.loads(accounts.unb64u(body))
forged_body["sub"] = "u_someone_else"
forged = f"{head}.{accounts.b64u(json.dumps(forged_body).encode())}.{sig}"
check("changing the player id breaks the signature", accounts.verify_pass(forged, key=key, now=now) is None)
none_head = accounts.b64u(json.dumps({"alg": "none"}).encode())
check("alg:none is refused", accounts.verify_pass(f"{none_head}.{body}.", key=key, now=now) is None)
check("garbage is refused", accounts.verify_pass("not.a.pass", key=key, now=now) is None)
check("the signature is raw r||s, 64 bytes", len(accounts.unb64u(sig)) == 64)

print("player ids")
a = accounts.player_id("1234567890", secret=b"s1")
check("the same Google account is always the same player", a == accounts.player_id("1234567890", secret=b"s1"))
check("different accounts are different players", a != accounts.player_id("1234567891", secret=b"s1"))
check("the id does not contain the Google id", "1234567890" not in a)
check("ids are u_ plus 20 characters", a.startswith("u_") and len(a) == 22)
check("a different secret gives unrelated ids", a != accounts.player_id("1234567890", secret=b"s2"))

print("state")
ret = "https://aytingchi.uz/"
st = accounts.make_state(ret, secret=b"state", now=now)
check("a state round-trips to its return address", accounts.read_state(st, secret=b"state", now=now + 5) == ret)
check("an expired state is refused", accounts.read_state(st, secret=b"state", now=now + 700) is None)
check("a state signed with another secret is refused", accounts.read_state(st, secret=b"other", now=now) is None)
body, mac = st.rsplit(".", 1)
evil = json.loads(accounts.unb64u(body))
evil["r"] = "https://evil.example/"
tampered = f"{accounts.b64u(json.dumps(evil).encode())}.{mac}"
check("pointing a state somewhere new breaks it", accounts.read_state(tampered, secret=b"state", now=now) is None)
check("no secret configured fails closed", accounts.read_state(st, secret=b"", now=now) is None)

print("return addresses")
for good in [
    "https://aytingchi.uz/",
    "https://www.aytingchi.uz/",
    "https://isoqovjorabek2.github.io/monopoly/",
    "http://localhost:5173/monopoly/",
]:
    check(f"allows {good}", bool(accounts.RETURN_RE.match(good)))
for bad in [
    "https://aytingchi.uz.evil.example/",
    "https://evil.example/https://aytingchi.uz/",
    "https://isoqovjorabek2.github.io/other/",
    "javascript:alert(1)",
    "http://aytingchi.uz/",
    "https://aytingchi.uz/#already-a-fragment",
    "//aytingchi.uz/",
]:
    check(f"refuses {bad}", not accounts.RETURN_RE.match(bad))
blob = json.loads(accounts.unb64u(accounts.profile_blob({
    "name": "Asil  Ikramov", "email": "a@gmail.com", "email_verified": True,
    "picture": "https://lh3.googleusercontent.com/a/x",
})))
check("the profile carries the full name, address and picture",
      blob == {"name": "Asil Ikramov", "email": "a@gmail.com", "picture": "https://lh3.googleusercontent.com/a/x"})
blob = json.loads(accounts.unb64u(accounts.profile_blob({
    "name": "X", "email": "a@gmail.com", "email_verified": False, "picture": "javascript:alert(1)",
})))
check("an unverified address and a non-https picture are dropped", blob["email"] == "" and blob["picture"] == "")
check("the profile rides beside the pass",
      accounts.with_fragment("https://aytingchi.uz/", "auth", "a.b.c", profile="eyJ9") == "https://aytingchi.uz/#auth=a.b.c&profile=eyJ9")
check("the pass rides in the fragment",
      accounts.with_fragment("https://aytingchi.uz/?x=1", "auth", "a.b.c") == "https://aytingchi.uz/?x=1#auth=a.b.c")

if "--fixture" in sys.argv:
    fixture = {
        "jwk": accounts.public_jwk(key),
        "pass": accounts.mint_pass("u_fixture0000000000000", "Fixture", key=key, now=now),
        "otherJwk": accounts.public_jwk(other),
        "mintedAt": int(now),
    }
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "net", "account.fixture.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(fixture, fh, indent=2)
        fh.write("\n")
    print(f"\nwrote {os.path.normpath(path)}")

print()
if FAILED:
    print(f"{len(FAILED)} FAILED")
    sys.exit(1)
print("all account checks passed")
