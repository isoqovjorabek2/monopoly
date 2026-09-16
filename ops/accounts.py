#!/usr/bin/env python3
"""
Player accounts: "Sign in with Google" for the game, and nothing else.

The game has no game server. A table lives in its host's browser, and every
other player connects straight to that tab. So an account here cannot be a
session the server checks on every move - there is no server on that path.
It is a *pass* instead: a short signed statement, "this browser belongs to
player u_xxxx, called Asil, until such-and-such a date".

The pass is signed with an ECDSA P-256 key that never leaves this machine.
The matching public key is compiled into the game, so the host's browser
checks a pass itself, offline, with WebCrypto - the same way it already
refuses a forged trade. A player who presents a valid pass gets their seat
back from any device, and may take over a bot's seat in a game that has
already started. A guest without one plays exactly as before.

What the pass says, and what it deliberately does not:

- ``sub`` is an opaque id derived from Google's account id with a keyed hash.
  It is stable (the same Google account is always the same player) but it
  is not the Google id, and it is not an email address. Passes travel to
  other players' browsers, and nobody at a table needs anyone's email.
- ``name`` is Google's display name, trimmed. The player can change what the
  table calls them in the game as always; this is only the default.
- ``cnf`` is the public half of a key the player's browser made and cannot
  export. A pass is shown to every host a player joins, so on its own it
  would let a dishonest host sit down elsewhere as them; with ``cnf``, a host
  also asks the browser to sign a fresh challenge, which a copied pass cannot.

Routes, behind nginx at /auth/:

    GET /google/start?return=URL&dpk=X.Y  -> 302 to Google
    GET /google/callback           -> 302 back to URL#auth=<pass>
    GET /key                       -> the public key, as a JWK
    GET /health

    POST   /refresh                -> a fresh pass, carrying the player's Plus status
    POST   /history                -> record a game the caller finished
    GET    /history                -> the caller's totals, and their games with Plus
    POST   /paddle/webhook         -> Paddle payment events: grants and refunds Plus

    GET    /saves                  -> the caller's saved tables (summaries)
    GET    /saves/<code>           -> one saved table, if the caller sat at it
    PUT    /saves/<code>           -> save a table the caller sits at
    DELETE /saves/<code>           -> take a table off the caller's list

Saves exist so a game survives everybody leaving: a table lives in its
host's browser, and without a copy somewhere else, closing the last tab
ended it. Every save request carries the caller's pass *and* a signature over
the request from the browser key the pass names, so a pass shown to a host
cannot be used to read or overwrite anyone's games. What is saved is the copy
every guest already holds - no dice seed, no card order - and a resumed table
deals fresh ones, so a save is never a way to see the future.

Binds 127.0.0.1. Python 3 standard library plus ``cryptography``, which is
already on the droplet because certbot depends on it.

Operator commands (run as root on the droplet):

    python3 accounts.py pubkey              print the public JWK
    python3 accounts.py mint <sub> <name> <x.y>   issue a pass bound to that
                                                 browser key, for testing
    python3 accounts.py plus <sub>          show a player's Plus
    python3 accounts.py plus <sub> <days> [note]  add days of Plus (negative
                                                 takes days away)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import (
    decode_dss_signature, encode_dss_signature,
)

HOST, PORT = "127.0.0.1", int(os.environ.get("ACCOUNTS_PORT", "9200"))
STATE_DIR = os.environ.get("ACCOUNTS_STATE", "/var/lib/playerauth")
CONFIG_PATH = os.environ.get("ACCOUNTS_CONFIG", "/etc/playerauth/config.json")
KEY_PATH = os.environ.get("ACCOUNTS_KEY", "/etc/playerauth/signing-key.pem")

ISSUER = "https://aytingchi.uz/auth"
AUDIENCE = "monopoly"
PASS_TTL = 30 * 24 * 3600      # a month; signing in again is one click
STATE_TTL = 600                # the round trip through Google
NAME_MAX = 18                  # what the game allows at the table

GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"

# A browser's public key point, base64url x and y of a P-256 key.
POINT_RE = re.compile(r"^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$")

# Where a pass may be sent back to. Anything else could be a page that
# collects passes, so it is refused before Google is ever involved.
RETURN_RE = re.compile(
    r"^(https://(aytingchi\.uz|www\.aytingchi\.uz|partyhall\.io|www\.partyhall\.io)/"
    r"|https://isoqovjorabek2\.github\.io/monopoly/"
    r"|http://(localhost|127\.0\.0\.1)(:\d{2,5})?/)"
    r"[^#\s]*$"
)


# ------------------------------------------------------------------ config --

_cfg_cache: tuple[float, dict] = (0.0, {})


def cfg() -> dict:
    global _cfg_cache
    at, data = _cfg_cache
    if time.time() - at < 10:
        return data
    try:
        with open(CONFIG_PATH, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        data = {}
    _cfg_cache = (time.time(), data)
    return data


def redirect_uri() -> str:
    return cfg().get("redirect_uri", "https://partyhall.io/auth/google/callback")


_key: ec.EllipticCurvePrivateKey | None = None


def signing_key() -> ec.EllipticCurvePrivateKey:
    global _key
    if _key is None:
        with open(KEY_PATH, "rb") as fh:
            loaded = serialization.load_pem_private_key(fh.read(), password=None)
        if not isinstance(loaded, ec.EllipticCurvePrivateKey) or loaded.curve.name != "secp256r1":
            raise RuntimeError("signing key must be an EC P-256 private key")
        _key = loaded
    return _key


# ----------------------------------------------------------------- base64 --

def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def unb64u(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


# ------------------------------------------------------------------ passes --

def public_jwk(key: ec.EllipticCurvePrivateKey | None = None) -> dict:
    nums = (key or signing_key()).public_key().public_numbers()
    return {
        "kty": "EC", "crv": "P-256",
        "x": b64u(nums.x.to_bytes(32, "big")),
        "y": b64u(nums.y.to_bytes(32, "big")),
        "alg": "ES256", "use": "sig",
    }


def point_ok(point: str) -> bool:
    """A real point on P-256, not just the right shape - so a pass can never
    name a key nobody could hold."""
    if not isinstance(point, str) or not POINT_RE.match(point):
        return False
    x, y = point.split(".")
    try:
        ec.EllipticCurvePublicNumbers(
            int.from_bytes(unb64u(x), "big"), int.from_bytes(unb64u(y), "big"), ec.SECP256R1(),
        ).public_key()
    except ValueError:
        return False
    return True


def mint_pass(sub: str, name: str, key: ec.EllipticCurvePrivateKey | None = None,
              now: float | None = None, cnf: str | None = None, plus: int = 0) -> str:
    """A compact JWS (ES256). The signature is raw r||s, as JWS and WebCrypto
    both expect - not the DER that ``cryptography`` produces by default."""
    now = int(now if now is not None else time.time())
    header = {"alg": "ES256", "typ": "JWT"}
    payload = {
        "iss": ISSUER, "aud": AUDIENCE, "sub": sub,
        "name": clean_name(name), "iat": now, "exp": now + PASS_TTL,
    }
    if cnf:
        x, y = cnf.split(".")
        payload["cnf"] = {"x": x, "y": y}
    # Party Hall Plus, as a paid-until date. Only stamped while it is still
    # running, so a host can trust it without asking this server anything.
    if plus and int(plus) > now:
        payload["plus"] = int(plus)
    signing_input = f"{b64u(json.dumps(header, separators=(',', ':')).encode())}." \
                    f"{b64u(json.dumps(payload, separators=(',', ':')).encode())}"
    der = (key or signing_key()).sign(signing_input.encode(), ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    return f"{signing_input}.{b64u(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"


def verify_pass(token: str, key: ec.EllipticCurvePrivateKey | None = None,
                now: float | None = None) -> dict | None:
    """The server never needs this on a request path; it exists so the tests
    can hold the minted pass to the same rules the browser applies."""
    try:
        head, body, sig = token.split(".")
        raw = unb64u(sig)
        if len(raw) != 64:
            return None
        der = encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
        (key or signing_key()).public_key().verify(der, f"{head}.{body}".encode(), ec.ECDSA(hashes.SHA256()))
        if json.loads(unb64u(head)).get("alg") != "ES256":
            return None
        claims = json.loads(unb64u(body))
    except Exception:  # noqa: BLE001 - any failure is simply "not a pass"
        return None
    t = now if now is not None else time.time()
    if claims.get("iss") != ISSUER or claims.get("aud") != AUDIENCE:
        return None
    if not isinstance(claims.get("exp"), int) or claims["exp"] <= t:
        return None
    if not isinstance(claims.get("sub"), str) or not claims["sub"].startswith("u_"):
        return None
    return claims


def clean_name(name: str) -> str:
    name = re.sub(r"\s+", " ", str(name or "")).strip()
    return name[:NAME_MAX] or "Player"


def player_id(provider_sub: str, secret: bytes | None = None) -> str:
    """Stable, opaque, and not reversible to the Google account id."""
    key = secret if secret is not None else str(cfg().get("uid_secret", "")).encode()
    if not key:
        raise RuntimeError("uid_secret is not configured")
    digest = hmac.new(key, f"google:{provider_sub}".encode(), hashlib.sha256).digest()
    return "u_" + base64.b32encode(digest).decode().lower().rstrip("=")[:20]


# ------------------------------------------------------------------- state --
# The OAuth state is a signed, expiring note of where to send the pass. A
# callback that did not begin here - or that was pointed somewhere new on
# the way - fails the signature.

def make_state(return_to: str, point: str = "", secret: bytes | None = None,
               now: float | None = None) -> str:
    key = secret if secret is not None else str(cfg().get("state_secret", "")).encode()
    body = b64u(json.dumps({
        "r": return_to, "k": point, "x": int((now if now is not None else time.time()) + STATE_TTL),
        "n": secrets.token_urlsafe(8),
    }, separators=(",", ":")).encode())
    mac = hmac.new(key, body.encode(), hashlib.sha256).hexdigest()[:40]
    return f"{body}.{mac}"


def read_state(state: str, secret: bytes | None = None,
               now: float | None = None) -> tuple[str, str] | None:
    """(return address, browser key point), or None."""
    key = secret if secret is not None else str(cfg().get("state_secret", "")).encode()
    if not key or not isinstance(state, str) or "." not in state:
        return None
    body, mac = state.rsplit(".", 1)
    want = hmac.new(key, body.encode(), hashlib.sha256).hexdigest()[:40]
    if not hmac.compare_digest(mac, want):
        return None
    try:
        data = json.loads(unb64u(body))
    except ValueError:
        return None
    if data.get("x", 0) < (now if now is not None else time.time()):
        return None
    r, k = data.get("r"), data.get("k", "")
    if not isinstance(r, str) or not RETURN_RE.match(r):
        return None
    return r, (k if isinstance(k, str) else "")


# ------------------------------------------------------------------ google --

def google_login_url(state: str) -> str:
    return GOOGLE_AUTH + "?" + urllib.parse.urlencode({
        "client_id": cfg().get("google_client_id", ""),
        "redirect_uri": redirect_uri(),
        "response_type": "code",
        "scope": "openid profile email",
        "state": state,
        "prompt": "select_account",
    })


def google_exchange(code: str) -> dict | None:
    """Swap the code for an id_token. It comes straight from Google's token
    endpoint over TLS in answer to a request carrying our client secret, which
    Google documents as sufficient to trust its claims without re-verifying
    the signature - but the claims are still checked."""
    c = cfg()
    body = urllib.parse.urlencode({
        "code": code,
        "client_id": c.get("google_client_id", ""),
        "client_secret": c.get("google_client_secret", ""),
        "redirect_uri": redirect_uri(),
        "grant_type": "authorization_code",
    }).encode()
    try:
        req = urllib.request.Request(
            GOOGLE_TOKEN, data=body, method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        with urllib.request.urlopen(req, timeout=10) as res:
            token = json.load(res).get("id_token", "")
        claims = json.loads(unb64u(token.split(".")[1]))
    except Exception as exc:  # noqa: BLE001
        print(f"google exchange failed: {exc}", file=sys.stderr, flush=True)
        return None
    if claims.get("aud") != c.get("google_client_id"):
        return None
    if claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        return None
    if int(claims.get("exp", 0)) < time.time():
        return None
    if not claims.get("sub"):
        return None
    return claims


# -------------------------------------------------------------------- plus --
# Party Hall Plus. This server is the only place that decides who has it: a
# player's paid-until date lives here and is stamped into every pass it signs,
# so a host believes a Plus seat the same way it believes the seat itself.

def plus_path() -> str:
    os.makedirs(STATE_DIR, exist_ok=True)
    return os.path.join(STATE_DIR, "plus.json")


def _plus_all() -> dict:
    try:
        with open(plus_path(), encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def plus_until(uid: str, now: float | None = None) -> int:
    """When the player's Plus runs out, in seconds since the epoch; 0 without it."""
    rec = _plus_all().get(uid)
    until = int(rec.get("until", 0)) if isinstance(rec, dict) else 0
    return until if until > (now if now is not None else time.time()) else 0


