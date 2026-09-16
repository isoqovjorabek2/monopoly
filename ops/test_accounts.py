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
    "https://partyhall.io/",
    "https://www.partyhall.io/",
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

print("plus")
uidp = "u_plus0000000000000000"
check("nobody has Plus until it is granted", accounts.plus_until(uidp, now=now) == 0)
u1 = accounts.grant_plus(uidp, 30, now=now)
check("thirty days of Plus runs thirty days from now", u1 == int(now) + 30 * 86400)
u2 = accounts.grant_plus(uidp, 30, now=now + 86400)
check("buying again extends from the end, not from today", u2 == u1 + 30 * 86400)
check("Plus is read back", accounts.plus_until(uidp, now=now) == u2)
check("Plus that has run out reads as none", accounts.plus_until(uidp, now=u2 + 1) == 0)
pc = accounts.verify_pass(accounts.mint_pass(uidp, "Plus", key=key, now=now, cnf=bpoint, plus=u2), key=key, now=now)
check("the pass carries the paid-until date", bool(pc) and pc.get("plus") == u2)
check("a pass without Plus carries no plus claim", "plus" not in accounts.verify_pass(asil, key=key, now=now))
check("Plus that already ran out is not stamped into a pass",
      "plus" not in accounts.verify_pass(accounts.mint_pass(uidp, "P", key=key, now=now, plus=int(now) - 5), key=key, now=now))
check("taking the days away ends Plus", accounts.grant_plus(uidp, -1000, now=now) == 0 and accounts.plus_until(uidp, now=now) == 0)
try:
    accounts.grant_plus("not-a-player", 30)
    refused = False
except ValueError:
    refused = True
check("only player ids can be granted Plus", refused)
accounts.grant_plus("u_asil000000000000000", 30)
st_, _ = accounts.put_save("u_asil000000000000000", "SILK-ROAD-7", {"room": room, "members": ["u_asil000000000000000"]})
check("a table with a Plus player at it is kept ninety days",
      st_ == 200 and accounts._read_save("SILK-ROAD-7")["ttl"] == accounts.PLUS_SAVE_TTL)
st_, _ = accounts.put_save("u_bruno00000000000000", "BARE-TABLE-3", {"room": room, "members": ["u_bruno00000000000000"]})
check("a table without one is kept fourteen", st_ == 200 and accounts._read_save("BARE-TABLE-3")["ttl"] == accounts.SAVE_TTL)

print("history")
asil_id = "u_asil000000000000000"
game = {"id": "GOLD-FALCON-42:2", "kind": "monopoly", "won": True, "place": 1, "rounds": 31, "theme": "tashkent",
        "players": [{"name": "Asil", "score": 5200, "you": True}, {"name": "Ada", "score": 0, "bot": True}]}
st_, _ = accounts.record_game(asil_id, game, now=now)
check("a finished game is recorded", st_ == 200)
st_, out = accounts.record_game(asil_id, game, now=now + 5)
check("reporting the same game twice keeps one",
      out.get("duplicate") and accounts.read_history(asil_id, True)["totals"]["played"] == 1)
second = dict(game, id="SILK-ROAD-7:1", kind="cashflow", won=True, place=2,
              players=[{"name": "Asil", "score": 900, "you": True}, {"name": "Bruno", "score": 1400}])
accounts.record_game(asil_id, second, now=now + 10)
h = accounts.read_history(asil_id, True)
check("totals count games and wins", h["totals"]["played"] == 2 and h["totals"]["wins"] == 1)
check("second place is never a win, whatever the report says", h["games"][0]["won"] is False)
check("totals split by game, with the best score",
      h["totals"]["byKind"]["monopoly"] == {"played": 1, "wins": 1, "best": 5200})
check("the newest game comes first", h["games"][0]["id"] == "SILK-ROAD-7:1")
free = accounts.read_history(asil_id, False)
check("without Plus the totals are there but the game list is not", free["totals"]["played"] == 2 and free["games"] == [])
check("a report without exactly one 'you' is refused",
      accounts.record_game(asil_id, dict(game, id="X:1", players=[{"name": "A", "score": 1}]))[0] == 400)
check("a place beyond the table is refused", accounts.record_game(asil_id, dict(game, id="X:2", place=5))[0] == 400)
check("an unknown game is refused", accounts.record_game(asil_id, dict(game, id="X:3", kind="poker"))[0] == 400)
check("a path-like game id is refused", accounts.record_game(asil_id, dict(game, id="../../etc"))[0] == 400)
check("a path-like player id is refused", accounts.record_game("../etc", dict(game, id="X:4"))[0] == 400)
check("names are trimmed for the table",
      accounts.clean_game(dict(game, players=[{"name": "  A   very long player name here ", "score": 1, "you": True}]))
      ["players"][0]["name"] == "A very long player")
for i in range(accounts.HISTORY_KEEP + 5):
    accounts.record_game("u_many0000000000000000", dict(game, id=f"T:{i}"), now=now + i)
check("history keeps only the newest games", len(accounts._read_games("u_many0000000000000000")) == accounts.HISTORY_KEEP)

print("paddle")
import hashlib as _hashlib  # noqa: E402
import hmac as _hmac  # noqa: E402
secret = "pdl_ntfset_test"
pconf = {"paddle_webhook_secret": secret, "paddle_prices": {"pri_month": 31, "pri_year": 366}}


