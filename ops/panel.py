#!/usr/bin/env python3
"""
The operator's panel for the droplet that runs the relay and the site.

Binds 127.0.0.1 only, and is reached two ways.

Over an SSH tunnel there is no sign-in: the port is unreachable from the
internet and the tunnel already proved possession of the SSH key, which is a
better credential than any password would have been.

Through nginx at a public URL, sign-in is required - Google, or a one-time
link by email. Authentication only establishes *which* address you are; a
separate allowlist decides whether that address may look. Anyone can get a
Google account, so treating "signed in" as "allowed" would be a lock with no
key. With neither method configured the public route serves nothing at all,
because an unconfigured panel on a public URL must not be an open one.

It is a console, not just a dashboard: the same two ways in also guard the
controls. The panel writes bans.json into the lobby service's state
directory - who may not play (by account, or by display name for hosting),
and which room codes are closed. The lobby service enforces that file
against announces and reports, and the accounts service refuses banned
players new passes. Writes from the public route carry the session cookie
and an X-Ops-Admin header; the header is the CSRF proof, because a
cross-site form cannot set one and a cross-site fetch that tries triggers a
preflight this server never answers.

Most of it is derived from what the machine already writes down - journald,
nginx's access log, /proc. The tables section is the exception: the game
itself lives in the host's browser, so the only way this box can know who is
playing is to be told. Each table's host reports its shape to the lobby
service (ops/lobbies.py), which keeps it in /var/lib/lobbies, and this panel
reads those files. It never talks to the lobby service over HTTP, and the
lobby service never serves any of it back out.

Python 3 standard library only, deliberately: this runs on a 1GB droplet
alongside the things it is watching.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import smtplib
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from email.message import EmailMessage
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST, PORT = "127.0.0.1", 9000

# Secrets and the allowlist live here, root-owned and 0600, never in this
# file and never in the repo. Missing or unreadable means public access is
# refused outright - see the auth section.
CONFIG_PATH = "/etc/opspanel/config.json"

UNITS = ("coturn", "nginx", "lobbies", "aitutor")
NGINX_ACCESS = "/var/log/nginx/access.log"
CERT = "/etc/coturn/certs/fullchain.pem"
# Written by lobbies.service, which runs as the same user.
LOBBY_STATE = os.environ.get("LOBBIES_STATE", "/var/lib/lobbies")

# journalctl over a day is the slowest thing here; a short cache keeps a
# refreshing browser from making the panel the busiest process on the box.
_CACHE: dict[str, tuple[float, object]] = {}
CACHE_TTL = 10.0


def cached(key, fn):
    now = time.time()
    hit = _CACHE.get(key)
    if hit and now - hit[0] < CACHE_TTL:
        return hit[1]
    val = fn()
    _CACHE[key] = (now, val)
    return val


def run(cmd: list[str], timeout: float = 12.0, stdin: str = "") -> str:
    """Never let a wedged subprocess take the page down with it."""
    try:
        return subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout,
            check=False, input=stdin,
        ).stdout
    except Exception:
        return ""


# ------------------------------------------------------------------- auth --
#
# Auth is optional, and which half you get depends on how you arrived.
#
#   over the SSH tunnel  -> no auth. The port is loopback-only and the tunnel
#                           already proved possession of the SSH key.
#   through nginx        -> sign-in required. nginx sets X-Panel-Public, which
#                           it also strips from the incoming request, so a
#                           client cannot clear it to look local.
#
# Signing in proves *which* address you are; the allowlist decides whether
# that address may look. Those are separate on purpose: anyone in the world
# can obtain a Google account, so authentication alone would be a door with
# a lock and no key.

def cfg() -> dict:
    def load():
        try:
            with open(CONFIG_PATH) as fh:
                return json.load(fh)
        except Exception:
            return {}
    # Re-read periodically so editing the allowlist does not need a restart.
    return cached("cfg", load)


def _secret() -> bytes:
    return str(cfg().get("session_secret", "")).encode()


def _sign(body: str) -> str:
    mac = hmac.new(_secret(), body.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{body}.{mac}"


def _unsign(value: str) -> str | None:
    body, _, mac = str(value).rpartition(".")
    if not body or not _secret():
        return None
    want = hmac.new(_secret(), body.encode(), hashlib.sha256).hexdigest()[:32]
    return body if hmac.compare_digest(mac, want) else None


def _b64e(data: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")


def _b64d(text: str) -> dict | None:
    try:
        return json.loads(base64.urlsafe_b64decode(text + "=" * (-len(text) % 4)))
    except Exception:
        return None


def make_token(kind: str, email: str, ttl: int) -> str:
    return _sign(_b64e({
        "k": kind, "e": email, "x": int(time.time() + ttl),
        "n": secrets.token_urlsafe(6),
    }))


# Magic-link tokens are single use. Held in memory, so a restart invalidates
# any outstanding link - acceptable for something that lives ten minutes.
_SPENT: set[str] = set()


def read_token(token: str, kind: str, single_use: bool = False) -> str | None:
    body = _unsign(token)
    if not body:
        return None
    data = _b64d(body)
    if not data or data.get("k") != kind or data.get("x", 0) < time.time():
        return None
    if single_use:
        nonce = data.get("n", "")
        if nonce in _SPENT:
            return None
        _SPENT.add(nonce)
        if len(_SPENT) > 500:
            _SPENT.clear()
    return data.get("e")


def allowed(email: str) -> bool:
    listed = [str(a).strip().lower() for a in cfg().get("allowlist", []) if str(a).strip()]
    return bool(email) and email.strip().lower() in listed


def auth_modes() -> dict:
    c = cfg()
    return {
        "google": bool(c.get("google_client_id") and c.get("google_client_secret")),
        "email": bool(c.get("smtp_host") and c.get("smtp_from")),
    }


def base_url() -> str:
    return str(cfg().get("public_base_url", "")).rstrip("/")


# ------------------------------------------------------------ google oauth --

GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"


def google_redirect_uri() -> str:
    return f"{base_url()}/auth/google/callback"


def google_login_url() -> str:
    c = cfg()
    params = {
        "client_id": c.get("google_client_id", ""),
        "redirect_uri": google_redirect_uri(),
        "response_type": "code",
        "scope": "openid email",
        "state": make_token("state", "-", 600),
        "prompt": "select_account",
    }
    return GOOGLE_AUTH + "?" + urllib.parse.urlencode(params)


def google_exchange(code: str) -> str | None:
    """Swap the code for an id_token and return the verified email."""
    c = cfg()
    body = urllib.parse.urlencode({
        "code": code,
        "client_id": c.get("google_client_id", ""),
        "client_secret": c.get("google_client_secret", ""),
        "redirect_uri": google_redirect_uri(),
        "grant_type": "authorization_code",
    }).encode()
    try:
        req = urllib.request.Request(
            GOOGLE_TOKEN, data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            payload = json.loads(r.read())
    except Exception:
        return None

    # The id_token arrived over TLS straight from Google's token endpoint in
    # response to a request carrying our client secret. Google documents that
    # tokens obtained this way need no signature check - the transport is the
    # proof. The claims still have to be checked, and are.
    parts = str(payload.get("id_token", "")).split(".")
    if len(parts) != 3:
        return None
    claims = _b64d(parts[1])
    if not claims:
        return None
    if claims.get("aud") != c.get("google_client_id"):
        return None
    if claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        return None
    if claims.get("exp", 0) < time.time():
        return None
    if claims.get("email_verified") not in (True, "true"):
        return None
    return claims.get("email")


# -------------------------------------------------------------- magic link --

_SENT: dict[str, float] = {}


def send_magic_link(email: str) -> tuple[bool, str]:
    """
    Reports exactly the same thing however this goes: address allowed or not,
    mail sent or failed. Telling a stranger which addresses are on the list
    would be answering a question they should not get to ask, and a delivery
    error is enough to answer it - "sent" for an unknown address but an error
    for a real one distinguishes the two perfectly.

    So failures go to the operator instead, on stderr and therefore into
    journalctl -u opspanel, where whoever runs this can see them and whoever
    is probing it cannot.
    """
    now = time.time()
    _SENT.update({k: v for k, v in list(_SENT.items()) if now - v < 3600})
    if _SENT.get(email, 0) > now - 60:
        return True, "sent"
    _SENT[email] = now

    if not allowed(email):
        return True, "sent"  # deliberately indistinguishable

    c = cfg()
    link = f"{base_url()}/auth/magic?token={urllib.parse.quote(make_token('magic', email, 600))}"
    msg = EmailMessage()
    msg["Subject"] = "Sign in to the droplet status panel"
    msg["From"] = c.get("smtp_from", "")
    msg["To"] = email
    msg.set_content(
        "Here is your sign-in link. It works once and expires in 10 minutes.\n\n"
        f"{link}\n\nIf you did not ask for this, ignore it - nobody can use it but you.\n"
    )
    try:
        port = int(c.get("smtp_port", 587))
        with smtplib.SMTP(c.get("smtp_host", ""), port, timeout=20) as smtp:
            smtp.starttls()
            if c.get("smtp_user"):
                smtp.login(c["smtp_user"], c.get("smtp_password", ""))
            smtp.send_message(msg)
    except Exception as e:
        print(f"[opspanel] magic link to an allowlisted address FAILED to send: "
              f"{type(e).__name__}: {e}", file=sys.stderr, flush=True)
        return True, "sent"  # same answer as every other path, on purpose
    return True, "sent"


# --------------------------------------------------------------- services --

def services() -> list[dict]:
    out = []
    for unit in UNITS:
        state = run(["systemctl", "is-active", unit]).strip() or "unknown"
        since = run([
            "systemctl", "show", unit, "-p", "ActiveEnterTimestamp", "--value",
        ]).strip()
        secs = None
        if since:
            try:
                t = datetime.strptime(since[:31], "%a %Y-%m-%d %H:%M:%S %Z")
                secs = max(0, int(time.time() - t.replace(tzinfo=timezone.utc).timestamp()))
            except Exception:
                secs = None
        out.append({"unit": unit, "state": state, "uptime_s": secs})
    return out


# ------------------------------------------------------------------- cert --

def _served_cert(sni: str) -> dict:
    """
    What a client is actually handed for this name, not what is on disk.

    This is deliberate. The way TLS breaks here is that certbot renews, the
    files under /etc/letsencrypt are new, and coturn goes on presenting the
    old one because it only reads its certificate at startup. Reading the
    file would show the renewed date and report everything fine while real
    clients were being served an expired certificate. Asking the socket is
    the only check that catches it - and it covers both backends of the 443
    split, since the SNI decides which one answers.
    """
    out = run(
        ["openssl", "s_client", "-connect", "127.0.0.1:443", "-servername", sni],
        timeout=10.0, stdin="",
    )
    pem = re.search(r"(-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----)", out, re.S)
    if not pem:
        return {"sni": sni, "error": "no certificate returned"}
    info = run(["openssl", "x509", "-noout", "-enddate", "-subject", "-ext", "subjectAltName"],
               timeout=8.0, stdin=pem.group(1))
    end = re.search(r"notAfter=(.+)", info)
    expires, days = None, None
    if end:
        expires = end.group(1).strip()
        try:
            t = datetime.strptime(expires, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
            days = round((t - datetime.now(timezone.utc)).total_seconds() / 86400, 1)
        except Exception:
            pass
    return {
        "sni": sni,
        "expires": expires,
        "days_left": days,
        "names": re.findall(r"DNS:([^\s,]+)", info),
        "serves": "coturn" if sni.startswith("turn.") else "website",
    }


def cert() -> dict:
    # The site, and the relay's TLS name (still turn.aytingchi.uz until a
    # turn.partyhall.io record and certificate exist - see docs/turn.md).
    served = [_served_cert(n) for n in ("partyhall.io", "turn.aytingchi.uz")]
    days = [s["days_left"] for s in served if s.get("days_left") is not None]
    expiries = {s.get("expires") for s in served if s.get("expires")}
    return {
        "served": served,
        # The soonest expiry is the one that matters.
        "days_left": min(days) if days else None,
        # Two different dates means one backend is still holding an old copy -
        # exactly the renewal failure this check exists for.
        "mismatch": len(expiries) > 1,
    }


# ------------------------------------------------------------------- turn --

# session 00100...2: realm <monopoly> user <monopoly>: incoming packet ALLOCATE processed, success
RE_ALLOC = re.compile(r"session (\d+): .*ALLOCATE processed, success")
# session 00100...2: usage: realm=<monopoly>, username=<monopoly>, rp=2, rb=124, sp=2, sb=220
RE_USAGE = re.compile(r"session (\d+): usage: .*rb=(\d+), sp=\d+, sb=(\d+)")
# ... closed (2nd stage), ... local 127.0.0.1:5349, remote 1.2.3.4:5, reason: X
RE_CLOSED = re.compile(r"session (\d+): closed.*local [\d.]+:(\d+).*reason: (.+)$")


def turn(hours: int = 24) -> dict:
    text = cached(
        f"journal{hours}",
        lambda: run([
            "journalctl", "-u", "coturn", "--no-pager", "--output=cat",
            "--since", f"{hours} hours ago",
        ], timeout=20.0),
    )
    # Everything is accumulated per session id, because a session produces
    # several lines and coturn closes one twice ("1st stage", then "2nd").
    # Counting lines instead of sessions double-counts every close.
    sessions: dict[str, dict] = {}

    def s(sid):
        return sessions.setdefault(sid, {"alloc": False, "port": None, "rx": 0, "tx": 0, "closed": False})

    reasons: dict[str, int] = {}
    for line in text.splitlines():
        m = RE_ALLOC.search(line)
        if m:
            s(m.group(1))["alloc"] = True
            continue
        m = RE_USAGE.search(line)
        if m:
            e = s(m.group(1))
            e["rx"], e["tx"] = int(m.group(2)), int(m.group(3))
            continue
        m = RE_CLOSED.search(line)
        if m:
            e = s(m.group(1))
            e["closed"] = True
            e["port"] = e["port"] or m.group(2)
            reason = m.group(3).strip()
            if reason not in ("general",):
                e.setdefault("reasons", set()).add(reason)

    # Only sessions that actually allocated a relay are relay traffic. Plain
    # STUN binds and this panel's own certificate probe open sessions to
    # coturn too, and counting those would make the relay look busy because
    # the panel was watching it.
    relays = {k: v for k, v in sessions.items() if v["alloc"]}
    by_transport = {"turns (TLS 443)": 0, "turn (3478)": 0}
    for v in relays.values():
        by_transport["turns (TLS 443)" if v["port"] == "5349" else "turn (3478)"] += 1
        # Reasons are aggregated over relay sessions only, so the list cannot
        # be dominated by the panel's own probe connections.
        for r in v.get("reasons", ()):
            reasons[r] = reasons.get(r, 0) + 1

    return {
        "window_h": hours,
        "allocations": len(relays),
        "closed": sum(1 for v in relays.values() if v["closed"]),
        "active": sum(1 for v in relays.values() if not v["closed"]),
        "bytes_from_clients": sum(v["rx"] for v in relays.values()),
        "bytes_to_clients": sum(v["tx"] for v in relays.values()),
        "by_transport": by_transport,
        "close_reasons": sorted(reasons.items(), key=lambda kv: -kv[1])[:5],
        "non_relay_sessions": len(sessions) - len(relays),
        "logging_ok": "ALLOCATE" in text or "turn server id" in text,
    }


# ------------------------------------------------------------------ nginx --

# 127.0.0.1 - - [10/Sep/2026:05:51:00 +0000] "GET /path HTTP/1.1" 200 2456 "-" "UA"
RE_ACCESS = re.compile(
    r'^\S+ \S+ \S+ \[([^\]]+)\] "(\w+) ([^" ]*)[^"]*" (\d{3}) (\d+|-)'
)
TAIL_BYTES = 3_000_000  # plenty for a low-traffic box, bounded for a small one


def nginx(hours: int = 24) -> dict:
    try:
        with open(NGINX_ACCESS, "rb") as fh:
            fh.seek(0, 2)
            size = fh.tell()
            fh.seek(max(0, size - TAIL_BYTES))
            raw = fh.read().decode("utf-8", "replace")
    except Exception as e:
        return {"error": f"{type(e).__name__}: cannot read {NGINX_ACCESS}"}

    cutoff = time.time() - hours * 3600
    buckets: dict[str, int] = {}
    kinds = {"page": 0, "asset": 0, "api": 0, "other": 0}
    statuses: dict[str, int] = {}
    paths: dict[str, int] = {}
    total = served_bytes = 0

    for line in raw.splitlines():
        m = RE_ACCESS.match(line)
        if not m:
            continue
        stamp, _method, path, status, nbytes = m.groups()
        try:
            t = datetime.strptime(stamp, "%d/%b/%Y:%H:%M:%S %z").timestamp()
        except Exception:
            continue
        if t < cutoff:
            continue
        total += 1
        served_bytes += int(nbytes) if nbytes.isdigit() else 0
        buckets[datetime.fromtimestamp(t, timezone.utc).strftime("%H:00")] = (
            buckets.get(datetime.fromtimestamp(t, timezone.utc).strftime("%H:00"), 0) + 1
        )
        statuses[status] = statuses.get(status, 0) + 1
        if path.startswith("/api/"):
            kinds["api"] += 1
        elif path.startswith("/assets/") or path.startswith("/art/") or path.startswith("/audio/"):
            kinds["asset"] += 1
        elif path == "/" or path.endswith(".html") or "/" not in path.strip("/"):
            kinds["page"] += 1
        else:
            kinds["other"] += 1
        paths[path[:60]] = paths.get(path[:60], 0) + 1

    return {
        "window_h": hours,
        "requests": total,
        "bytes": served_bytes,
        "kinds": kinds,
        "statuses": dict(sorted(statuses.items())),
        "top_paths": sorted(paths.items(), key=lambda kv: -kv[1])[:8],
        "per_hour": buckets,
        # The stream split replaces the client address, so every request looks
        # local. Say so rather than showing a visitor count that is a lie.
        "client_ip_note": "all requests read as 127.0.0.1 (TLS stream split); no visitor counts",
    }


# ----------------------------------------------------------------- tables --

def _events(days: int) -> list[dict]:
    """The lobby service's day files, oldest first."""
    def load():
        out: list[dict] = []
        now = time.time()
        for i in range(days):
            day = datetime.fromtimestamp(now - i * 86400, timezone.utc).strftime("%Y-%m-%d")
            try:
                with open(os.path.join(LOBBY_STATE, f"events-{day}.jsonl"), encoding="utf-8") as fh:
                    for line in fh:
                        try:
                            rec = json.loads(line)
                        except ValueError:
                            continue  # a line cut off by a crash mid-write
                        if isinstance(rec, dict) and "t" in rec and "ev" in rec:
                            out.append(rec)
            except OSError:
                continue
        out.sort(key=lambda e: e["t"])
        return out
    return cached(f"events{days}", load)


