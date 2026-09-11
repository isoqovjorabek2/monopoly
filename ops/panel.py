#!/usr/bin/env python3
"""
A read-only status panel for the droplet that runs the relay and the site.

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

Everything here is derived from what the machine already writes down —
journald, nginx's access log, /proc. Nothing new is collected, and in
particular nothing about who is playing what: Monopoly rooms live in the
host's browser and never reach this server, so the honest answer to "what is
happening in the games" is that this box cannot know. It can only say how
many page loads it served and how many relay allocations it brokered.

Python 3 standard library only, deliberately: this runs on a 1GB droplet
alongside the things it is watching.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
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

UNITS = ("coturn", "nginx", "aitutor")
NGINX_ACCESS = "/var/log/nginx/access.log"
CERT = "/etc/coturn/certs/fullchain.pem"

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
    served = [_served_cert(n) for n in ("aytingchi.uz", "turn.aytingchi.uz")]
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
        if path in ("/", "/index.html"):
            who = self._session_email() if self.public else None
            page = PAGE.replace("__WHO__", f"{who} · <a href='{base_url()}/auth/logout'>sign out</a>" if who else "")
            return self._send(200, page.encode(), "text/html; charset=utf-8")
        return self._send(404, b"not found", "text/plain")

    def log_message(self, *_):
        pass  # the panel watching the logs should not be filling them


LOGIN_PAGE = r"""<!doctype html>
<meta charset="utf-8"><title>sign in — droplet status</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root{--bg:#0f1113;--card:#161a1d;--line:#262b30;--ink:#e8e6e3;--dim:#9aa3ab;--brass:#e8b448}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);display:grid;place-items:center;
       min-height:100dvh;font:14px/1.55 ui-sans-serif,system-ui,sans-serif;padding:24px}
  .box{background:var(--card);border:1px solid var(--line);border-radius:12px;
       padding:26px;max-width:370px;width:100%}
  h1{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--brass);margin:0 0 18px}
  .msg{background:#1d2226;border:1px solid var(--line);border-radius:8px;padding:10px 12px;
       margin-bottom:16px;color:var(--dim);font-size:12.5px}
  a.btn,button{display:block;width:100%;padding:11px;border-radius:8px;border:1px solid var(--line);
     background:#20262b;color:var(--ink);font:inherit;font-weight:600;text-align:center;
     text-decoration:none;cursor:pointer}
  a.btn:hover,button:hover{background:#272e34}
  input{width:100%;padding:11px;border-radius:8px;border:1px solid var(--line);
        background:#0f1214;color:var(--ink);font:inherit;margin-bottom:9px}
  .or{display:flex;align-items:center;gap:10px;color:var(--dim);font-size:11.5px;margin:16px 0}
  .or::before,.or::after{content:"";flex:1;height:1px;background:var(--line)}
  .foot{color:var(--dim);font-size:11.5px;margin-top:16px;line-height:1.5}
</style>
<div class="box">
  <h1>Droplet status</h1>
  <div class="msg">__MSG__</div>
  <a class="btn" href="auth/google" style="display:__GOOGLE__">Continue with Google</a>
  <div class="or" style="display:__EMAIL__">or</div>
  <form method="post" action="auth/email" style="display:__EMAIL__">
    <input type="email" name="email" placeholder="you@example.com" required autocomplete="email">
    <button type="submit">Email me a sign-in link</button>
  </form>
  <p class="foot">Only allowlisted addresses can open this panel. Signing in
  proves who you are; it does not by itself grant access.</p>
</div>
<script>
  var m = document.querySelector('.msg');
  m.style.display = m.textContent.trim() ? 'block' : 'none';
</script>
"""


PAGE = r"""<!doctype html>
<meta charset="utf-8"><title>droplet status</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root{--bg:#0f1113;--card:#161a1d;--line:#262b30;--ink:#e8e6e3;--dim:#9aa3ab;
        --brass:#e8b448;--good:#4ec98a;--bad:#e06c6c;--warn:#e8b448}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
       font:14px/1.5 ui-sans-serif,system-ui,sans-serif;padding:24px}
  h1{font-size:15px;letter-spacing:.14em;text-transform:uppercase;
     color:var(--brass);margin:0 0 2px}
  .sub{color:var(--dim);font-size:12px;margin-bottom:20px}
  .sub a{color:var(--brass)}
  .grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));
        max-width:1200px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
  .card h2{font-size:11px;letter-spacing:.12em;text-transform:uppercase;
           color:var(--dim);margin:0 0 10px;font-weight:600}
  .row{display:flex;justify-content:space-between;gap:12px;padding:3px 0}
  .row span:last-child{font-variant-numeric:tabular-nums}
  .big{font-size:26px;font-variant-numeric:tabular-nums}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px}
  .ok{background:var(--good)}.no{background:var(--bad)}.wa{background:var(--warn)}
  .dim{color:var(--dim)}
  .note{color:var(--dim);font-size:11.5px;margin-top:9px;line-height:1.45;
        border-top:1px solid var(--line);padding-top:8px}
  .bars{display:flex;align-items:flex-end;gap:2px;height:52px;margin-top:8px}
  .bars div{flex:1;background:var(--brass);opacity:.75;border-radius:2px 2px 0 0;min-height:1px}
  table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
  td{padding:2px 0}td:last-child{text-align:right}
  td.p{color:var(--dim);overflow:hidden;text-overflow:ellipsis;max-width:210px;white-space:nowrap}
  .err{color:var(--bad)}
