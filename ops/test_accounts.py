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
pub = ec.generate_private_key(ec.SECP256R1()).public_key().public_numbers()
point = f"{accounts.b64u(pub.x.to_bytes(32, 'big'))}.{accounts.b64u(pub.y.to_bytes(32, 'big'))}"
st = accounts.make_state(ret, point, secret=b"state", now=now)
check("a state round-trips to its return address and browser key",
      accounts.read_state(st, secret=b"state", now=now + 5) == (ret, point))
check("an expired state is refused", accounts.read_state(st, secret=b"state", now=now + 700) is None)
check("a state signed with another secret is refused", accounts.read_state(st, secret=b"other", now=now) is None)
body, mac = st.rsplit(".", 1)
evil = json.loads(accounts.unb64u(body))
evil["r"] = "https://evil.example/"
tampered = f"{accounts.b64u(json.dumps(evil).encode())}.{mac}"
check("pointing a state somewhere new breaks it", accounts.read_state(tampered, secret=b"state", now=now) is None)
check("no secret configured fails closed", accounts.read_state(st, secret=b"", now=now) is None)

print("browser keys")
check("a real P-256 point is accepted", accounts.point_ok(point))
check("a well-shaped point that is not on the curve is refused", not accounts.point_ok("A" * 43 + "." + "B" * 43))
check("a malformed point is refused", not accounts.point_ok("nope"))
bound = accounts.verify_pass(accounts.mint_pass("u_abc123", "A", key=key, now=now, cnf=point), key=key, now=now)
check("a pass names the browser key it was issued to", bound and bound["cnf"] == dict(zip("xy", point.split("."))))

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

print("saved tables")
import tempfile  # noqa: E402
from cryptography.hazmat.primitives import hashes  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature  # noqa: E402

accounts.STATE_DIR = tempfile.mkdtemp()
browser = ec.generate_private_key(ec.SECP256R1())
bn = browser.public_key().public_numbers()
bpoint = f"{accounts.b64u(bn.x.to_bytes(32, 'big'))}.{accounts.b64u(bn.y.to_bytes(32, 'big'))}"
asil = accounts.mint_pass("u_asil000000000000000", "Asil", key=key, now=now, cnf=bpoint)


def signed(method, path, body=b"", pass_=asil, signer=browser, ts=None):
    ts = str(int(ts if ts is not None else now))
    der = signer.sign(accounts.request_proof_message(method, path, ts, body).encode(), ec.ECDSA(hashes.SHA256()))
    r, s_ = decode_dss_signature(der)
    return {"X-Pass": pass_, "X-Proof": accounts.b64u(r.to_bytes(32, "big") + s_.to_bytes(32, "big")),
            "X-Proof-Time": ts}


body = json.dumps({"room": {"epoch": 0, "game": {"phase": "preroll"}}}).encode()
check("a request signed by the pass's own browser is accepted",
      accounts.check_request(signed("PUT", "/saves/GOLD-FALCON-42", body), "PUT", "/saves/GOLD-FALCON-42", body,
                             key=key, now=now) is not None)
thief = ec.generate_private_key(ec.SECP256R1())
check("the same pass signed by any other browser is refused",
      accounts.check_request(signed("PUT", "/saves/GOLD-FALCON-42", body, signer=thief),
                             "PUT", "/saves/GOLD-FALCON-42", body, key=key, now=now) is None)
check("a signature over a different body is refused",
      accounts.check_request(signed("PUT", "/saves/GOLD-FALCON-42", b"{}"), "PUT", "/saves/GOLD-FALCON-42", body,
                             key=key, now=now) is None)
check("a signature for a different table is refused",
      accounts.check_request(signed("PUT", "/saves/OTHER-TABLE-1", body), "PUT", "/saves/GOLD-FALCON-42", body,
                             key=key, now=now) is None)
check("a stale signature is refused",
      accounts.check_request(signed("PUT", "/saves/GOLD-FALCON-42", body, ts=now - 900),
                             "PUT", "/saves/GOLD-FALCON-42", body, key=key, now=now) is None)
unbound = accounts.mint_pass("u_asil000000000000000", "Asil", key=key, now=now)
check("a pass with no browser key cannot save",
      accounts.check_request(signed("GET", "/saves", pass_=unbound), "GET", "/saves", b"", key=key, now=now) is None)

room = {"epoch": 2, "game": {"phase": "preroll"}}
st_, _ = accounts.put_save("u_asil000000000000000", "GOLD-FALCON-42",
                           {"room": room, "members": ["u_asil000000000000000", "u_bruno00000000000000"],
                            "summary": {"kind": "monopoly", "round": 7, "names": ["Asil", "Bruno"]}})
check("a player at the table can save it", st_ == 200)
check("both players at it see it in their list",
      [s["code"] for s in accounts.list_saves("u_bruno00000000000000")] == ["GOLD-FALCON-42"])
check("a stranger does not", accounts.list_saves("u_stranger0000000000") == [])
st_, _ = accounts.put_save("u_stranger0000000000", "GOLD-FALCON-42",
                           {"room": room, "members": ["u_stranger0000000000"]})
check("a stranger cannot overwrite somebody else's table with the same code", st_ == 403)
st_, _ = accounts.put_save("u_asil000000000000000", "GOLD-FALCON-42", {"room": room, "members": ["u_bruno00000000000000"]})
check("nobody can save a table they are not listed at", st_ == 403)
accounts.forget_save("u_bruno00000000000000", "GOLD-FALCON-42")
check("forgetting a table takes it off only that player's list",
      accounts.list_saves("u_bruno00000000000000") == [] and len(accounts.list_saves("u_asil000000000000000")) == 1)
st_, out = accounts.put_save("u_asil000000000000000", "GOLD-FALCON-42",
                             {"room": {"game": {"phase": "game_over"}}, "members": ["u_asil000000000000000"]})
check("a finished game is deleted, not kept", out.get("deleted") and accounts.list_saves("u_asil000000000000000") == [])
check("a malformed code is refused", accounts.put_save("u_asil000000000000000", "../../etc", {"room": {}, "members": ["u_asil000000000000000"]})[0] == 400)

if "--fixture" in sys.argv:
    fixture = {
        "jwk": accounts.public_jwk(key),
        "pass": accounts.mint_pass("u_fixture0000000000000", "Fixture", key=key, now=now, cnf=point),
        "point": dict(zip("xy", point.split("."))),
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
