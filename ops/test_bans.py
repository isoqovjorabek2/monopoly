#!/usr/bin/env python3
"""
Tests for the ban list the panel writes and the other two services enforce.
Run on the droplet:

    python3 /opt/opspanel/test_bans.py

They cover the parts where a mistake is a hole rather than a bug: a ban that
does not match what it should, or matches what it should not (a guest's name
is never an identity; an unreadable bans file must open the door, not lock
everyone out). Everything runs against a throwaway state directory.
"""
import json
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lobbies  # noqa: E402
import panel    # noqa: E402

try:
    import accounts
except ImportError:
    accounts = None  # needs the cryptography package; present on the droplet

FAILED = []
STATE = tempfile.mkdtemp(prefix="bans-test-")


def check(name, cond):
    print(("  ok   " if cond else "  FAIL ") + name)
    if not cond:
        FAILED.append(name)


def write_raw(data):
    with open(os.path.join(STATE, "bans.json"), "w", encoding="utf-8") as fh:
        json.dump(data, fh)
    # Every reader caches; tests move faster than the caches.
    lobbies._bans_cache = (0.0, {})
    if accounts:
        accounts._bans_cache = (0.0, frozenset())


# All three services read the one file.
lobbies.STATE_DIR = STATE
panel.BANS_PATH = os.path.join(STATE, "bans.json")
if accounts:
    accounts.BANS_PATH = panel.BANS_PATH

print("panel: add_ban validation")
panel._CACHE.clear()
code, out = panel.add_ban({"kind": "account", "id": "not-a-uid", "name": "X"}, "tester")
check("account ban without a u_ id is refused", code == 400)
code, out = panel.add_ban({"kind": "name", "name": "  "}, "tester")
check("name ban without a name is refused", code == 400)
code, out = panel.add_ban({"kind": "fish", "id": "u_abc"}, "tester")
check("an unknown kind is refused", code == 400)
code, out = panel.add_ban({"kind": "account", "id": "u_abc123", "name": "Asil",
                           "reason": "spamming public rooms"}, "tester")
check("a valid account ban is taken", code == 200 and out["ok"])
code, out = panel.add_ban({"kind": "name", "name": "BadActor"}, "tester")
check("a valid name ban is taken", code == 200)
bans = {b["id"]: b for b in out["bans"]}
check("the name ban is stored lowercased for matching", "badactor" in bans)
check("the account ban keeps the display name", bans["u_abc123"]["name"] == "Asil")
check("who banned is recorded", bans["u_abc123"]["by"] == "tester")
code, out = panel.add_ban({"kind": "account", "id": "u_abc123", "name": "Asil",
                           "reason": "second thoughts"}, "tester")
check("banning the same account again replaces, not duplicates",
      sum(1 for b in out["bans"] if b["id"] == "u_abc123") == 1)
check("the replacement holds the new reason", out["bans"][-1]["reason"] == "second thoughts")

print("\npanel: unban and room closing")
code, out = panel.remove_ban({"kind": "name", "id": "BADACTOR"})
check("unban matches case-insensitively", code == 200
      and all(b.get("id") != "badactor" for b in out["bans"]))
code, _ = panel.remove_ban({"kind": "name", "id": "nobody"})
check("unbanning what was never banned is a 404", code == 404)
code, out = panel.set_room_closed({"id": "gold-falcon-42"}, True)
check("closing accepts any-case room codes", code == 200 and "GOLD-FALCON-42" in out["closed"])
code, _ = panel.set_room_closed({"id": "not a room"}, True)
check("closing a non-code is refused", code == 400)
code, _ = panel.set_room_closed({"id": "GOLD-FALCON-42"}, False)
check("reopening works", code == 200)
code, _ = panel.set_room_closed({"id": "GOLD-FALCON-42"}, False)
check("reopening an open room is a 404", code == 404)

print("\npanel: the file on disk")
with open(panel.BANS_PATH, encoding="utf-8") as fh:
    on_disk = json.load(fh)
check("what the panel wrote is what the services will read",
      any(b.get("id") == "u_abc123" for b in on_disk["bans"]))