</style>
<h1>Droplet status</h1>
<div class="sub"><span id="stamp">loading…</span> <span id="who">__WHO__</span></div>
<div class="grid" id="grid"></div>
<script>
const fmtB = n => n==null ? "—" : n>1e9 ? (n/1e9).toFixed(2)+" GB"
  : n>1e6 ? (n/1e6).toFixed(1)+" MB" : n>1e3 ? (n/1e3).toFixed(1)+" kB" : n+" B";
const dur = s => s==null ? "—" : s>86400 ? Math.floor(s/86400)+"d "+Math.floor(s%86400/3600)+"h"
  : s>3600 ? Math.floor(s/3600)+"h "+Math.floor(s%3600/60)+"m" : Math.floor(s/60)+"m";
const esc = s => String(s).replace(/[<&>]/g, c => ({'<':'&lt;','&':'&amp;','>':'&gt;'}[c]));
const card = (t, html) => `<div class="card"><h2>${t}</h2>${html}</div>`;
const rows = kv => kv.map(([k,v]) => `<div class="row"><span class="dim">${esc(k)}</span><span>${v}</span></div>`).join("");

async function tick(){
  // Relative, NOT "/api/stats". The page is served from "/" over the tunnel
  // but from "/admin/" through nginx, and a root-absolute path there lands on
  // the Ai_tutor API instead of this panel - which answers 200 with a JSON
  // body of its own, so the failure looks like a rendering bug rather than a
  // wrong address.
  let d;
  try { d = await (await fetch("api/stats", {credentials:"same-origin"})).json(); }
  catch(e){ d = null; }
  if (!d || !d.generated) {
    document.getElementById("stamp").innerHTML =
      '<span class="err">no data from the panel — try reloading, or sign in again</span>';
    return;
  }
  document.getElementById("stamp").textContent = "generated " + d.generated + " · refreshes every 5s";

  const svc = card("Services", d.services.map(s =>
    `<div class="row"><span><i class="dot ${s.state==='active'?'ok':'no'}"></i>${esc(s.unit)}</span>`+
    `<span class="dim">${esc(s.state)} · ${dur(s.uptime_s)}</span></div>`).join(""));

  const c = d.cert, cls = c.days_left==null ? "no" : c.days_left < 14 ? "no" : c.days_left < 30 ? "wa" : "ok";
  const cert = card("Certificate <span class='dim' style='text-transform:none;letter-spacing:0'>as served</span>",
    `<div class="big"><i class="dot ${cls}"></i>${c.days_left ?? "—"} <span class="dim" style="font-size:13px">days left</span></div>`
    + c.served.map(s => `<div class="row"><span class="dim">${esc(s.sni)} → ${esc(s.serves||"?")}</span>`+
        `<span>${s.error ? '<span class="err">'+esc(s.error)+'</span>' : esc(s.expires||"—")}</span></div>`).join("")
    + (c.mismatch ? `<div class="note err">The two backends are serving different certificates — one did not pick up a renewal.</div>`
                  : `<div class="note">Read from the socket, not from disk: coturn loads its certificate once at startup, so a renewed file on disk is not evidence that clients get it.</div>`));

  const t = d.turn;
  const turn = card(`Relay · last ${t.window_h}h`,
    `<div class="big">${t.allocations}</div><div class="dim" style="margin-bottom:8px">allocations</div>`
    + rows([["active now", t.active], ["closed", t.closed],
            ["from clients", fmtB(t.bytes_from_clients)], ["to clients", fmtB(t.bytes_to_clients)]])
    + rows(Object.entries(t.by_transport))
    + `<div class="note">${t.non_relay_sessions} session(s) opened without allocating a relay — plain STUN, and this panel's own certificate probe. Not counted above.</div>`
    + (t.close_reasons.length ? `<div class="note">${t.close_reasons.map(([r,n])=>esc(r)+" × "+n).join("<br>")}</div>` : "")
    + (t.logging_ok ? "" : `<div class="note err">coturn is not logging sessions</div>`));

  const n = d.nginx;
  let web;
  if (n.error) { web = card("Web traffic", `<div class="err">${esc(n.error)}</div>`); }
  else {
    const hrs = Object.entries(n.per_hour).sort();
    const max = Math.max(1, ...hrs.map(h=>h[1]));
    web = card(`Web traffic · last ${n.window_h}h`,
      `<div class="big">${n.requests}</div><div class="dim">requests · ${fmtB(n.bytes)} served</div>`
      + `<div class="bars">${hrs.map(([h,v])=>`<div style="height:${Math.round(v/max*100)}%" title="${h} — ${v}"></div>`).join("")}</div>`
      + rows([["page loads", n.kinds.page], ["assets", n.kinds.asset], ["api", n.kinds.api], ["other", n.kinds.other]])
      + rows(Object.entries(n.statuses).map(([s,v])=>[s,v]))
      + `<div class="note">${esc(n.client_ip_note)}</div>`);
  }

  const top = n.top_paths ? card("Top paths",
    `<table>${n.top_paths.map(([p,v])=>`<tr><td class="p">${esc(p)}</td><td>${v}</td></tr>`).join("")}</table>`) : "";

  const h = d.host;
  const hostCard = card("Host", rows([
    ["load (1/5/15m)", (h.load||[]).join("  ")],
    ["memory", h.mem_available_mb!=null ? `${h.mem_total_mb - h.mem_available_mb} / ${h.mem_total_mb} MB` : "—"],
    ["disk", `${h.disk_used_gb} / ${h.disk_total_gb} GB`],
    ["uptime", dur(h.uptime_s)]]));

  document.getElementById("grid").innerHTML = svc + turn + web + cert + top + hostCard;
}
tick(); setInterval(tick, 5000);
</script>
"""


if __name__ == "__main__":
    ThreadingHTTPServer.allow_reuse_address = True
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
