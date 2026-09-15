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
              now: float | None = None, cnf: str | None = None) -> str:
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


# ------------------------------------------------------------------- saves --

SAVE_MAX_BYTES = 600_000
SAVE_TTL = 14 * 24 * 3600
SAVES_PER_PLAYER = 30
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
    if time.time() - data.get("updatedAt", 0) > SAVE_TTL:
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
        if mine >= SAVES_PER_PLAYER:
            return 429, {"error": "too many saved tables"}
    record = {
        "code": code,
        "members": members,
        "summary": clean_summary(payload.get("summary")),
        "epoch": int(room.get("epoch", 0)) if isinstance(room.get("epoch"), int) else 0,
        "room": room,
        "updatedAt": int(time.time()),
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
            "Access-Control-Allow-Methods": "GET, PUT, DELETE",
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
            pass_ = mint_pass(sub, name, cnf=point if point_ok(point) else None)
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
    signing_key()  # fail at start, not on the first sign-in
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"accounts listening on {HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