def _names(events: list[dict]) -> set[str]:
    """Distinct human player names. Names, not people: two players both
    called Ali are one here, and one player renaming is two."""
    seen: set[str] = set()
    for e in events:
        if e["ev"] in ("opened", "started", "closed"):
            for p in e.get("players") or []:
                if isinstance(p, dict) and not p.get("bot"):
                    seen.add(str(p.get("name", "")).strip().lower())
        elif e["ev"] == "joined":
            seen.add(str(e.get("name", "")).strip().lower())
    seen.discard("")
    return seen


def tables() -> dict:
    try:
        with open(os.path.join(LOBBY_STATE, "tables.json"), encoding="utf-8") as fh:
            snap = json.load(fh)
    except FileNotFoundError:
        return {"error": "No table data yet - the lobby service writes it once a table reports."}
    except (OSError, ValueError) as e:
        return {"error": f"Cannot read the table log ({type(e).__name__})."}

    now = time.time()
    events = _events(8)
    day = [e for e in events if now - e["t"] < 86400]
    week = [e for e in events if now - e["t"] < 7 * 86400]

    def count(evs, name, **match):
        return sum(1 for e in evs if e["ev"] == name and all(e.get(k) == v for k, v in match.items()))

    live = [t for t in snap.get("live", []) if isinstance(t, dict)]
    for t in live:
        t["age"] = int(now - t.get("opened", now))
        t["quiet"] = int(now - t.get("seen", now))
    recent = [t for t in snap.get("recent", []) if isinstance(t, dict)][:60]
    for t in recent:
        t["ago"] = int(now - t.get("ended", now))
        t["secs"] = int(t.get("ended", now) - t.get("opened", now))

    def human(t):
        return [p for p in t.get("players", []) if not p.get("bot")]

    per_day: dict[str, dict] = {}
    for i in range(6, -1, -1):
        per_day[datetime.fromtimestamp(now - i * 86400, timezone.utc).strftime("%b %d")] = {"opened": 0, "finished": 0}
    for e in week:
        if e["ev"] in ("opened", "finished"):
            key = datetime.fromtimestamp(e["t"], timezone.utc).strftime("%b %d")
            if key in per_day:
                per_day[key][e["ev"]] += 1

    samples = [[int(e["t"]), e.get("humans", 0), e.get("tables", 0)] for e in day if e["ev"] == "sample"]
    finished = [e for e in day if e["ev"] == "finished"]
    generated = float(snap.get("generated", 0))
    online_now = sum(1 for t in live for p in human(t) if p.get("connected"))
    return {
        "generated_age": int(now - generated),
        # The service rewrites the file at least every 15 seconds.
        "stale": now - generated > 60,
        "live": live,
        "recent": recent,
        "public_rooms": len(snap.get("rooms", [])),
        "now": {
            "tables": len(live),
            "playing": sum(1 for t in live if t.get("phase") == "playing"),
            "lobby": sum(1 for t in live if t.get("phase") == "lobby"),
            "humans": online_now,
            "offline": sum(1 for t in live for p in human(t) if not p.get("connected")),
            "bots": sum(1 for t in live for p in t.get("players", []) if p.get("bot")),
        },
        "day": {
            "opened": count(day, "opened"),
            "started": count(day, "started"),
            "finished": len(finished),
            "players": len(_names(day)),
            "monopoly": count(day, "opened", game="monopoly"),
            "cashflow": count(day, "opened", game="cashflow"),
            "public": count(day, "opened", mode="public") + count(day, "listed"),
            "private": count(day, "opened", mode="private"),
            "solo": count(day, "opened", mode="solo"),
            "mobile": count(day, "opened", device="mobile"),
            "dropped": count(day, "dropped"),
            "quiet": count(day, "closed", reason="went quiet"),
            "avg_game_min": round(sum(e.get("secs", 0) for e in finished) / len(finished) / 60, 1) if finished else None,
            # Samples are five minutes apart, so the present can beat them all.
            "peak_humans": max([online_now, *(s[1] for s in samples)]),
        },
        "week": {
            "opened": count(week, "opened"),
            "finished": count(week, "finished"),
            "players": len(_names(week)),
            "per_day": per_day,
        },
        "samples": samples,
        "feed": [e for e in reversed(day) if e["ev"] != "sample"][:80],
    }


# ------------------------------------------------------------- moderation --
# bans.json lives in the lobby service's state directory: the lobby service
# enforces it against announces and reports, the accounts service refuses
# banned players new passes, and this panel is its only writer. Everything
# is rewritten whole and swapped in atomically - the file is small and there
# is exactly one writer.

BANS_PATH = os.path.join(LOBBY_STATE, "bans.json")
ACCOUNT_RE = re.compile(r"^u_[a-z0-9]{1,38}$")
BAN_ROOM_RE = re.compile(r"^[A-Z]{3,10}-[A-Z]{3,10}-\d{1,3}$")
BAN_NAME_MAX = 18           # what the game allows at the table
BAN_REASON_MAX = 120