def grant_plus(uid: str, days: float, source: str = "manual", now: float | None = None) -> int:
    """Add days of Plus: from today, or from the end of what is left, so buying
    early never loses time. Negative days take time away. Returns the new
    paid-until date, or 0 once there is none."""
    if not isinstance(uid, str) or not uid.startswith("u_") or len(uid) > 40:
        raise ValueError("not a player id")
    t = int(now if now is not None else time.time())
    data = _plus_all()
    current = plus_until(uid, now=t)
    until = (max(t, current) + int(days * 86400)) if days > 0 else (current + int(days * 86400))
    if until <= t:
        data.pop(uid, None)
        until = 0
    else:
        data[uid] = {"until": until, "source": str(source)[:60], "updated": t}
    tmp = plus_path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=1, sort_keys=True)
    os.replace(tmp, plus_path())
    # Run as root from a shell, the file must still belong to the service.
    try:
        st = os.stat(STATE_DIR)
        os.chown(plus_path(), st.st_uid, st.st_gid)
    except (OSError, AttributeError):
        pass
    return until


# ------------------------------------------------------------------- saves --

SAVE_MAX_BYTES = 600_000
SAVE_TTL = 14 * 24 * 3600
SAVES_PER_PLAYER = 30
PLUS_SAVE_TTL = 90 * 24 * 3600   # while anyone at the table has Plus
PLUS_SAVES_PER_PLAYER = 100
PROOF_WINDOW = 300
ROOM_RE = re.compile(r"^[A-Z]{3,10}-[A-Z]{3,10}-\d{1,3}$")
ALLOWED_ORIGINS = re.compile(
    r"^(https://(aytingchi\.uz|www\.aytingchi\.uz|partyhall\.io|www\.partyhall\.io|isoqovjorabek2\.github\.io)"
    r"|http://(localhost|127\.0\.0\.1)(:\d{2,5})?)$"
)