def paddle_sig(raw, ts=None):
    ts = str(int(ts if ts is not None else now))
    return f"ts={ts};h1=" + _hmac.new(secret.encode(), ts.encode() + b":" + raw, _hashlib.sha256).hexdigest()


def paddle_event(eid, etype, data):
    return json.dumps({"event_id": eid, "event_type": etype, "occurred_at": "2026-09-15T00:00:00Z", "data": data}).encode()


buyer = "u_buyer000000000000000"
month = int(now) + 31 * 86400
raw = paddle_event("evt_1", "transaction.completed", {
    "id": "txn_1", "status": "completed", "subscription_id": "sub_1", "origin": "web",
    "custom_data": {"uid": buyer}, "items": [{"price": {"id": "pri_month"}, "quantity": 1}]})
check("a webhook without Paddle's signature is refused", accounts.paddle_webhook("ts=1;h1=00", raw, now=now, config=pconf)[0] == 401)
check("a stale signature is refused", accounts.paddle_webhook(paddle_sig(raw, ts=now - 3600), raw, now=now, config=pconf)[0] == 401)
check("a signature over a different body is refused",
      accounts.paddle_webhook(paddle_sig(raw + b" "), raw, now=now, config=pconf)[0] == 401)
check("with no secret configured, everything is refused", accounts.paddle_webhook(paddle_sig(raw), raw, now=now, config={})[0] == 401)
check("a signature during a secret rotation (two h1) is accepted",
      accounts.paddle_signature_ok(paddle_sig(raw) + ";h1=deadbeef", raw, secret, now=now))
st_, out = accounts.paddle_webhook(paddle_sig(raw), raw, now=now, config=pconf)
check("a completed monthly payment grants 31 days",
      st_ == 200 and out.get("granted") == 31 and accounts.plus_until(buyer, now=now) == month)
st_, out = accounts.paddle_webhook(paddle_sig(raw), raw, now=now, config=pconf)
check("the same event delivered twice grants once", out.get("duplicate") and accounts.plus_until(buyer, now=now) == month)
renewal = paddle_event("evt_2", "transaction.completed", {
    "id": "txn_2", "status": "completed", "subscription_id": "sub_1", "origin": "subscription_recurring",
    "custom_data": None, "items": [{"price": {"id": "pri_month"}}]})
st_, out = accounts.paddle_webhook(paddle_sig(renewal), renewal, now=now, config=pconf)
check("a renewal without custom data still reaches its player",
      out.get("granted") == 31 and accounts.plus_until(buyer, now=now) == month + 31 * 86400)
other = paddle_event("evt_3", "transaction.completed", {
    "id": "txn_3", "custom_data": {"uid": buyer}, "items": [{"price": {"id": "pri_not_plus"}}]})
check("a price that is not Plus grants nothing",
      accounts.paddle_webhook(paddle_sig(other), other, now=now, config=pconf)[1].get("ignored"))
nobody = paddle_event("evt_4", "transaction.completed", {
    "id": "txn_4", "custom_data": {"uid": "../etc"}, "items": [{"price": {"id": "pri_year"}}]})
check("a transaction for no valid player grants nothing",
      accounts.paddle_webhook(paddle_sig(nobody), nobody, now=now, config=pconf)[1].get("ignored"))
pending = paddle_event("evt_5", "adjustment.created", {
    "action": "refund", "status": "pending_approval", "type": "full", "transaction_id": "txn_2"})
accounts.paddle_webhook(paddle_sig(pending), pending, now=now, config=pconf)
check("a refund still pending takes nothing back", accounts.plus_until(buyer, now=now) == month + 31 * 86400)
approved = paddle_event("evt_6", "adjustment.updated", {
    "action": "refund", "status": "approved", "type": "full", "transaction_id": "txn_2"})
st_, out = accounts.paddle_webhook(paddle_sig(approved), approved, now=now, config=pconf)
check("an approved full refund takes back that payment's days",
      out.get("revoked") == 31 and accounts.plus_until(buyer, now=now) == month)
again = paddle_event("evt_7", "adjustment.updated", {
    "action": "refund", "status": "approved", "type": "full", "transaction_id": "txn_2"})
check("a refund is never taken back twice",
      accounts.paddle_webhook(paddle_sig(again), again, now=now, config=pconf)[1].get("ignored")
      and accounts.plus_until(buyer, now=now) == month)
partial = paddle_event("evt_8", "adjustment.updated", {
    "action": "refund", "status": "approved", "type": "partial", "transaction_id": "txn_1"})
check("a partial refund keeps Plus",
      accounts.paddle_webhook(paddle_sig(partial), partial, now=now, config=pconf)[1].get("ignored")
      and accounts.plus_until(buyer, now=now) == month)

if "--fixture" in sys.argv:
    fixture = {
        "jwk": accounts.public_jwk(key),
        "pass": accounts.mint_pass("u_fixture0000000000000", "Fixture", key=key, now=now, cnf=point),
        "point": dict(zip("xy", point.split("."))),
        "plusPass": accounts.mint_pass("u_fixture0000000000000", "Fixture", key=key, now=now, cnf=point,
                                       plus=int(now) + 30 * 86400),
        "plusUntil": int(now) + 30 * 86400,
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
