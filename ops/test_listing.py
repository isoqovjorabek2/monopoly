#!/usr/bin/env python3
"""
Tests for who may open a public room: only a Party Hall Plus host, for any
game. Run anywhere with ``cryptography`` installed:

    python3 ops/test_listing.py

A mistake here is a hole rather than a bug - a free account (or a host
replaying a Plus guest's pass) getting onto the public list - so each way a
listing can be forged is tried against the real check.
"""
import base64
import json
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lobbies  # noqa: E402
from cryptography.hazmat.primitives import hashes  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature  # noqa: E402

FAILED = []
lobbies.STATE_DIR = tempfile.mkdtemp(prefix="listing-test-")


def check(name, cond):
    print(("  ok   " if cond else "  FAIL ") + name)
    if not cond:
        FAILED.append(name)


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def sign(key, message: bytes) -> str:
    r, s = decode_dss_signature(key.sign(message, ec.ECDSA(hashes.SHA256())))
    return b64u(r.to_bytes(32, "big") + s.to_bytes(32, "big"))


def point(key) -> dict:
    n = key.public_key().public_numbers()
    return {"x": b64u(n.x.to_bytes(32, "big")), "y": b64u(n.y.to_bytes(32, "big"))}


ISSUER_KEY = ec.generate_private_key(ec.SECP256R1())
DEVICE = ec.generate_private_key(ec.SECP256R1())
NOW = time.time()
ROOM = "GOLD-FALCON-42"


def make_pass(plus=NOW + 86400, device=DEVICE, issuer=ISSUER_KEY, **over):
    claims = {"iss": "https://partyhall.io/auth", "aud": "monopoly", "sub": "u_test",
              "name": "Tester", "iat": int(NOW), "exp": int(NOW + 3600), "cnf": point(device)}
    if plus:
        claims["plus"] = int(plus)
    claims.update(over)
    head = b64u(json.dumps({"alg": "ES256", "typ": "JWT"}).encode())
    body = b64u(json.dumps(claims).encode())
    return f"{head}.{body}.{sign(issuer, f'{head}.{body}'.encode())}"


def announce(token, room=ROOM, device=DEVICE, ts=None):
    ts = str(int(NOW if ts is None else ts))
    return {"pass": token, "ts": ts, "proof": sign(device, lobbies.list_proof_message(room, ts).encode())}


def ok(body, room=ROOM):
    return lobbies.plus_host(body, room, now=NOW, pass_key=ISSUER_KEY.public_key()) is not None


print("lobbies: public rooms need Plus")
check("a Plus host with a fresh proof may list", ok(announce(make_pass())))
check("no pass at all is refused", not ok({}))
check("a pass without Plus is refused", not ok(announce(make_pass(plus=0))))
check("a pass whose Plus has run out is refused", not ok(announce(make_pass(plus=NOW - 60))))
check("an expired pass is refused", not ok(announce(make_pass(exp=int(NOW - 1)))))
check("a pass for another audience is refused", not ok(announce(make_pass(aud="other"))))
check("a pass from an unknown issuer is refused", not ok(announce(make_pass(iss="https://evil.example/auth"))))
check("a pass signed by some other key is refused",
      not ok(announce(make_pass(issuer=ec.generate_private_key(ec.SECP256R1())))))

# A host sees every guest's pass. Holding one must not let them list with it.
thief = ec.generate_private_key(ec.SECP256R1())
check("a Plus guest's pass replayed with another key is refused",
      not ok(announce(make_pass(), device=thief)))
check("a proof for a different room is refused",
      not ok(announce(make_pass(), room="SILK-ROAD-7"), room=ROOM))
check("a stale proof is refused", not ok(announce(make_pass(), ts=NOW - 3600)))
body = announce(make_pass())
body["proof"] = "A" * 86
check("a garbage proof is refused", not ok(body))
check("a garbage pass is refused", not ok({**announce(make_pass()), "pass": "a.b.c"}))

saved = lobbies.ec
lobbies.ec = None
check("without cryptography nothing new is listed", not ok(announce(make_pass())))
lobbies.ec = saved

print("lobbies: listed rooms carry their game")
lobbies._rooms.clear()
lobbies._rooms[ROOM] = {"id": ROOM, "kind": "mafia", "host": "Tester", "seats": 3, "maxSeats": 8,
                        "preset": "classic", "deviations": 0, "ip": "1.2.3.4",
                        "seen": time.time(), "opened": time.time()}
rooms = lobbies.live_rooms()
check("the list names each room's game", rooms and rooms[0]["kind"] == "mafia")
lobbies._rooms[ROOM].pop("kind")
check("a room without a kind is Monopoly", lobbies.live_rooms()[0]["kind"] == "monopoly")
check("the host's account id never reaches the list", "uid" not in lobbies.live_rooms()[0])

print("lobbies: the front door's head count")
lobbies._tables.clear()
now = time.time()
lobbies._tables["A"] = {"seen": now, "players": [
    {"bot": False, "connected": True}, {"bot": True, "connected": True}, {"bot": False, "connected": False}]}
lobbies._tables["B"] = {"seen": now, "players": [{"bot": False, "connected": True}]}
lobbies._tables["C"] = {"seen": now - 3600, "players": [{"bot": False, "connected": True}]}
check("counts connected humans at live tables only", lobbies.playing_now() == 2)
report = lobbies.clean_report({"kind": "mafia", "mode": "private", "phase": "playing", "maxSeats": 12,
                               "players": [{"id": f"p{i}", "name": f"P{i}", "bot": i > 0} for i in range(12)]})
check("an Omertà table's report is taken, all twelve seats of it",
      report is not None and len(report["players"]) == 12 and report["maxSeats"] == 12)

if FAILED:
    print(f"\n{len(FAILED)} failed")
    sys.exit(1)
print("\nall passed")