def read_bans() -> dict:
    """The bans file, reduced to exactly two shapes: a list and a dict."""
    try:
        with open(BANS_PATH, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    bans, closed = data.get("bans"), data.get("closed")
    return {
        "bans": [b for b in bans if isinstance(b, dict)] if isinstance(bans, list) else [],
        "closed": {str(k): v for k, v in closed.items() if isinstance(v, (int, float))}
        if isinstance(closed, dict) else {},
    }


def write_bans(data: dict) -> None:
    os.makedirs(LOBBY_STATE, exist_ok=True)
    tmp = BANS_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=1)
    try:
        os.chmod(tmp, 0o640)   # the accounts service reads it group-only
    except OSError:
        pass
    os.replace(tmp, BANS_PATH)


def _clean(value: object, limit: int) -> str:
    text = "".join(ch for ch in str(value or "") if ch.isprintable())
    return " ".join(text.split())[:limit]


def add_ban(body: dict, by: str) -> tuple[int, dict]:
    kind = str(body.get("kind") or "")
    reason = _clean(body.get("reason"), BAN_REASON_MAX)
    data = read_bans()
    if kind == "account":
        uid = _clean(body.get("id"), 40)
        if not ACCOUNT_RE.fullmatch(uid):
            return 400, {"error": "an account ban needs the player's id (u_...)"}
        name = _clean(body.get("name"), BAN_NAME_MAX)
    elif kind == "name":
        name = _clean(body.get("name") or body.get("id"), BAN_NAME_MAX)
        if not name:
            return 400, {"error": "a name ban needs the name"}
        uid = name.lower()
    else:
        return 400, {"error": "kind must be account or name"}
    data["bans"] = [b for b in data["bans"]
                    if not (b.get("kind") == kind and b.get("id") == uid)]
    data["bans"].append({"kind": kind, "id": uid, "name": name, "reason": reason,
                         "by": by, "at": int(time.time())})
    write_bans(data)
    return 200, {"ok": True, **read_bans()}


def remove_ban(body: dict) -> tuple[int, dict]:
    kind = str(body.get("kind") or "")
    uid = _clean(body.get("id"), 40)
    if kind == "name":
        uid = uid.lower()
    data = read_bans()
    keep = [b for b in data["bans"] if not (b.get("kind") == kind and b.get("id") == uid)]
    if len(keep) == len(data["bans"]):
        return 404, {"error": "no such ban"}
    data["bans"] = keep
    write_bans(data)
    return 200, {"ok": True, **read_bans()}


def set_room_closed(body: dict, closed: bool) -> tuple[int, dict]:
    room_id = _clean(body.get("id"), 40).upper()
    if not BAN_ROOM_RE.fullmatch(room_id):
        return 400, {"error": "not a room code"}
    data = read_bans()
    if closed:
        data["closed"][room_id] = time.time()
    else:
        if room_id not in data["closed"]:
            return 404, {"error": "that room is not closed"}
        data["closed"].pop(room_id)
    write_bans(data)
    return 200, {"ok": True, **read_bans()}


# ------------------------------------------------------------------- host --

def host() -> dict:
    try:
        load = open("/proc/loadavg").read().split()[:3]
    except Exception:
        load = []
    mem = {}
    try:
        for line in open("/proc/meminfo"):
            k, _, v = line.partition(":")
            if k in ("MemTotal", "MemAvailable"):
                mem[k] = int(v.strip().split()[0]) // 1024
    except Exception:
        pass
    try:
        up = float(open("/proc/uptime").read().split()[0])
    except Exception:
        up = 0.0
    du = shutil.disk_usage("/")
    return {
        "load": load,
        "mem_total_mb": mem.get("MemTotal"),
        "mem_available_mb": mem.get("MemAvailable"),
        "disk_used_gb": round((du.total - du.free) / 2**30, 1),
        "disk_total_gb": round(du.total / 2**30, 1),
        "uptime_s": int(up),
    }


def snapshot() -> dict:
    return {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "tables": tables(),
        "services": services(),
        "cert": cert(),
        "turn": turn(),
        "nginx": nginx(),
        "host": host(),
    }


# ------------------------------------------------------------------- http --

SESSION_COOKIE = "opspanel"
SESSION_TTL = 12 * 3600


class Handler(BaseHTTPRequestHandler):
    # -- plumbing ----------------------------------------------------------
    def _send(self, code, body: bytes, ctype, extra: list[tuple[str, str]] = ()):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in extra:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _redirect(self, to: str, extra=()):
        self._send(302, b"", "text/plain", [("Location", to), *extra])

    @property
    def public(self) -> bool:
        """Set by nginx, and stripped from the client's request by it."""
        return self.headers.get("X-Panel-Public") == "1"

    def _cookie(self, name: str) -> str:
        raw = self.headers.get("Cookie", "")
        for part in raw.split(";"):
            k, _, v = part.strip().partition("=")
            if k == name:
                return v
        return ""

    def _session_email(self) -> str | None:
        email = read_token(self._cookie(SESSION_COOKIE), "session")
        return email if email and allowed(email) else None

    def _set_session(self, email: str) -> tuple[str, str]:
        tok = make_token("session", email, SESSION_TTL)
        path = urllib.parse.urlparse(base_url()).path or "/"
        return ("Set-Cookie",
                f"{SESSION_COOKIE}={tok}; Path={path}; Max-Age={SESSION_TTL}; "
                f"HttpOnly; Secure; SameSite=Lax")

    def _deny(self, why: str, code: int = 403):
        self._send(code, LOGIN_PAGE.replace("__MSG__", why)
                   .replace("__GOOGLE__", "")
                   .replace("__EMAIL__", "none").encode(),
                   "text/html; charset=utf-8")

    # -- routing -----------------------------------------------------------
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)

        # Over the tunnel there is nothing to gate.
        if not self.public:
            return self._serve(path)

        modes = auth_modes()
        if not (modes["google"] or modes["email"]):
            # Fail closed. An unconfigured panel on a public URL must not be
            # an open one.
            return self._deny(
                "Public access is not configured on this panel. "
                "Reach it over the SSH tunnel instead.", 503)

        if path == "/auth/google":
            return self._redirect(google_login_url()) if modes["google"] else self._deny("Google sign-in is not configured.")

        if path == "/auth/google/callback":
            if not read_token(query.get("state", [""])[0], "state"):
                return self._deny("That sign-in attempt expired or did not start here. Try again.")
            email = google_exchange(query.get("code", [""])[0])
            if not email:
                return self._deny("Google did not confirm that sign-in.")
            if not allowed(email):
                return self._deny(f"{email} is not on the allowlist for this panel.")
            return self._redirect(base_url() + "/", [self._set_session(email)])

        if path == "/auth/magic":
            email = read_token(query.get("token", [""])[0], "magic", single_use=True)
            if not email or not allowed(email):
                return self._deny("That link has expired or was already used. Ask for another.")
            return self._redirect(base_url() + "/", [self._set_session(email)])

        if path == "/auth/logout":
            return self._redirect(base_url() + "/", [(
                "Set-Cookie",
                f"{SESSION_COOKIE}=; Path={urllib.parse.urlparse(base_url()).path or '/'};"
                " Max-Age=0; HttpOnly; Secure; SameSite=Lax")])

        if not self._session_email():
            page = (LOGIN_PAGE
                    .replace("__MSG__", "")
                    .replace("__GOOGLE__", "block" if modes["google"] else "none")
                    .replace("__EMAIL__", "block" if modes["email"] else "none"))
            return self._send(200, page.encode(), "text/html; charset=utf-8")

        return self._serve(path)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/api/"):
            return self._admin_post(path)
        if not self.public or path != "/auth/email":
            return self._send(404, b"not found", "text/plain")
        if not auth_modes()["email"]:
            return self._deny("Email sign-in is not configured.")
        length = min(int(self.headers.get("Content-Length") or 0), 2048)
        form = urllib.parse.parse_qs(self.rfile.read(length).decode("utf-8", "replace"))
        email = form.get("email", [""])[0].strip()
        ok, note = send_magic_link(email)
        msg = ("If that address is allowed here, a sign-in link is on its way. "
               "It works once and expires in 10 minutes.") if ok else note
        page = (LOGIN_PAGE.replace("__MSG__", msg)
                .replace("__GOOGLE__", "block" if auth_modes()["google"] else "none")
                .replace("__EMAIL__", "block"))
        self._send(200, page.encode(), "text/html; charset=utf-8")

    def _serve(self, path: str):
        if path.startswith("/api/stats"):
            return self._send(200, json.dumps(snapshot()).encode(), "application/json")
        if path.startswith("/api/live"):
            # The fast poll: just the tables and the moderation file, none of
            # the journald/nginx/host work the full snapshot does.
            live = {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "tables": tables(), "moderation": read_bans()}
            return self._send(200, json.dumps(live).encode(), "application/json")
        if path in ("/", "/index.html"):
            who = self._session_email() if self.public else None
            page = PAGE.replace("__WHO__", f"{who} · <a href='{base_url()}/auth/logout'>sign out</a>" if who else "")
            return self._send(200, page.encode(), "text/html; charset=utf-8")
        return self._send(404, b"not found", "text/plain")

    # -- the controls -------------------------------------------------------
    # Same two ways in as the page itself (tunnel, or an allowlisted session
    # on the public route), plus one header a cross-site request cannot send.
    def _admin_ok(self) -> bool:
        if self.headers.get("X-Ops-Admin") != "1":
            return False
        return not self.public or self._session_email() is not None

    def _admin_post(self, path: str):
        def reply(code: int, payload: dict):
            self._send(code, json.dumps(payload).encode(), "application/json")

        if not self._admin_ok():
            return reply(403, {"error": "not allowed"})
        length = min(int(self.headers.get("Content-Length") or 0), 4096)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            return reply(400, {"error": "bad json"})
        if not isinstance(body, dict):
            return reply(400, {"error": "bad body"})
        who = self._session_email() or "tunnel"
        try:
            if path == "/api/ban":
                code, out = add_ban(body, who)
            elif path == "/api/unban":
                code, out = remove_ban(body)
            elif path == "/api/close":
                code, out = set_room_closed(body, True)
            elif path == "/api/reopen":
                code, out = set_room_closed(body, False)
            else:
                return reply(404, {"error": "not found"})
        except OSError:
            return reply(500, {"error": "could not write the bans file"})
        return reply(code, out)

    def log_message(self, *_):
        pass  # the panel watching the logs should not be filling them