def saves_dir() -> str:
    path = os.path.join(STATE_DIR, "saves")
    os.makedirs(path, exist_ok=True)
    return path


def request_proof_message(method: str, path: str, ts: str, body: bytes) -> str:
    return f"mply-save|{method}|{path}|{ts}|{hashlib.sha256(body).hexdigest()}"


def check_request(headers, method: str, path: str, body: bytes,
                  key: ec.EllipticCurvePrivateKey | None = None, now: float | None = None) -> dict | None:
    """The caller's pass, if it is valid and the request is signed by the
    browser key it names within the last few minutes. Otherwise None."""
    t = now if now is not None else time.time()
    claims = verify_pass(headers.get("X-Pass", ""), key=key, now=t)
    if not claims or not isinstance(claims.get("cnf"), dict):
        return None
    ts = headers.get("X-Proof-Time", "")
    if not ts.isdigit() or abs(int(ts) - t) > PROOF_WINDOW:
        return None
    raw_sig = headers.get("X-Proof", "")
    try:
        raw = unb64u(raw_sig)
        if len(raw) != 64:
            return None
        cnf = claims["cnf"]
        pub = ec.EllipticCurvePublicNumbers(
            int.from_bytes(unb64u(cnf["x"]), "big"), int.from_bytes(unb64u(cnf["y"]), "big"), ec.SECP256R1(),
        ).public_key()
        der = encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
        pub.verify(der, request_proof_message(method, path, ts, body).encode(), ec.ECDSA(hashes.SHA256()))
    except Exception:  # noqa: BLE001
        return None
    return claims