print("\nlobbies: matching")
write_raw({"bans": [
    {"kind": "account", "id": "u_abc123", "name": "Asil"},
    {"kind": "name", "id": "badactor", "name": "BadActor"},
], "closed": {"GOLD-FALCON-42": time.time(), "OLD-ROOM-9": time.time() - 25 * 3600}})
check("account ban matches", lobbies.account_banned("u_abc123"))
check("another account is not banned", not lobbies.account_banned("u_other"))
check("name ban matches any case", lobbies.name_banned("  BadActor "))
check("another name is not banned", not lobbies.name_banned("asil"))
check("empty name is never banned", not lobbies.name_banned(""))
check("a closed room is closed", lobbies.room_closed("GOLD-FALCON-42"))
check("a day-old close has lapsed", not lobbies.room_closed("OLD-ROOM-9"))
check("another room is open", not lobbies.room_closed("SOME-ROOM-1"))

print("\nlobbies: what a reporting table is told")
report = {
    "kind": "monopoly", "mode": "public", "phase": "playing", "round": 3,
    "turn": None, "winner": None, "maxSeats": 4, "epoch": 0,
    "device": "desktop", "lang": "en",
    "players": [
        {"id": "u_host", "name": "Host", "color": "#111111", "token": "t",
         "bot": False, "host": True, "connected": True, "cash": 1, "worth": 1, "out": False, "track": ""},
        {"id": "u_abc123", "name": "Asil", "color": "#222222", "token": "t",
         "bot": False, "host": False, "connected": True, "cash": 1, "worth": 1, "out": False, "track": ""},
        {"id": "p_guest", "name": "badactor", "color": "#333333", "token": "t",
         "bot": False, "host": False, "connected": True, "cash": 1, "worth": 1, "out": False, "track": ""},
        {"id": "bot_1", "name": "Bot", "color": "#444444", "token": "t",
         "bot": True, "host": False, "connected": True, "cash": 1, "worth": 1, "out": False, "track": ""},
    ],
}
note = lobbies.moderation_for("SOME-ROOM-1", report)
check("a banned account seated is named", note.get("bannedSeats") == ["u_abc123"])
check("a guest's matching *name* is never a kick - names are claimed, not owned",
      "p_guest" not in note.get("bannedSeats", []))
check("bots are never named", "bot_1" not in note.get("bannedSeats", []))
check("an unbanned host is not flagged", "banned" not in note)
check("an open room is not closed", "close" not in note)

note = lobbies.moderation_for("GOLD-FALCON-42", report)
check("a closed room is told to close", note.get("close") is True)

banned_host = dict(report, players=[dict(p) for p in report["players"]])
banned_host["players"][0]["name"] = "BadActor"
note = lobbies.moderation_for("SOME-ROOM-1", banned_host)
check("a name-banned host is told", note.get("banned") is True)

banned_host["players"][0]["name"] = "Host"
banned_host["players"][0]["id"] = "u_abc123"
note = lobbies.moderation_for("SOME-ROOM-1", banned_host)
check("an account-banned host is told, and is their own banned seat",
      note.get("banned") is True and "u_abc123" in note.get("bannedSeats", []))

print("\nlobbies: a missing file means no bans, never an outage")
write_raw({})
os.remove(panel.BANS_PATH)
write_raw_called = False
lobbies._bans_cache = (0.0, {})
check("nothing banned with no file", not lobbies.account_banned("u_abc123"))
check("no name banned with no file", not lobbies.name_banned("badactor"))
check("no room closed with no file", not lobbies.room_closed("GOLD-FALCON-42"))
with open(panel.BANS_PATH, "w", encoding="utf-8") as fh:
    fh.write("{not json")
lobbies._bans_cache = (0.0, {})
check("a corrupt file fails open too", not lobbies.account_banned("u_abc123"))
check("a corrupt file still answers the panel empty", panel.read_bans() == {"bans": [], "closed": {}})

if accounts:
    print("\naccounts: the same file refuses passes")
    write_raw({"bans": [
        {"kind": "account", "id": "u_abc123", "name": "Asil"},
        {"kind": "name", "id": "badactor", "name": "BadActor"},
    ], "closed": {}})
    check("a banned account is refused", accounts.banned_uid("u_abc123"))
    check("another account is fine", not accounts.banned_uid("u_other"))
    check("a name ban is not an account ban", not accounts.banned_uid("badactor"))
    os.remove(panel.BANS_PATH)
    accounts._bans_cache = (0.0, frozenset())
    check("a missing file refuses nobody", not accounts.banned_uid("u_abc123"))
else:
    print("\naccounts: skipped (the cryptography package is not installed here)")

print()
if FAILED:
    print(f"{len(FAILED)} FAILED: " + ", ".join(FAILED))
    sys.exit(1)
print("all ban checks passed")