LOGIN_PAGE = r"""<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Sign in · Party Hall ops</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23111814'/%3E%3Ccircle cx='32' cy='32' r='13' fill='%23e0a93b'/%3E%3C/svg%3E">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<style>
  :root{
    --bg-app:#0a0f0c;--bg-surface:#111814;--bg-raised:#18211c;--border:#223029;--border-strong:#2f4038;
    --text:#eef3f0;--text-muted:#b4c2bb;--text-faint:#8fa198;--accent:#e0a93b;--accent-text:#f0c877;--on-accent:#1b1406;
    --accent-soft:color-mix(in oklab,var(--accent) 16%,transparent);
    --font-ui:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    --t-xs:.8rem;--t-sm:.875rem;--t-md:1rem;--t-lg:1.25rem;
    --s-2:8px;--s-3:12px;--s-4:16px;--s-5:24px;--s-6:32px;
    --r-md:10px;--r-lg:16px;--hit:48px;
    --e-2:0 2px 4px rgb(0 0 0/.28),0 16px 40px -12px rgb(0 0 0/.55),inset 0 1px 0 rgb(255 255 255/.05);
    --ring:0 0 0 2px var(--bg-surface),0 0 0 4px var(--accent);
    --dur-fast:120ms;--ease-out:cubic-bezier(.22,1,.36,1);
  }
  @media (prefers-color-scheme:light){
    :root{--bg-app:#f3efe6;--bg-surface:#fffdf8;--bg-raised:#f6f1e7;--border:#e4dccb;--border-strong:#cdc1a8;
      --text:#1b221e;--text-muted:#44514a;--text-faint:#5b6861;--accent:#74500f;--accent-text:#74500f;--on-accent:#fffdf8;
      --e-2:0 1px 3px rgb(60 45 20/.08),0 16px 36px -14px rgb(60 45 20/.22),inset 0 1px 0 rgb(255 255 255/.8)}
  }
  *{box-sizing:border-box}
  html{font-size:16px}
  body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:var(--s-5) var(--s-4);
       background:radial-gradient(90% 60% at 50% -10%,var(--accent-soft),transparent 70%),var(--bg-app);
       color:var(--text);font:400 var(--t-md)/1.55 var(--font-ui);-webkit-font-smoothing:antialiased}
  .box{width:min(400px,100%);padding:var(--s-6) var(--s-5);border-radius:var(--r-lg);
       background:var(--bg-surface);border:1px solid var(--border);box-shadow:var(--e-2)}
  .brand{margin:0 0 var(--s-2);font-size:var(--t-sm);font-weight:750;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-text)}
  h1{margin:0 0 var(--s-5);font-size:var(--t-lg);font-weight:680;letter-spacing:-.01em}
  .msg{margin-bottom:var(--s-4);padding:var(--s-3) var(--s-4);border-radius:var(--r-md);background:var(--bg-raised);
       border:1px solid var(--border-strong);color:var(--text-muted);font-size:var(--t-sm)}
  a.btn,button{display:flex;align-items:center;justify-content:center;width:100%;min-height:var(--hit);padding:0 var(--s-4);
       border-radius:var(--r-md);border:1px solid transparent;font:inherit;font-weight:650;text-decoration:none;cursor:pointer;
       transition:filter var(--dur-fast) var(--ease-out),transform var(--dur-fast) var(--ease-out)}
  a.btn{background:var(--accent);color:var(--on-accent)}
  button{background:var(--bg-raised);color:var(--text);border-color:var(--border-strong)}
  a.btn:hover,button:hover{filter:brightness(1.08)}
  a.btn:active,button:active{transform:translateY(1px)}
  :focus-visible{outline:none;box-shadow:var(--ring)}
  input{width:100%;min-height:var(--hit);margin-bottom:var(--s-3);padding:0 var(--s-4);border-radius:var(--r-md);
        border:1px solid var(--border-strong);background:var(--bg-app);color:var(--text);font:inherit}
  input::placeholder{color:var(--text-faint)}
  .or{display:flex;align-items:center;gap:var(--s-3);margin:var(--s-4) 0;color:var(--text-faint);font-size:var(--t-xs)}
  .or::before,.or::after{content:"";flex:1;height:1px;background:var(--border)}
  .foot{margin:var(--s-5) 0 0;color:var(--text-faint);font-size:var(--t-sm);line-height:1.5}
  @media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
<main class="box">
  <p class="brand">Party Hall · ops</p>
  <h1>Sign in to the status panel</h1>
  <div class="msg" role="status">__MSG__</div>
  <a class="btn" href="auth/google" style="display:__GOOGLE__">Continue with Google</a>
  <div class="or" style="display:__EMAIL__">or</div>
  <form method="post" action="auth/email" style="display:__EMAIL__">
    <input type="email" name="email" placeholder="you@example.com" required autocomplete="email" aria-label="Email address">
    <button type="submit">Email me a sign-in link</button>
  </form>
  <p class="foot">Only allowlisted addresses can open this panel. Signing in proves who you are; it does not by itself grant access.</p>
</main>
<script>
  var m = document.querySelector('.msg');
  m.style.display = m.textContent.trim() ? 'block' : 'none';
  // An inline display:none on the Google link would hide it; "" and "block" both mean shown.
  var g = document.querySelector('a.btn');
  if (g.style.display === '') g.style.display = 'flex';
  else if (g.style.display === 'block') g.style.display = 'flex';
</script>
</html>
"""