def _save_path(code: str) -> str:
    return os.path.join(saves_dir(), f"{code}.json")


def _read_save(code: str) -> dict | None:
    try:
        with open(_save_path(code), encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return None
    if time.time() - data.get("updatedAt", 0) > data.get("ttl", SAVE_TTL):
        try:
            os.remove(_save_path(code))
        except OSError:
            pass
        return None
    return data


def _all_saves() -> list[dict]:
    out = []
    for name in os.listdir(saves_dir()):
        if name.endswith(".json"):
            data = _read_save(name[:-5])
            if data:
                out.append(data)
    return out


def clean_summary(raw) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    names = raw.get("names") if isinstance(raw.get("names"), list) else []
    return {
        "kind": "cashflow" if raw.get("kind") == "cashflow" else "monopoly",
        "round": int(raw["round"]) if isinstance(raw.get("round"), int) and 0 <= raw["round"] < 10000 else 0,
        "names": [re.sub(r"\s+", " ", str(n))[:18] for n in names[:8]],
    }


def put_save(uid: str, code: str, payload) -> tuple[int, dict]:
    if not ROOM_RE.match(code):
        return 400, {"error": "bad code"}
    if not isinstance(payload, dict) or not isinstance(payload.get("room"), dict):
        return 400, {"error": "bad body"}
    members = payload.get("members")
    if not isinstance(members, list) or not all(isinstance(m, str) and m.startswith("u_") for m in members):
        return 400, {"error": "bad members"}
    members = sorted(set(members))[:8]
    if uid not in members:
        return 403, {"error": "you are not at this table"}
    existing = _read_save(code)
    if existing and uid not in existing.get("members", []):
        # A code is only a word list and a number: somebody else's table.
        return 403, {"error": "not your table"}
    room = payload["room"]
    phase = (room.get("game") or {}).get("phase") or (room.get("cf") or {}).get("phase")
    if phase == "game_over":
        try:
            os.remove(_save_path(code))
        except OSError:
            pass
        return 200, {"ok": True, "deleted": True}
    if not existing:
        mine = sum(1 for s in _all_saves() if uid in s.get("members", []))
        if mine >= (PLUS_SAVES_PER_PLAYER if plus_until(uid) else SAVES_PER_PLAYER):
            return 429, {"error": "too many saved tables"}
    record = {
        "code": code,
        "members": members,
        "summary": clean_summary(payload.get("summary")),
        "epoch": int(room.get("epoch", 0)) if isinstance(room.get("epoch"), int) else 0,
        "room": room,
        "updatedAt": int(time.time()),
        # Kept longer while anyone at the table has Plus.
        "ttl": PLUS_SAVE_TTL if any(plus_until(m) for m in members) else SAVE_TTL,
    }
    tmp = _save_path(code) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(record, fh, separators=(",", ":"))
    os.replace(tmp, _save_path(code))
    return 200, {"ok": True}


def list_saves(uid: str) -> list[dict]:
    mine = [s for s in _all_saves() if uid in s.get("members", [])]
    mine.sort(key=lambda s: s.get("updatedAt", 0), reverse=True)
    return [{"code": s["code"], "epoch": s.get("epoch", 0), "updatedAt": s["updatedAt"], **s["summary"]}
            for s in mine]


def forget_save(uid: str, code: str) -> None:
    existing = _read_save(code) if ROOM_RE.match(code) else None
    if not existing or uid not in existing.get("members", []):
        return
    existing["members"] = [m for m in existing["members"] if m != uid]
    if not existing["members"]:
        try:
            os.remove(_save_path(code))
        except OSError:
            pass
        return
    with open(_save_path(code), "w", encoding="utf-8") as fh:
        json.dump(existing, fh, separators=(",", ":"))


# ----------------------------------------------------------------- history --
# Every game a signed-in player finishes, kept for them. Each player's own
# browser reports its own result when a game ends: the table has no server to
# ask, and nobody can file a result into somebody else's history, because the
# request is signed by that player's own browser key. The totals are shown to
# everyone; the game-by-game list is a Party Hall Plus perk.

HISTORY_KEEP = 200
HISTORY_SHOWN = 50
UID_RE = re.compile(r"^u_[a-z0-9]{1,38}$")
GAME_ID_RE = re.compile(r"^[A-Za-z0-9:_-]{1,64}$")


def history_path(uid: str) -> str:
    path = os.path.join(STATE_DIR, "history")
    os.makedirs(path, exist_ok=True)
    return os.path.join(path, f"{uid}.json")


def _read_games(uid: str) -> list:
    try:
        with open(history_path(uid), encoding="utf-8") as fh:
            data = json.load(fh)
        games = data.get("games") if isinstance(data, dict) else None
        return games if isinstance(games, list) else []
    except (OSError, ValueError):
        return []


def _int(v, lo: int, hi: int):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi:
        return None
    return int(v)


def clean_game(payload) -> dict | None:
    """A reported game, reduced to what history shows, or None if malformed."""
    if not isinstance(payload, dict):
        return None
    gid, kind, players = payload.get("id"), payload.get("kind"), payload.get("players")
    if not isinstance(gid, str) or not GAME_ID_RE.match(gid) or kind not in ("monopoly", "cashflow"):
        return None
    if not isinstance(players, list) or not 1 <= len(players) <= 8:
        return None
    rows = []
    for p in players:
        if not isinstance(p, dict):
            return None
        score = _int(p.get("score"), -10**9, 10**9)
        if score is None:
            return None
        rows.append({
            "name": re.sub(r"\s+", " ", str(p.get("name") or "")).strip()[:NAME_MAX] or "Player",
            "score": score,
            "bot": p.get("bot") is True,
            "you": p.get("you") is True,
        })
    if sum(1 for r in rows if r["you"]) != 1:
        return None
    place = _int(payload.get("place"), 1, 8)
    rounds = _int(payload.get("rounds"), 0, 10000)
    if place is None or rounds is None or place > len(rows):
        return None
    theme = payload.get("theme")
    return {
        "id": gid,
        "kind": kind,
        # A win is first place; a report cannot claim one from anywhere else.
        "won": payload.get("won") is True and place == 1,
        "place": place,
        "rounds": rounds,
        "players": rows,
        "score": next(r["score"] for r in rows if r["you"]),
        "theme": theme if theme in ("silk", "tashkent", "europe") else "silk",
    }


def record_game(uid: str, payload, now: float | None = None) -> tuple[int, dict]:
    if not isinstance(uid, str) or not UID_RE.match(uid):
        return 400, {"error": "bad player"}
    game = clean_game(payload)
    if not game:
        return 400, {"error": "bad game"}
    games = _read_games(uid)
    if any(g.get("id") == game["id"] for g in games):
        return 200, {"ok": True, "duplicate": True}
    game["at"] = int(now if now is not None else time.time())
    games = [game] + games
    tmp = history_path(uid) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"games": games[:HISTORY_KEEP]}, fh, separators=(",", ":"))
    os.replace(tmp, history_path(uid))
    return 200, {"ok": True}


def read_history(uid: str, full: bool) -> dict:
    """Totals for everyone; the games themselves only with Plus."""
    games = _read_games(uid) if isinstance(uid, str) and UID_RE.match(uid) else []
    totals = {"played": len(games), "wins": sum(1 for g in games if g.get("won")), "byKind": {}}
    for kind in ("monopoly", "cashflow"):
        mine = [g for g in games if g.get("kind") == kind]
        totals["byKind"][kind] = {
            "played": len(mine),
            "wins": sum(1 for g in mine if g.get("won")),
            "best": max((g.get("score", 0) for g in mine), default=0),
        }
    return {"totals": totals, "games": games[:HISTORY_SHOWN] if full else [], "plus": bool(full)}


# ------------------------------------------------------------------ paddle --
# Payments for Plus. Paddle is the merchant of record: it takes the money and
# tells this service what happened, by webhook. A notification is believed only
# if it carries Paddle's signature under "paddle_webhook_secret" in config.json,
# and only prices listed in "paddle_prices" (price id -> days of Plus) grant
# anything. Each event and each transaction is acted on once, so Paddle's
# retries - or anyone replaying a captured notification - change nothing.

PADDLE_TOLERANCE = 300          # seconds of clock skew allowed; replays are harmless anyway
PADDLE_KEEP_EVENTS = 2000