PAGE = r"""<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Party Hall · ops</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23111814'/%3E%3Ccircle cx='32' cy='32' r='13' fill='%23e0a93b'/%3E%3C/svg%3E">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<style>
/* Concept: a night-shift control room for the card table - felt-black
   surfaces, brass instrument numerals, calm and readable at arm's length
   on a phone. Every colour, size and duration below is a token; the
   components further down use only these. */
:root{
  /* palette */
  --n-0:#0a0f0c;--n-10:#111814;--n-20:#18211c;--n-30:#223029;--n-40:#2f4038;
  --n-70:#8fa198;--n-80:#b4c2bb;--n-100:#eef3f0;
  --brass-300:#f0c877;--brass-500:#e0a93b;
  --green-400:#5fd49a;--amber-400:#f0b64a;--red-400:#f07a7a;

  /* semantic */
  --bg-app:var(--n-0);--bg-surface:var(--n-10);--bg-raised:var(--n-20);
  --border:var(--n-30);--border-strong:var(--n-40);
  --text:var(--n-100);--text-muted:var(--n-80);--text-faint:var(--n-70);
  --accent:var(--brass-500);--accent-text:var(--brass-300);
  --good:var(--green-400);--warn:var(--amber-400);--bad:var(--red-400);
  --accent-soft:color-mix(in oklab,var(--accent) 16%,transparent);
  --good-soft:color-mix(in oklab,var(--good) 15%,transparent);
  --warn-soft:color-mix(in oklab,var(--warn) 15%,transparent);
  --bad-soft:color-mix(in oklab,var(--bad) 15%,transparent);
  --bar:var(--brass-500);
  --header-bg:color-mix(in oklab,var(--n-0) 84%,transparent);
  --skeleton:color-mix(in oklab,var(--n-40) 50%,transparent);
  --shine:color-mix(in oklab,var(--n-100) 7%,transparent);

  /* type: 1.25 ratio */
  --font-ui:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
  --font-mono:ui-monospace,"SF Mono","Cascadia Mono",Consolas,monospace;
  --t-xs:.8rem;--t-sm:.875rem;--t-md:1rem;--t-lg:1.25rem;--t-xl:1.563rem;--t-2xl:1.953rem;

  /* space */
  --s-1:4px;--s-2:8px;--s-3:12px;--s-4:16px;--s-5:24px;--s-6:32px;--s-7:48px;
  --gutter:clamp(12px,3.2vw,32px);
  --hit:44px;
  --header-h:112px;

  /* radius: tight controls, soft surfaces */
  --r-sm:6px;--r-md:10px;--r-lg:16px;--r-pill:999px;

  /* elevation */
  --e-1:0 1px 2px rgb(0 0 0/.3),inset 0 1px 0 rgb(255 255 255/.04);
  --e-2:0 2px 4px rgb(0 0 0/.28),0 10px 28px -8px rgb(0 0 0/.45),inset 0 1px 0 rgb(255 255 255/.05);
  --ring:0 0 0 2px var(--bg-app),0 0 0 4px var(--accent);

  /* motion */
  --dur-fast:120ms;--dur-mid:240ms;--dur-slow:420ms;
  --ease-out:cubic-bezier(.22,1,.36,1);
  --stagger:45ms;
}
@media (prefers-color-scheme:light){
  :root{
    --bg-app:#f3efe6;--bg-surface:#fffdf8;--bg-raised:#f6f1e7;
    --border:#e4dccb;--border-strong:#cdc1a8;
    --text:#1b221e;--text-muted:#44514a;--text-faint:#5b6861;
    --accent:#b07d22;--accent-text:#74500f;
    --good:#1b7547;--warn:#8a5905;--bad:#b02f2c;
    --bar:#c08a2c;
    --header-bg:color-mix(in oklab,#f3efe6 88%,transparent);
    --skeleton:#e8e0d0;
    --shine:rgb(255 255 255/.6);
    --e-1:0 1px 2px rgb(60 45 20/.08),inset 0 1px 0 rgb(255 255 255/.7);
    --e-2:0 1px 3px rgb(60 45 20/.08),0 10px 26px -10px rgb(60 45 20/.2),inset 0 1px 0 rgb(255 255 255/.8);
  }
}

/* ---------------------------------------------------------------- base */
*{box-sizing:border-box}
html{font-size:15px;-webkit-text-size-adjust:100%;scroll-behavior:smooth}
@media (max-width:640px){html{font-size:16px}}
body{margin:0;min-height:100dvh;background:var(--bg-app);color:var(--text);
     font:400 var(--t-md)/1.55 var(--font-ui);-webkit-font-smoothing:antialiased;touch-action:manipulation}
body::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;
     background:radial-gradient(90% 50% at 50% -12%,var(--accent-soft),transparent 70%)}
a{color:var(--accent-text);text-underline-offset:3px}
:focus-visible{outline:none;box-shadow:var(--ring);border-radius:var(--r-sm)}
code{font-family:var(--font-mono);font-size:.92em}
.num{font-variant-numeric:tabular-nums}
.muted{color:var(--text-muted)}.faint{color:var(--text-faint)}.bad{color:var(--bad)}

/* -------------------------------------------------------------- header */
.bar{position:sticky;top:0;z-index:10;background:var(--header-bg);
     -webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border-bottom:1px solid var(--border)}
.bar__in{max-width:1440px;margin:0 auto;padding:var(--s-3) var(--gutter) 0;
     display:flex;flex-wrap:wrap;align-items:center;gap:var(--s-2) var(--s-4)}
.brand{margin:0;font-size:var(--t-sm);font-weight:750;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-text)}
.brand span{color:var(--text-faint);font-weight:500;letter-spacing:.08em}
.live{display:inline-flex;align-items:center;gap:var(--s-2);font-size:var(--t-sm);color:var(--text-muted);white-space:nowrap}
.pulse{position:relative;width:9px;height:9px;border-radius:50%;background:var(--text-faint);flex:none}
.pulse::after{content:"";position:absolute;inset:0;border-radius:inherit;background:inherit;opacity:0}
.live[data-state="ok"] .pulse{background:var(--good)}
.live[data-state="ok"] .pulse::after{animation:ping 2s var(--ease-out) infinite}
.live[data-state="stale"] .pulse{background:var(--warn)}
.live[data-state="error"] .pulse{background:var(--bad)}
.live[data-state="error"]{color:var(--bad)}
@keyframes ping{from{transform:scale(1);opacity:.55}to{transform:scale(2.8);opacity:0}}
.who{margin-left:auto;min-width:0;max-width:100%;font-size:var(--t-sm);color:var(--text-faint);
     overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.who:empty{display:none}
.nav{flex-basis:100%;display:flex;gap:var(--s-1);overflow-x:auto;scrollbar-width:none;
     margin:0 calc(var(--gutter)*-1);padding:var(--s-2) var(--gutter)}
.nav::-webkit-scrollbar{display:none}
.nav a{flex:none;display:inline-flex;align-items:center;min-height:36px;padding:0 var(--s-4);border-radius:var(--r-pill);
     border:1px solid transparent;color:var(--text-muted);font-size:var(--t-sm);font-weight:600;text-decoration:none;
     transition:background-color var(--dur-fast) var(--ease-out),color var(--dur-fast) var(--ease-out)}
.nav a:hover{background:var(--bg-raised);color:var(--text)}
.nav a[aria-current="true"]{background:var(--accent-soft);color:var(--accent-text);
     border-color:color-mix(in oklab,var(--accent) 35%,transparent)}
@media (pointer:coarse){.nav a{min-height:var(--hit)}}

/* -------------------------------------------------------------- layout */
.wrap{max-width:1440px;margin:0 auto;padding:var(--s-5) var(--gutter) var(--s-7)}
main section{margin-bottom:var(--s-6);scroll-margin-top:var(--header-h)}
.sec-h{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--s-2) var(--s-3);margin:0 0 var(--s-3)}
h2{margin:0;font-size:var(--t-xl);font-weight:680;letter-spacing:-.015em;line-height:1.2;text-wrap:balance}
.count{align-self:center;padding:1px 10px;border-radius:var(--r-pill);background:var(--accent-soft);
     color:var(--accent-text);font-size:var(--t-sm);font-weight:700}
.sec-note{color:var(--text-faint);font-size:var(--t-sm)}
.panel,.card,.kpi,.tcard,.rows{background:var(--bg-surface);border:1px solid var(--border)}
.panel{border-radius:var(--r-lg);box-shadow:var(--e-2);padding:var(--s-4);min-width:0}
@media (min-width:900px){.panel{padding:var(--s-5)}}

.banner{margin-bottom:var(--s-4);padding:var(--s-3) var(--s-4);border-radius:var(--r-md);border:1px solid;font-size:var(--t-sm);line-height:1.5}
.banner--bad{background:var(--bad-soft);border-color:color-mix(in oklab,var(--bad) 40%,transparent)}
.banner--warn{background:var(--warn-soft);border-color:color-mix(in oklab,var(--warn) 40%,transparent)}
.banner--bad b{color:var(--bad)}.banner--warn b{color:var(--warn)}

.empty{padding:var(--s-6) var(--s-4);border:1px dashed var(--border-strong);border-radius:var(--r-lg);
     text-align:center;color:var(--text-muted);font-size:var(--t-sm)}
.empty b{display:block;margin-bottom:var(--s-1);color:var(--text);font-size:var(--t-lg);font-weight:650}

/* ---------------------------------------------------------------- kpis */
.kpis{display:grid;gap:var(--s-3);grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr))}
@media (max-width:520px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s-2)}}
.kpi{min-width:0;padding:var(--s-3) var(--s-4);border-radius:var(--r-md);box-shadow:var(--e-1)}
.kpi__v{font-size:var(--t-2xl);font-weight:680;line-height:1.1;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.kpi__k{margin-top:var(--s-1);font-size:var(--t-sm);font-weight:600;color:var(--text-muted);line-height:1.3}
.kpi__h{margin-top:2px;font-size:var(--t-xs);color:var(--text-faint);line-height:1.35}
.kpi--accent{border-color:color-mix(in oklab,var(--accent) 45%,transparent);
     background:linear-gradient(180deg,var(--accent-soft),transparent 85%),var(--bg-surface)}
.kpi--accent .kpi__v{color:var(--accent-text)}
.kpi--bad .kpi__v{color:var(--bad)}
.chips{display:flex;flex-wrap:wrap;gap:var(--s-2);margin-top:var(--s-3)}

/* ---------------------------------------------------------------- tags */
.tags{display:flex;flex-wrap:wrap;gap:var(--s-1)}
.tag{display:inline-flex;align-items:center;min-height:22px;padding:0 9px;border-radius:var(--r-pill);
     border:1px solid var(--border-strong);color:var(--text-muted);font-size:var(--t-xs);font-weight:650;
     line-height:1;white-space:nowrap}
.tag--good{color:var(--good);background:var(--good-soft);border-color:transparent}
.tag--warn{color:var(--warn);background:var(--warn-soft);border-color:transparent}
.tag--bad{color:var(--bad);background:var(--bad-soft);border-color:transparent}
.tag--accent{color:var(--accent-text);background:var(--accent-soft);border-color:transparent}

/* --------------------------------------------------------- table cards */
.cards{display:grid;gap:var(--s-3);align-items:start;grid-template-columns:repeat(auto-fill,minmax(min(100%,330px),1fr))}
.tcard{display:flex;flex-direction:column;gap:var(--s-3);min-width:0;padding:var(--s-4);border-radius:var(--r-lg);box-shadow:var(--e-2)}
.tcard__head{display:flex;align-items:center;justify-content:space-between;gap:var(--s-2);min-width:0}
.code{min-width:0;font-family:var(--font-mono);font-size:var(--t-md);font-weight:650;color:var(--accent-text);
     overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.game{flex:none;font-size:var(--t-sm);font-weight:650;color:var(--text-muted)}
.status{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s-1) var(--s-3);font-size:var(--t-sm)}
.seats{list-style:none;margin:0;padding:0;border-top:1px solid var(--border)}
.seat{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:var(--s-3);
     padding:var(--s-2) 0;border-bottom:1px solid var(--border)}
.seat__dot{width:11px;height:11px;border-radius:50%;box-shadow:0 0 0 2px var(--bg-surface),0 0 0 3px var(--border-strong)}
.seat__who{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s-1) var(--s-2);min-width:0}
.seat__name{max-width:100%;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.seat__cash{font-weight:650;color:var(--text-muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.seat[data-off] .seat__name,.seat[data-off] .seat__dot{opacity:.55}
.seat[data-out] .seat__name{color:var(--text-faint);text-decoration:line-through}
.tcard__foot{margin-top:auto;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--s-2);
     font-size:var(--t-xs);color:var(--text-faint)}

/* -------------------------------------------------------------- charts */
.charts{display:grid;gap:var(--s-3);margin-top:var(--s-3);grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr))}
.chart__h{display:flex;flex-wrap:wrap;justify-content:space-between;gap:var(--s-1) var(--s-3);margin-bottom:var(--s-4);
     font-size:var(--t-sm);color:var(--text-faint)}
.chart__h b{color:var(--text);font-weight:650}
.plot{position:relative;height:130px;display:flex;align-items:flex-end;gap:2px;border-bottom:1px solid var(--border-strong)}
.plot>i{flex:1;min-width:1px;border-radius:3px 3px 0 0;background:var(--bar)}
.plot__max{position:absolute;top:-2px;left:0;padding-right:var(--s-1);background:var(--bg-surface);font-size:var(--t-xs);color:var(--text-faint)}
.plot__max::after{content:"";position:absolute;left:100%;top:50%;width:9999px;border-top:1px dashed var(--border)}
.plot{overflow:hidden}
.plot--empty{align-items:center;justify-content:center;color:var(--text-faint);font-size:var(--t-sm)}
.axis{display:flex;justify-content:space-between;margin-top:var(--s-1);font-size:var(--t-xs);color:var(--text-faint)}
.days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:var(--s-2);height:150px}
.day{display:flex;flex-direction:column;align-items:center;gap:var(--s-1);min-width:0}
.day__v{min-height:1.2em;font-size:var(--t-xs);font-weight:650;color:var(--text-muted)}
.day__track{flex:1;width:100%;display:flex;align-items:flex-end;justify-content:center;border-bottom:1px solid var(--border-strong)}
.day__bar{display:block;width:100%;max-width:42px;border-radius:4px 4px 0 0;background:var(--bar)}
.day__k{font-size:var(--t-xs);color:var(--text-faint);white-space:nowrap}
.day[data-today] .day__k{color:var(--accent-text);font-weight:650}

/* ---------------------------------------------------------- list rows */
.rows{border-radius:var(--r-lg);box-shadow:var(--e-2);overflow:hidden}
.erow{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1.5fr) minmax(0,1.2fr) minmax(0,.85fr);
     align-items:center;gap:var(--s-2) var(--s-4);padding:var(--s-3) var(--s-4);border-bottom:1px solid var(--border)}
.erow:last-child{border-bottom:0}
.erow--head{padding-block:var(--s-2);background:var(--bg-raised);font-size:var(--t-xs);font-weight:700;
     letter-spacing:.08em;text-transform:uppercase;color:var(--text-faint)}
.e-id{display:flex;flex-direction:column;gap:var(--s-1);min-width:0}
.e-who,.e-res{min-width:0;font-size:var(--t-sm);overflow-wrap:anywhere}
.e-when{display:flex;flex-direction:column;font-size:var(--t-sm)}
@media (max-width:860px){
  .erow{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"id when" "who who" "res res"}
  .erow--head{display:none}
  .e-id{grid-area:id}.e-who{grid-area:who}.e-res{grid-area:res}
  .e-when{grid-area:when;align-self:start;text-align:right}
}

.feed{list-style:none;margin:0;padding:0;max-height:min(480px,70vh);overflow-y:auto;overscroll-behavior:contain}
.feed li{display:grid;grid-template-columns:3.4em minmax(0,1fr);gap:var(--s-3);padding:var(--s-2) var(--s-4);
     border-bottom:1px solid var(--border);font-size:var(--t-sm);line-height:1.5}
.feed li:last-child{border-bottom:0}
.feed time{color:var(--text-faint);font-variant-numeric:tabular-nums}
.feed .code{font-size:var(--t-sm)}
.ev{display:inline-block;width:8px;height:8px;margin-right:var(--s-2);border-radius:50%;vertical-align:1px;background:var(--text-faint)}
.ev--good{background:var(--good)}.ev--warn{background:var(--warn)}.ev--bad{background:var(--bad)}.ev--accent{background:var(--accent)}

/* -------------------------------------------------------------- server */
.grid{display:grid;gap:var(--s-3);grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))}
.card{min-width:0;padding:var(--s-4);border-radius:var(--r-lg);box-shadow:var(--e-1)}
.card h3{margin:0 0 var(--s-3);font-size:var(--t-xs);font-weight:750;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted)}
.row{display:flex;justify-content:space-between;gap:var(--s-3);padding:7px 0;border-bottom:1px solid var(--border);font-size:var(--t-sm)}
.row:last-child{border-bottom:0}
.row>:first-child{min-width:0;color:var(--text-muted)}
.row>:last-child{min-width:0;text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.big{font-size:var(--t-2xl);font-weight:680;line-height:1.1;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.big small{font-size:var(--t-sm);font-weight:500;letter-spacing:0;color:var(--text-faint)}
.note{margin-top:var(--s-3);padding-top:var(--s-3);border-top:1px solid var(--border);font-size:var(--t-xs);line-height:1.5;color:var(--text-faint)}
.dot{display:inline-block;width:9px;height:9px;margin-right:var(--s-2);border-radius:50%;vertical-align:1px}
.dot--good{background:var(--good)}.dot--warn{background:var(--warn)}.dot--bad{background:var(--bad)}
.card .plot{height:64px;margin:var(--s-3) 0}
.paths{width:100%;border-collapse:collapse;table-layout:fixed;font-size:var(--t-sm)}
.paths td{padding:6px 0;border-bottom:1px solid var(--border)}
.paths tr:last-child td{border-bottom:0}
.paths td:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--font-mono);font-size:var(--t-xs);color:var(--text-muted)}
.paths td:last-child{width:4.5em;text-align:right;font-variant-numeric:tabular-nums}
.foot{padding-top:0;color:var(--text-faint);font-size:var(--t-xs);line-height:1.6}

/* --------------------------------------------------------- admin controls */
.act{display:inline-flex;align-items:center;justify-content:center;min-height:26px;padding:0 10px;
     border-radius:var(--r-pill);border:1px solid var(--border-strong);background:transparent;
     color:var(--text-muted);font:inherit;font-size:var(--t-xs);font-weight:650;cursor:pointer;
     white-space:nowrap;transition:color var(--dur-fast) var(--ease-out),background-color var(--dur-fast) var(--ease-out),border-color var(--dur-fast) var(--ease-out)}
@media (pointer:coarse){.act{min-height:32px}}
.act:hover{color:var(--text);background:var(--bg-raised)}
.act--bad{color:var(--bad);border-color:color-mix(in oklab,var(--bad) 45%,transparent)}
.act--bad:hover{background:var(--bad-soft);color:var(--bad)}
.act--good{color:var(--good);border-color:color-mix(in oklab,var(--good) 45%,transparent)}
.act--good:hover{background:var(--good-soft);color:var(--good)}
.tcard__acts{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:var(--s-2)}
.seat__side{display:inline-flex;align-items:center;gap:var(--s-2)}
.orow{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1.3fr) minmax(0,.6fr) auto;
      align-items:center;gap:var(--s-2) var(--s-3);padding:var(--s-2) var(--s-4);
      border-bottom:1px solid var(--border);font-size:var(--t-sm)}
.orow:last-child{border-bottom:0}
.orow--head{padding-block:var(--s-2);background:var(--bg-raised);font-size:var(--t-xs);font-weight:700;
      letter-spacing:.08em;text-transform:uppercase;color:var(--text-faint)}
.orow[data-off] .o-who{opacity:.55}
.o-who{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s-1) var(--s-2);min-width:0}
.o-where{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.o-act{text-align:right}
@media (max-width:720px){
  .orow{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"who act" "where act"}
  .orow--head{display:none}
  .o-who{grid-area:who}.o-where{grid-area:where}.o-act{grid-area:act}
  .orow>:nth-child(3){display:none}
}
.banform{display:flex;flex-wrap:wrap;gap:var(--s-2)}
.banform select,.banform input{min-height:40px;padding:0 var(--s-3);border-radius:var(--r-md);
      border:1px solid var(--border-strong);background:var(--bg-app);color:var(--text);font:inherit;font-size:var(--t-sm)}
.banform input{flex:1;min-width:130px}
.banform button{min-height:40px;padding:0 var(--s-4);border-radius:var(--r-md);cursor:pointer;
      border:1px solid color-mix(in oklab,var(--bad) 45%,transparent);background:var(--bad-soft);
      color:var(--bad);font:inherit;font-size:var(--t-sm);font-weight:700}

/* ----------------------------------------------------- loading + motion */
.sk{position:relative;overflow:hidden;border-radius:var(--r-md);background:var(--skeleton)}
.sk::after{content:"";position:absolute;inset:0;transform:translateX(-100%);
     background:linear-gradient(90deg,transparent,var(--shine),transparent);animation:shimmer 1.4s var(--ease-out) infinite}
.sk--kpi{height:94px}.sk--card{height:230px;border-radius:var(--r-lg)}.sk--title{width:180px;height:26px;margin-bottom:var(--s-3)}
@keyframes shimmer{to{transform:translateX(100%)}}
/* Entrance only on the first render; the five-second refresh must not replay it. */
.first .reveal{animation:rise var(--dur-slow) var(--ease-out) both;animation-delay:calc(var(--i,0)*var(--stagger))}
@keyframes rise{from{opacity:0;transform:translateY(8px)}}
@media (prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  *,*::before,*::after{animation:none!important;transition:none!important}
}
</style>

<header class="bar">
  <div class="bar__in">
    <p class="brand">Party Hall <span>· ops</span></p>
    <span class="live" id="live" data-state="loading"><i class="pulse" aria-hidden="true"></i><span id="liveText">Loading…</span></span>
    <span class="who" id="who">__WHO__</span>
    <nav class="nav" aria-label="Sections">
      <a href="#overview">Now</a><a href="#online">Online</a><a href="#live-tables">Tables</a><a href="#bans">Moderation</a><a href="#today">24 hours</a><a href="#ended">Ended</a><a href="#activity">Activity</a><a href="#server">Server</a>
    </nav>
  </div>
</header>

<main class="wrap">
  <div id="banners" aria-live="polite"></div>
  <section id="overview" aria-busy="true">
    <div class="sk sk--title"></div>
    <div class="kpis"><div class="sk sk--kpi"></div><div class="sk sk--kpi"></div><div class="sk sk--kpi"></div><div class="sk sk--kpi"></div><div class="sk sk--kpi"></div><div class="sk sk--kpi"></div></div>
  </section>
  <section id="online"></section>
  <section id="live-tables">
    <div class="sk sk--title"></div>
    <div class="cards"><div class="sk sk--card"></div><div class="sk sk--card"></div></div>
  </section>
  <section id="bans">
    <div id="banHead"></div>
    <div class="panel">
      <form class="banform" id="banForm">
        <select name="kind" aria-label="Ban kind"><option value="name">Name</option><option value="account">Account</option></select>
        <input name="target" required maxlength="40" placeholder="name, or u_… for an account" aria-label="Who to ban">
        <input name="reason" maxlength="120" placeholder="reason (optional)">
        <button type="submit">Ban</button>
      </form>
    </div>
    <div id="banBody"></div>
  </section>
  <section id="today"></section>
  <section id="ended"></section>
  <section id="activity"></section>
  <section id="server"></section>
</main>
<footer class="wrap foot">Tables are reported by the host's browser every 20 seconds and whenever they change; a table that stops reporting for 90 seconds is closed as "went quiet". Bans and closed rooms are enforced on that same beat. Times are shown in this device's time zone.</footer>

<script>
const $ = id => document.getElementById(id);
// Quotes too: player names are typed by anyone and land in attributes.
const esc = s => String(s ?? "").replace(/[<&>"']/g, c => ({"<":"&lt;","&":"&amp;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtB = n => n == null ? "—" : n > 1e9 ? (n/1e9).toFixed(2) + " GB" : n > 1e6 ? (n/1e6).toFixed(1) + " MB" : n > 1e3 ? (n/1e3).toFixed(1) + " kB" : n + " B";
const dur = s => s == null ? "—" : s >= 86400 ? Math.floor(s/86400) + "d " + Math.floor(s%86400/3600) + "h"
  : s >= 3600 ? Math.floor(s/3600) + "h " + Math.floor(s%3600/60) + "m" : s >= 60 ? Math.floor(s/60) + "m" : Math.max(0, s) + "s";
const money = n => (n < 0 ? "−$" : "$") + Math.abs(n || 0).toLocaleString("en-US");
const hhmm = t => new Date(t * 1000).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", hour12: false});
const GAME = {monopoly: "Monopoly", cashflow: "Cashflow"};
const tag = (txt, tone = "") => `<span class="tag${tone ? " tag--" + tone : ""}">${esc(txt)}</span>`;
const modeTag = m => tag(m, m === "public" ? "accent" : "");
const deviceTag = d => tag(d === "mobile" ? "phone" : "desktop");
const phaseTag = t => t.phase === "lobby" ? tag("In lobby", "warn") : t.phase === "over" ? tag("Finished", "accent") : tag("Playing", "good");
const card = (title, html) => `<div class="card">${title ? `<h3>${title}</h3>` : ""}${html}</div>`;
const row = (k, v) => `<div class="row"><span>${k}</span><span>${v}</span></div>`;
const head = (title, extra = "") => `<div class="sec-h"><h2>${title}</h2>${extra}</div>`;
const kpis = items => `<div class="kpis">${items.map((x, i) =>
  `<div class="kpi reveal ${x.cls || ""}" style="--i:${i}"><div class="kpi__v">${x.v ?? "—"}</div><div class="kpi__k">${esc(x.k)}</div>${x.h ? `<div class="kpi__h">${x.h}</div>` : ""}</div>`).join("")}</div>`;
const people = ps => {
  const all = ps || [], h = all.filter(p => !p.bot).map(p => `<b>${esc(p.name)}</b>`), b = all.length - h.length;
  return (h.join(", ") || "No humans") + (b ? ` <span class="faint">+ ${b} bot${b > 1 ? "s" : ""}</span>` : "");
};

/* ---------------------------------------------------------- moderation */
/* M is the bans file as the panel wrote it: {bans: [...], closed: {...}}.
   The same matching rules run in the lobby service; here they only decide
   what is flagged and which buttons make sense. */
const bansOf = kind => M => new Set((M?.bans || []).filter(b => b.kind === kind).map(b => b.id));
const accountBans = bansOf("account"), nameBans = bansOf("name");
const roomClosed = (M, id) => {
  const at = (M?.closed || {})[id];
  return typeof at === "number" && Date.now() / 1000 - at < 86400;
};
/* A seat is certainly banned when its account is. A host seat additionally
   carries its name ban - a guest's name is never matched for them, because
   names are claimed, not owned. */
const seatBanned = (M, p) => p.id.startsWith("u_") && accountBans(M).has(p.id);
const hostNameBanned = (M, t) => {
  const h = (t.players || []).find(p => p.host);
  return !!h && nameBans(M).has(h.name.trim().toLowerCase());
};
const hostBanned = (M, t) => {
  const h = (t.players || []).find(p => p.host);
  return !!h && (seatBanned(M, h) || nameBans(M).has(h.name.trim().toLowerCase()));
};

/* The header is the CSRF proof - a cross-site form cannot set one. */
async function adminPost(path, body) {
  try {
    const res = await fetch(path, {method: "POST", credentials: "same-origin", cache: "no-store",
      headers: {"Content-Type": "application/json", "X-Ops-Admin": "1"}, body: JSON.stringify(body)});
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.error) { window.alert(out.error || `That did not work (HTTP ${res.status}).`); return null; }
    return out;
  } catch { window.alert("Could not reach the panel."); return null; }
}

/* One handler for every button the sections draw: what to do rides on
   data- attributes, so a player name with a quote in it breaks nothing. */
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  e.preventDefault();
  const {act, id, kind, name} = el.dataset;
  (async () => {
    let out = null;
    if (act === "ban") {
      const account = id.startsWith("u_");
      const what = account
        ? `Ban ${name} (${id})?\n\nTheir sign-in and pass refresh stop working within seconds, and every table they sit at is told to remove them.`
        : `Ban the name "${name}"?\n\nAnyone calling themselves that can no longer host a public room. Guests pick any name, so for a guest this is a warning shot, not a wall - a signed-in account is the durable ban.`;
      if (!window.confirm(what)) return;
      const reason = window.prompt("Reason (optional; only this panel shows it):", "");
      if (reason === null) return;
      out = await adminPost("api/ban", {kind: account ? "account" : "name", id, name, reason});
    } else if (act === "unban") {
      if (!window.confirm(`Lift the ban on ${name || id}?`)) return;
      out = await adminPost("api/unban", {kind, id});
    } else if (act === "close") {
      if (!window.confirm(`Close ${id}?\n\nIt leaves the public list now and cannot be listed again for 24 hours. A game already going on the room code is not interrupted.`)) return;
      out = await adminPost("api/close", {id});
    } else if (act === "reopen") {
      out = await adminPost("api/reopen", {id});
    }
    if (out) {
      if (liveData) liveData.moderation = {bans: out.bans || [], closed: out.closed || {}};
      renderLive();
      tickLive();
    }
  })();
});

/* ------------------------------------------------------------- sections */
function overview(T) {
  if (!T) return head("Right now");
  if (T.error) return head("Right now") + `<div class="empty"><b>No table data yet</b>${esc(T.error)}</div>`;
  const n = T.now;
  return head("Right now") + kpis([
    {k: "Players online", v: n.humans, cls: "kpi--accent", h: n.offline ? `${n.offline} disconnected` : "all connected"},
    {k: "Tables open", v: n.tables, h: `${n.playing} playing · ${n.lobby} in lobby`},
    {k: "Games in progress", v: n.playing},
    {k: "Disconnected", v: n.offline, cls: n.offline ? "kpi--bad" : "", h: "waiting to come back"},
    {k: "Bots seated", v: n.bots},
    {k: "Public rooms listed", v: T.public_rooms, h: "joinable from the front page"},
  ]);
}

const banBtn = (M, p) => p.bot ? "" : seatBanned(M, p)
  ? `<button class="act act--good" data-act="unban" data-kind="account" data-id="${esc(p.id)}" data-name="${esc(p.name)}">Unban</button>`
  : `<button class="act act--bad" data-act="ban" data-id="${esc(p.id)}" data-name="${esc(p.name)}">Ban</button>`;

const seatRow = (p, t, M) => `<li class="seat"${p.connected ? "" : " data-off"}${p.out ? " data-out" : ""}>`
  + `<i class="seat__dot" style="background:${esc(p.color)}"></i>`
  + `<span class="seat__who"><span class="seat__name" title="${esc(p.name)} · ${esc(p.id)}">${esc(p.name)}</span>`
  + (p.bot ? tag("bot") : "") + (p.host && t.mode !== "solo" ? tag("host", "accent") : "")
  + (p.id.startsWith("u_") && !p.bot ? tag("account") : "")
  + (seatBanned(M, p) ? tag("banned", "bad") : "")
  + (!p.bot && !p.connected ? tag("offline", "bad") : "")
  + (p.out ? tag(t.kind === "cashflow" ? "out" : "bankrupt", "bad") : "")
  + (t.kind === "cashflow" && p.track === "fast" ? tag("fast track", "good") : "")
  + `</span><span class="seat__side"><span class="seat__cash">${t.phase === "lobby" ? "" : money(p.cash)}</span>${banBtn(M, p)}</span></li>`;

function tableCard(t, i, M) {
  const status = [phaseTag(t)];
  if (t.phase === "playing") status.push(`<span>Round <b class="num">${t.round}</b></span>`);
  if (t.turn) status.push(`<span class="muted">${esc(t.turn)} to move</span>`);
  if (t.phase === "over") status.push(t.winner ? `<span><b>${esc(t.winner)}</b> won</span>` : "");
  if (hostBanned(M, t)) status.push(tag("host banned", "bad"));
  const closable = /^[A-Z]{3,10}-/.test(t.id);   // a room code, not a solo table
  const closed = closable && roomClosed(M, t.id);
  return `<article class="tcard reveal" style="--i:${i}">
    <div class="tcard__head"><span class="code" title="${esc(t.id)}">${esc(t.id)}</span><span class="game">${esc(GAME[t.kind] || t.kind)}</span></div>
    <div class="status">${status.join("")}</div>
    <ul class="seats">${(t.players || []).map(p => seatRow(p, t, M)).join("")}</ul>
    <div class="tcard__foot"><div class="tags">${modeTag(t.mode)}${deviceTag(t.device)}${t.lang ? tag(t.lang) : ""}${closed ? tag("closed", "bad") : ""}</div>
      <span class="tcard__acts">${!closable ? "" : closed
        ? `<button class="act act--good" data-act="reopen" data-id="${esc(t.id)}">Reopen</button>`
        : `<button class="act" data-act="close" data-id="${esc(t.id)}">Close room</button>`}
      <span class="num${t.quiet > 45 ? " bad" : ""}">open ${dur(t.age)} · seen ${dur(t.quiet)} ago</span></span></div>
  </article>`;
}

function liveTables(T, M) {
  const list = T && !T.error ? T.live : [];
  const h = head("Live tables", `<span class="count num">${list.length}</span><span class="sec-note">public, private and solo · newest first</span>`);
  if (!T || T.error) return h;
  if (!list.length) return h + `<div class="empty"><b>Nobody is at a table</b>A table shows up here the moment someone opens a room or starts a solo game.</div>`;
  return h + `<div class="cards">${list.map((t, i) => tableCard(t, i, M)).join("")}</div>`;
}

/* Every human seat at every live table, one row each - the "who is on right
   now" answer, with the ban button next to the name it applies to. */
function onlineRow({t, p}, M) {
  const account = p.id.startsWith("u_");
  const banned = seatBanned(M, p) || (p.host && nameBans(M).has(p.name.trim().toLowerCase()));
  return `<div class="orow"${p.connected ? "" : " data-off"}>
    <span class="o-who"><i class="seat__dot" style="background:${esc(p.color)}"></i>
      <span class="seat__name" title="${esc(p.name)} · ${esc(p.id)}">${esc(p.name)}</span>
      ${account ? tag("account", "accent") : tag("guest")}${p.host ? tag("host") : ""}
      ${p.connected ? "" : tag("away", "warn")}${banned ? tag("banned", "bad") : ""}</span>
    <span class="o-where muted"><span class="code">${esc(t.id)}</span> · ${esc(GAME[t.kind] || t.kind)}${t.phase === "playing" ? ` · round ${t.round}` : ""}${t.mode === "solo" ? " · solo" : ""}</span>
    <span class="num muted">${t.phase === "lobby" ? "—" : money(p.cash)}</span>
    <span class="o-act">${banned && !account ? "" : banBtn(M, p)}</span>
  </div>`;
}

function onlineSec(T, M) {
  const rows = [];
  if (T && !T.error)
    for (const t of T.live)
      for (const p of t.players || [])
        if (!p.bot) rows.push({t, p});
  rows.sort((a, b) => Number(b.p.connected) - Number(a.p.connected) || (b.t.opened - a.t.opened));
  const on = rows.filter(r => r.p.connected).length;
  const h = head("Who's online", `<span class="count num">${on}</span><span class="sec-note">every human seat at a live table · names, not people</span>`);
  if (!T || T.error) return h;
  if (!rows.length) return h + `<div class="empty"><b>Nobody online</b>Players appear the moment a table reports them, and grey out when they drop.</div>`;
  return h + `<div class="rows"><div class="orow orow--head"><span>Player</span><span>Table</span><span>Cash</span><span></span></div>`
    + rows.map(r => onlineRow(r, M)).join("") + `</div>`;
}

function bansSec(M) {
  const bans = [...(M?.bans || [])].sort((a, b) => b.at - a.at);
  const closed = Object.entries(M?.closed || {})
    .filter(([, at]) => Date.now() / 1000 - at < 86400)
    .sort((a, b) => b[1] - a[1]);
  // The form itself is static markup: re-rendering it every three seconds
  // would wipe whatever the operator is typing into it.
  $("banHead").innerHTML = head("Moderation", `<span class="count num">${bans.length}</span>`
    + `<span class="sec-note">enforced at the next beat of any table - within about 20 seconds</span>`);
  const list = bans.length ? `<div class="rows">${bans.map(b => `<div class="orow">
      <span class="o-who">${tag(b.kind, b.kind === "account" ? "accent" : "")}<b>${esc(b.name || b.id)}</b>${b.kind === "account" ? `<code class="faint">${esc(b.id)}</code>` : ""}</span>
      <span class="o-where muted">${esc(b.reason || "—")}</span>
      <span class="faint">by ${esc(b.by || "?")}<br>${dur(Math.max(0, Math.round(Date.now() / 1000 - b.at)))} ago</span>
      <span class="o-act"><button class="act act--good" data-act="unban" data-kind="${esc(b.kind)}" data-id="${esc(b.id)}" data-name="${esc(b.name || b.id)}">Unban</button></span>
    </div>`).join("")}</div>`
    : `<div class="empty"><b>No bans</b>Ban a player from "Who's online" or a live table card, or by hand above.</div>`;
  const rooms = closed.length
    ? `<div class="sec-h" style="margin-top:var(--s-4)"><h2>Closed rooms</h2><span class="sec-note">cannot be listed for 24 hours from closing</span></div>`
      + `<div class="rows">${closed.map(([id, at]) => `<div class="orow">
        <span class="o-who"><span class="code">${esc(id)}</span></span>
        <span class="o-where muted">closed ${dur(Math.max(0, Math.round(Date.now() / 1000 - at)))} ago</span>
        <span></span>
        <span class="o-act"><button class="act act--good" data-act="reopen" data-id="${esc(id)}">Reopen</button></span>
      </div>`).join("")}</div>`
    : "";
  $("banBody").innerHTML = list + rooms;
}

/* 288 five-minute samples do not fit a phone-width chart, and a clipped
   chart loses its right edge - which is "now". Keep the peak of each
   half hour instead. */
function bucket(s, n = 48) {
  if (s.length <= n) return s;
  const t0 = s[0][0], width = (s[s.length - 1][0] - t0) || 1, out = [];
  for (const x of s) {
    const i = Math.min(n - 1, Math.floor((x[0] - t0) / width * n));
    if (!out[i] || x[1] > out[i][1]) out[i] = x;
  }
  return out.filter(Boolean);
}

function onlineChart(raw) {
  const s = bucket(raw);
  const max = Math.max(1, ...s.map(x => x[1]));
  const body = s.length
    ? `<div class="plot" role="img" aria-label="Players online over the last 24 hours, peak ${max}">`
      + s.map(([t, h, tb]) => `<i style="height:${Math.round(h / max * 100)}%" title="${hhmm(t)} · ${h} online · ${tb} tables"></i>`).join("")
      + `<span class="plot__max num">${max}</span></div><div class="axis"><span>${hhmm(s[0][0])}</span><span>now</span></div>`
    : `<div class="plot plot--empty">A point is added every 5 minutes</div><div class="axis"><span>24h ago</span><span>now</span></div>`;
  return `<div class="panel reveal" style="--i:1"><div class="chart__h"><b>Players online</b><span>every 5 minutes</span></div>${body}</div>`;
}

function weekChart(w) {
  const e = Object.entries(w.per_day), max = Math.max(1, ...e.map(([, v]) => v.opened));
  return `<div class="panel reveal" style="--i:2"><div class="chart__h"><b>Tables per day</b><span>${w.opened} opened · ${w.finished} finished · ${w.players} players this week</span></div>
    <div class="days" role="img" aria-label="Tables opened per day, last 7 days">${e.map(([k, v], i) => {
      const today = i === e.length - 1;
      return `<div class="day"${today ? " data-today" : ""} title="${esc(k)} · ${v.opened} opened · ${v.finished} finished">
        <span class="day__v num">${v.opened || ""}</span>
        <span class="day__track"><i class="day__bar" style="height:${v.opened ? Math.max(4, Math.round(v.opened / max * 100)) : 0}%"></i></span>
        <span class="day__k">${today ? "Today" : esc(k.split(" ")[1] || k)}</span></div>`;
    }).join("")}</div></div>`;
}

function today(T) {
  if (!T || T.error) return "";
  const d = T.day;
  return head("Last 24 hours") + kpis([
    {k: "Tables opened", v: d.opened, h: `${d.monopoly} Monopoly · ${d.cashflow} Cashflow`},
    {k: "Games started", v: d.started},
    {k: "Games finished", v: d.finished, h: d.avg_game_min != null ? `about ${d.avg_game_min} min each` : "none yet"},
    {k: "Distinct players", v: d.players, h: "counted by name"},
    {k: "Peak online", v: d.peak_humans},
    {k: "Opened on a phone", v: d.mobile, h: d.opened ? Math.round(d.mobile / d.opened * 100) + "% of tables" : ""},
    {k: "Connection drops", v: d.dropped},
    {k: "Went quiet", v: d.quiet, h: "tab closed or connection lost"},
  ]) + `<div class="chips">${tag(d.public + " public", "accent")}${tag(d.private + " private")}${tag(d.solo + " solo")}</div>`
    + `<div class="charts">${onlineChart(T.samples)}${weekChart(T.week)}</div>`;
}

const result = t => t.phase === "over"
  ? (t.winner ? `<b>${esc(t.winner)}</b> won` : "Finished") + ` · ${t.round} rounds`
  : t.phase === "playing" ? `Stopped in round ${t.round}` : `<span class="faint">Never started</span>`;

function ended(T) {
  if (!T || T.error) return "";
  const list = T.recent;
  const h = head("Recently ended", `<span class="count num">${list.length}</span>`);
  if (!list.length) return h + `<div class="empty"><b>No tables have ended yet</b>Finished and abandoned tables are listed here with how they ended.</div>`;
  return h + `<div class="rows"><div class="erow erow--head"><span>Table</span><span>Players</span><span>Result</span><span>Ended</span></div>`
    + list.map(t => `<div class="erow">
      <div class="e-id"><span class="code" title="${esc(t.id)}">${esc(t.id)}</span><div class="tags">${tag(GAME[t.kind] || t.kind)}${modeTag(t.mode)}${deviceTag(t.device)}</div></div>
      <div class="e-who">${people(t.players)}</div>
      <div class="e-res">${result(t)}</div>
      <div class="e-when"><span class="num">${dur(t.ago)} ago</span><span class="faint">${esc(t.end_reason || "")} · ran ${dur(t.secs)}</span></div>
    </div>`).join("") + `</div>`;
}

const evTone = e => e.ev === "closed" ? (e.reason === "went quiet" ? "warn" : "")
  : ({opened: "accent", started: "good", finished: "good", returned: "good", resumed: "good", dropped: "bad", listed: "accent", rematch: "accent", moderated: "bad"})[e.ev] || "";

function evText(e) {
  const code = `<span class="code">${esc(e.id)}</span>`, who = `<b>${esc(e.name)}</b>`;
  switch (e.ev) {
    case "opened": return `${code} opened · ${esc(GAME[e.game] || e.game)} · ${esc(e.mode)} · ${people(e.players)}`;
    case "started": return `${code} started · ${people(e.players)}`;
    case "finished": return `${code} finished · <b>${esc(e.winner || "nobody")}</b> won · ${e.rounds} rounds · ${dur(e.secs)}`;
    case "joined": return `${who} joined ${code}`;
    case "left": return `${who} left ${code}`;
    case "dropped": return `${who} lost connection at ${code}`;
    case "returned": return `${who} reconnected to ${code}`;
    case "closed": return `${code} closed · ${esc(e.reason)} · after ${dur(e.secs)}`;
    case "resumed": return `${code} picked back up after ${dur(e.away)}`;
    case "listed": return `${code} made public`;
    case "unlisted": return `${code} made private`;
    case "rematch": return `${code} back to the lobby for another game`;
    case "moderated": return `${code} flagged by moderation`
      + (e.banned ? " · its host is banned" : "")
      + (e.close ? " · the room was closed" : "")
      + (e.bannedSeats && e.bannedSeats.length ? ` · ${e.bannedSeats.length} banned account(s) seated` : "");
    default: return `${code} ${esc(e.ev)}`;
  }
}

function activity(T) {
  if (!T || T.error) return "";
  const h = head("Activity", `<span class="sec-note">last 24 hours · newest first</span>`);
  if (!T.feed.length) return h + `<div class="empty"><b>Nothing has happened yet</b>Opens, joins, drops and results appear here as they happen.</div>`;
  return h + `<div class="rows"><ol class="feed">${T.feed.map(e =>
    `<li><time class="num" datetime="${new Date(e.t * 1000).toISOString()}">${hhmm(e.t)}</time><span><i class="ev ev--${evTone(e) || "none"}"></i>${evText(e)}</span></li>`).join("")}</ol></div>`;
}

function server(d) {
  const svc = card("Services", d.services.map(s => row(
    `<i class="dot dot--${s.state === "active" ? "good" : "bad"}"></i>${esc(s.unit)}`,
    `<span class="${s.state === "active" ? "" : "bad"}">${esc(s.state)}${s.uptime_s != null ? " · " + dur(s.uptime_s) : ""}</span>`)).join(""));

  const t = d.turn;
  const relay = card(`Relay · last ${t.window_h}h`,
    `<div class="big">${t.allocations} <small>allocations</small></div>`
    + row("active now", t.active) + row("closed", t.closed)
    + row("from clients", fmtB(t.bytes_from_clients)) + row("to clients", fmtB(t.bytes_to_clients))
    + Object.entries(t.by_transport).map(([k, v]) => row(esc(k), v)).join("")
    + `<div class="note">${t.non_relay_sessions} session(s) opened without allocating a relay — plain STUN, and this panel's own certificate probe. Not counted above.</div>`
    + (t.close_reasons.length ? `<div class="note">${t.close_reasons.map(([r, n]) => esc(r) + " × " + n).join("<br>")}</div>` : "")
    + (t.logging_ok ? "" : `<div class="note bad">coturn is not logging sessions</div>`));

  const n = d.nginx;
  let web;
  if (n.error) web = card("Web traffic", `<div class="bad">${esc(n.error)}</div>`);
  else {
    const hrs = Object.entries(n.per_hour).sort(), max = Math.max(1, ...hrs.map(x => x[1]));
    web = card(`Web traffic · last ${n.window_h}h`,
      `<div class="big">${n.requests} <small>requests · ${fmtB(n.bytes)}</small></div>`
      + `<div class="plot">${hrs.map(([hr, v]) => `<i style="height:${Math.round(v / max * 100)}%" title="${esc(hr)} · ${v}"></i>`).join("")}</div>`
      + row("page loads", n.kinds.page) + row("assets", n.kinds.asset) + row("api", n.kinds.api) + row("other", n.kinds.other)
      + Object.entries(n.statuses).map(([s, v]) => row("HTTP " + esc(s), v)).join("")
      + `<div class="note">${esc(n.client_ip_note)}</div>`);
  }

  const c = d.cert, tone = c.days_left == null || c.days_left < 14 ? "bad" : c.days_left < 30 ? "warn" : "good";
  const cert = card("Certificate · as served",
    `<div class="big"><i class="dot dot--${tone}"></i>${c.days_left ?? "—"} <small>days left</small></div>`
    + c.served.map(s => row(`${esc(s.sni)} → ${esc(s.serves || "?")}`, s.error ? `<span class="bad">${esc(s.error)}</span>` : esc(s.expires || "—"))).join("")
    + (c.mismatch ? `<div class="note bad">The two backends are serving different certificates — one did not pick up a renewal.</div>`
                  : `<div class="note">Read from the socket, not from disk: coturn loads its certificate once at startup.</div>`));

  const top = n.top_paths ? card("Top paths",
    `<table class="paths">${n.top_paths.map(([p, v]) => `<tr><td title="${esc(p)}">${esc(p)}</td><td>${v}</td></tr>`).join("")}</table>`) : "";

  const h = d.host;
  const hostCard = card("Host", row("load (1/5/15m)", (h.load || []).join("  ") || "—")
    + row("memory", h.mem_available_mb != null ? `${h.mem_total_mb - h.mem_available_mb} / ${h.mem_total_mb} MB` : "—")
    + row("disk", `${h.disk_used_gb} / ${h.disk_total_gb} GB`) + row("uptime", dur(h.uptime_s)));

  return head("Server", `<span class="sec-note">generated ${esc(d.generated)}</span>`)
    + `<div class="grid">${svc}${relay}${web}${cert}${top}${hostCard}</div>`;
}

/* --------------------------------------------------------------- refresh */
/* Two clocks. The live poll - tables, who is online, the bans - runs every
   three seconds and is cheap: one small file read. The heavy snapshot
   (journald, nginx's log, /proc) runs every fifteen. */
let liveData = null, statsData = null, lastAt = 0, failing = false, first = true;

function banners(T) {
  if (failing) return `<div class="banner banner--bad" role="alert"><b>Can't load the panel data.</b> Retrying every 3 seconds${liveData ? " — showing what was last loaded" : ""}. If it keeps happening, reload the page or sign in again.</div>`;
  if (T && T.stale) return `<div class="banner banner--warn"><b>The table log is ${dur(T.generated_age)} old.</b> The lobby service may be down — check <code>systemctl status lobbies</code>. Tables below may be out of date.</div>`;
  return "";
}

function updateLive() {
  const el = $("live"), txt = $("liveText");
  if (failing) { el.dataset.state = "error"; txt.textContent = lastAt ? `Offline · last update ${dur(Math.round((Date.now() - lastAt) / 1000))} ago` : "Offline"; return; }
  if (!lastAt) { el.dataset.state = "loading"; txt.textContent = "Loading…"; return; }
  if (document.hidden) { el.dataset.state = "paused"; txt.textContent = "Paused"; return; }
  const s = Math.max(0, Math.round((Date.now() - lastAt) / 1000));
  const stale = liveData && liveData.tables && liveData.tables.stale;
  el.dataset.state = stale ? "stale" : "ok";
  txt.textContent = `${stale ? "Table log stale" : "Live"} · updated ${s < 2 ? "just now" : s + "s ago"}`;
}

function renderLive() {
  if (!liveData) return;
  const T = liveData.tables, M = liveData.moderation;
  if (first) document.body.classList.add("first");
  $("overview").innerHTML = overview(T);
  $("overview").removeAttribute("aria-busy");
  $("online").innerHTML = onlineSec(T, M);
  $("live-tables").innerHTML = liveTables(T, M);
  bansSec(M);
  // The page just changed height under the reader; the menu has to catch up.
  if (typeof queueMark === "function") queueMark();
  if (first) { first = false; setTimeout(() => document.body.classList.remove("first"), 1500); }
}

function renderStats() {
  if (!statsData) return;
  const feed = document.querySelector(".feed"), feedTop = feed ? feed.scrollTop : 0;
  const T = statsData.tables;
  $("today").innerHTML = today(T);
  $("ended").innerHTML = ended(T);
  $("activity").innerHTML = activity(T);
  $("server").innerHTML = server(statsData);
  const feedNow = document.querySelector(".feed");
  if (feedNow) feedNow.scrollTop = feedTop;
  if (typeof queueMark === "function") queueMark();
}

async function tickLive() {
  if (document.hidden) { updateLive(); return; }
  try {
    // Relative, NOT "/api/live": the page is served from "/" over the tunnel
    // but from "/admin/" through nginx, where "/api/" is another app entirely.
    const res = await fetch("api/live", {credentials: "same-origin", cache: "no-store"});
    const d = await res.json();
    if (!d || !d.tables) throw new Error("no data");
    liveData = d; lastAt = Date.now(); failing = false;
    renderLive();
  } catch (e) {
    failing = true;
  }
  $("banners").innerHTML = banners(liveData && liveData.tables);
  updateLive();
}

async function tickStats() {
  if (document.hidden) return;
  try {
    const res = await fetch("api/stats", {credentials: "same-origin", cache: "no-store"});
    const d = await res.json();
    if (!d || !d.generated) throw new Error("no data");
    statsData = d;
    renderStats();
  } catch (e) { /* the live poll is the one that reports trouble */ }
}

document.addEventListener("visibilitychange", () => { if (!document.hidden) { tickLive(); tickStats(); } else updateLive(); });
setInterval(tickLive, 3000);
setInterval(tickStats, 15000);
setInterval(updateLive, 1000);
tickLive();
tickStats();

// The ban form is static markup (see bansSec); handle it by delegation.
document.addEventListener("submit", async (e) => {
  if (e.target.id !== "banForm") return;
  e.preventDefault();
  const f = e.target, kind = f.kind.value, target = f.target.value.trim(), reason = f.reason.value.trim();
  if (!target) return;
  const out = await adminPost("api/ban", {kind, id: target, name: target, reason});
  if (out) {
    f.reset();
    if (liveData) liveData.moderation = {bans: out.bans || [], closed: out.closed || {}};
    renderLive();
    tickLive();
  }
});

/* Which section is being read, for the menu: the last one whose top has
   passed under the header. (Several short sections can be on screen at
   once on a wide display, so "is visible" alone picks the wrong one.) */
const links = [...document.querySelectorAll(".nav a")], nav = document.querySelector(".nav");
const sections = [...document.querySelectorAll("main section")];
let current = "", queued = false;
function markSection() {
  queued = false;
  const line = document.querySelector(".bar").offsetHeight + 24;
  let id = sections[0].id;
  for (const s of sections) if (s.getBoundingClientRect().top <= line) id = s.id;
  // At the very bottom the last sections can never reach the line. Only when
  // there is somewhere to scroll: the loading skeleton fits the window, and
  // "at the bottom" of a page that short would mean the last section.
  const doc = document.documentElement;
  if (doc.scrollHeight > innerHeight + 4 && scrollY > 0 && innerHeight + scrollY >= doc.scrollHeight - 4) {
    id = sections[sections.length - 1].id;
  }
  if (id === current) return;
  current = id;
  for (const a of links) {
    const on = a.getAttribute("href") === "#" + id;
    a.setAttribute("aria-current", on ? "true" : "false");
    if (on) nav.scrollTo({left: a.offsetLeft - nav.clientWidth / 2 + a.clientWidth / 2});
  }
}
const queueMark = () => { if (!queued) { queued = true; requestAnimationFrame(markSection); } };
addEventListener("scroll", queueMark, {passive: true});
addEventListener("resize", queueMark);
markSection();
</script>
</html>
"""


if __name__ == "__main__":
    ThreadingHTTPServer.allow_reuse_address = True
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