def paddle_path() -> str:
    os.makedirs(STATE_DIR, exist_ok=True)
    return os.path.join(STATE_DIR, "paddle.json")


def _paddle_state() -> dict:
    try:
        with open(paddle_path(), encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    data.setdefault("events", [])
    data.setdefault("transactions", {})
    data.setdefault("subscriptions", {})
    return data


def _save_paddle_state(data: dict) -> None:
    data["events"] = data["events"][-PADDLE_KEEP_EVENTS:]
    tmp = paddle_path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"))
    os.replace(tmp, paddle_path())
    try:
        st = os.stat(STATE_DIR)
        os.chown(paddle_path(), st.st_uid, st.st_gid)
    except (OSError, AttributeError):
        pass


def paddle_signature_ok(header: str, raw: bytes, secret: str, now: float | None = None) -> bool:
    """Paddle-Signature is `ts=<unix>;h1=<hex>` (several h1 during a secret
    rotation): an HMAC-SHA256, under the notification secret, of `ts:raw body`."""
    if not secret or not isinstance(header, str):
        return False
    pairs = [part.split("=", 1) for part in header.split(";") if "=" in part]
    ts = next((v.strip() for k, v in pairs if k.strip() == "ts"), "")
    sigs = [v.strip() for k, v in pairs if k.strip() == "h1"]
    if not ts.isdigit() or not sigs:
        return False
    if abs((now if now is not None else time.time()) - int(ts)) > PADDLE_TOLERANCE:
        return False
    want = hmac.new(secret.encode(), ts.encode() + b":" + raw, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(want, sig) for sig in sigs)


def _paddle_completed(state: dict, data: dict, prices: dict, now: float | None) -> dict:
    txn = str(data.get("id") or "")
    if not txn or txn in state["transactions"]:
        return {"ok": True, "duplicate": True}
    sub = data.get("subscription_id")
    custom = data.get("custom_data") if isinstance(data.get("custom_data"), dict) else {}
    uid = custom.get("uid")
    # A renewal may not carry the checkout's custom data; its subscription does.
    if not (isinstance(uid, str) and UID_RE.match(uid)) and isinstance(sub, str):
        uid = state["subscriptions"].get(sub)
    if not (isinstance(uid, str) and UID_RE.match(uid)):
        return {"ok": True, "ignored": "no player"}
    days = 0
    for item in data.get("items") or []:
        if not isinstance(item, dict):
            continue
        price = (item.get("price") or {}).get("id") if isinstance(item.get("price"), dict) else None
        qty = item.get("quantity", 1)
        if isinstance(price, str) and price in prices:
            days += int(prices[price]) * (qty if isinstance(qty, int) and 0 < qty <= 10 else 1)
    if days <= 0:
        return {"ok": True, "ignored": "no Plus price"}
    until = grant_plus(uid, days, source=f"paddle {txn}", now=now)
    state["transactions"][txn] = {"uid": uid, "days": days, "at": int(now if now is not None else time.time())}
    if isinstance(sub, str):
        state["subscriptions"][sub] = uid
    return {"ok": True, "granted": days, "until": until}


def _paddle_adjustment(state: dict, data: dict, now: float | None) -> dict:
    """An approved full refund or chargeback takes back what its transaction
    granted. A partial refund keeps Plus; a pending one waits for approval."""
    if data.get("action") not in ("refund", "chargeback") or data.get("status") != "approved":
        return {"ok": True, "ignored": "not an approved refund"}
    if data.get("type", "full") != "full":
        return {"ok": True, "ignored": "partial"}
    rec = state["transactions"].get(str(data.get("transaction_id") or ""))
    if not rec or rec.get("refunded"):
        return {"ok": True, "ignored": "nothing to take back"}
    until = grant_plus(rec["uid"], -int(rec["days"]), source=f"refund {data.get('transaction_id')}", now=now)
    rec["refunded"] = True
    return {"ok": True, "revoked": rec["days"], "until": until}


def paddle_webhook(header: str, raw: bytes, now: float | None = None, config: dict | None = None) -> tuple[int, dict]:
    c = config if config is not None else cfg()
    if not paddle_signature_ok(header, raw, str(c.get("paddle_webhook_secret", "")), now=now):
        return 401, {"error": "bad signature"}
    try:
        event = json.loads(raw)
    except ValueError:
        return 400, {"error": "bad json"}
    if not isinstance(event, dict) or not isinstance(event.get("data"), dict):
        return 400, {"error": "bad event"}
    state = _paddle_state()
    event_id = str(event.get("event_id") or "")
    if event_id and event_id in state["events"]:
        return 200, {"ok": True, "duplicate": True}
    prices = c.get("paddle_prices") if isinstance(c.get("paddle_prices"), dict) else {}
    kind, data = event.get("event_type"), event["data"]
    result = {"ok": True, "ignored": "event not used"}
    if kind == "transaction.completed":
        result = _paddle_completed(state, data, prices, now)
    elif kind in ("adjustment.created", "adjustment.updated"):
        result = _paddle_adjustment(state, data, now)
    if event_id:
        state["events"].append(event_id)
    _save_paddle_state(state)
    return 200, result


# ------------------------------------------------------------------ server --

def with_fragment(url: str, key: str, value: str, **extra: str) -> str:
    """The pass rides in the fragment: browsers never send a fragment to any
    server, so it stays out of every access log on the way back."""
    parts = [f"{key}={urllib.parse.quote(value, safe='')}"]
    parts += [f"{k}={urllib.parse.quote(v, safe='')}" for k, v in extra.items()]
    return f"{url.split('#', 1)[0]}#{'&'.join(parts)}"


def profile_blob(claims: dict) -> str:
    """Who the player is, for their own screen: full name, address and
    picture. It travels beside the pass, not inside it - the pass goes to
    other players' browsers, and this never leaves the player's own."""
    data = {
        "name": re.sub(r"\s+", " ", str(claims.get("name") or "")).strip()[:60],
        "email": str(claims.get("email") or "")[:120] if claims.get("email_verified") in (True, "true") else "",
        "picture": str(claims.get("picture") or "")[:400]
        if str(claims.get("picture") or "").startswith("https://") else "",
    }
    return b64u(json.dumps(data, separators=(",", ":")).encode())


class Handler(BaseHTTPRequestHandler):
    server_version = "accounts"

    def log_message(self, fmt, *args):  # quiet: no codes or passes in the journal
        pass

    def send(self, status: int, body: bytes = b"", ctype: str = "text/plain; charset=utf-8",
             headers: dict | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def redirect(self, url: str) -> None:
        self.send(302, headers={"Location": url})

    # --- saves: JSON, CORS for the game's own origins, signed requests ---

    def cors(self) -> dict:
        origin = self.headers.get("Origin", "")
        if not ALLOWED_ORIGINS.match(origin):
            return {}
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, PUT, DELETE, POST",
            "Access-Control-Allow-Headers": "Content-Type, X-Pass, X-Proof, X-Proof-Time",
            "Access-Control-Max-Age": "600",
            "Vary": "Origin",
        }

    def json(self, status: int, data) -> None:
        self.send(status, json.dumps(data).encode(), "application/json", self.cors())

    def do_OPTIONS(self):  # noqa: N802
        self.send(204, headers=self.cors())

    def saves(self, method: str) -> None:
        path = urllib.parse.urlsplit(self.path).path.rstrip("/")
        length = int(self.headers.get("Content-Length") or 0)
        if length > SAVE_MAX_BYTES:
            self.json(413, {"error": "too big"})
            return
        body = self.rfile.read(length) if length else b""
        claims = check_request(self.headers, method, path, body)
        if not claims:
            self.json(401, {"error": "sign in again"})
            return
        uid = claims["sub"]
        code = path[len("/saves/"):] if path.startswith("/saves/") else ""
        if method == "GET" and not code:
            self.json(200, {"saves": list_saves(uid)})
        elif method == "GET":
            save = _read_save(code) if ROOM_RE.match(code) else None
            if not save or uid not in save.get("members", []):
                self.json(404, {"error": "no such table"})
            else:
                self.json(200, {"code": code, "epoch": save.get("epoch", 0), "room": save["room"],
                                "updatedAt": save["updatedAt"]})
        elif method == "PUT" and code:
            try:
                payload = json.loads(body or b"{}")
            except ValueError:
                self.json(400, {"error": "bad json"})
                return
            status, out = put_save(uid, code, payload)
            self.json(status, out)
        elif method == "DELETE" and code:
            forget_save(uid, code)
            self.json(200, {"ok": True})
        else:
            self.json(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        path = urllib.parse.urlsplit(self.path).path.rstrip("/")
        if path == "/paddle/webhook":
            # Signed by Paddle, not by a player: no pass, no browser proof.
            length = int(self.headers.get("Content-Length") or 0)
            if length > 262144:
                self.send(413, b"too big")
                return
            raw = self.rfile.read(length) if length else b""
            status, out = paddle_webhook(self.headers.get("Paddle-Signature", ""), raw)
            if status != 200:
                print(f"paddle webhook refused: {out}", file=sys.stderr, flush=True)
            self.send(status, json.dumps(out).encode(), "application/json")
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length > 8192:
            self.json(413, {"error": "too big"})
            return
        body = self.rfile.read(length) if length else b""
        if path not in ("/refresh", "/history"):
            self.json(404, {"error": "not found"})
            return
        claims = check_request(self.headers, "POST", path, body)
        if not claims:
            self.json(401, {"error": "sign in again"})
            return
        if path == "/history":
            try:
                payload = json.loads(body or b"{}")
            except ValueError:
                self.json(400, {"error": "bad json"})
                return
            status, out = record_game(claims["sub"], payload)
            self.json(status, out)
            return
        # The same player and the same browser key, stamped with whatever Plus
        # they hold now: how a purchase reaches the table without signing in.
        cnf = claims["cnf"]
        until = plus_until(claims["sub"])
        pass_ = mint_pass(claims["sub"], str(claims.get("name") or ""), cnf=f"{cnf['x']}.{cnf['y']}", plus=until)
        self.json(200, {"pass": pass_, "plus": until})

    def do_PUT(self):  # noqa: N802
        self.saves("PUT")

    def do_DELETE(self):  # noqa: N802
        self.saves("DELETE")

    def do_GET(self):  # noqa: N802 - http.server naming
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path.rstrip("/")
        q = urllib.parse.parse_qs(parsed.query)
        one = lambda k: (q.get(k) or [""])[0]  # noqa: E731

        if path == "/health":
            self.send(200, b"ok")
            return

        if path == "/history":
            claims = check_request(self.headers, "GET", path, b"")
            if not claims:
                self.json(401, {"error": "sign in again"})
                return
            self.json(200, read_history(claims["sub"], full=bool(plus_until(claims["sub"]))))
            return

        if path == "/saves" or path.startswith("/saves/"):
            self.saves("GET")
            return

        if path == "/key":
            body = json.dumps(public_jwk()).encode()
            self.send(200, body, "application/json", {"Access-Control-Allow-Origin": "*"})
            return

        if path == "/google/start":
            return_to = one("return")
            if not RETURN_RE.match(return_to):
                self.send(400, b"That return address is not allowed.")
                return
            point = one("dpk")
            if not point_ok(point):
                self.send(400, b"This browser did not send a device key. Reload the game and try again.")
                return
            c = cfg()
            if not (c.get("google_client_id") and c.get("google_client_secret") and c.get("state_secret")):
                self.redirect(with_fragment(return_to, "auth_error", "unavailable"))
                return
            self.redirect(google_login_url(make_state(return_to, point)))
            return

        if path == "/google/callback":
            read = read_state(one("state"))
            if not read:
                self.send(400, b"This sign-in link has expired or did not start here. Try again from the game.")
                return
            return_to, point = read
            if one("error") or not one("code"):
                self.redirect(with_fragment(return_to, "auth_error", "cancelled"))
                return
            claims = google_exchange(one("code"))
            if not claims:
                self.redirect(with_fragment(return_to, "auth_error", "failed"))
                return
            sub = player_id(str(claims["sub"]))
            # The name the table sees is the one on the Google account.
            name = claims.get("name") or claims.get("given_name") or "Player"
            pass_ = mint_pass(sub, name, cnf=point if point_ok(point) else None, plus=plus_until(sub))
            self.redirect(with_fragment(return_to, "auth", pass_, profile=profile_blob(claims)))
            return

        self.send(404, b"not found")


def main() -> None:
    if len(sys.argv) >= 2 and sys.argv[1] == "pubkey":
        print(json.dumps(public_jwk(), indent=2))
        return
    if len(sys.argv) >= 5 and sys.argv[1] == "mint":
        if not point_ok(sys.argv[4]):
            sys.exit("mint needs the browser's key point as x.y")
        print(mint_pass(sys.argv[2], sys.argv[3], cnf=sys.argv[4]))
        return
    if len(sys.argv) >= 3 and sys.argv[1] == "plus":
        uid = sys.argv[2]
        until = (grant_plus(uid, float(sys.argv[3]), source=" ".join(sys.argv[4:]) or "manual")
                 if len(sys.argv) >= 4 else plus_until(uid))
        print(json.dumps({
            "uid": uid, "plus_until": until,
            "utc": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(until)) if until else None,
        }))
        return
    signing_key()  # fail at start, not on the first sign-in
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"accounts listening on {HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
