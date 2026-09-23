# The status panel

The operator's console: it answers "is it up, and is anyone using it" for the
droplet that runs the relay and the site - and it is also where bans and room
closures come from.

## Getting to it

Two commands. The first opens a tunnel and stays running; the second is the
URL.

```bash
ssh -N -L 9000:127.0.0.1:9000 aitutor     # leave this running
```

Then open **<http://localhost:9000>**.

Ctrl-C the tunnel when you are done. If port 9000 is busy on your machine,
change the left-hand number: `-L 9100:127.0.0.1:9000`, then use
`localhost:9100`.

The tunnel needs no sign-in: the port is unreachable from the internet, and
the tunnel already proved you hold the SSH key, which is a better credential
than any password.

## The public way in

`https://aytingchi.uz/admin` serves the same panel, behind sign-in. It is
**optional** — the tunnel keeps working whether or not this is configured,
and with nothing configured the public route refuses to serve anything at
all rather than being an open door.

Two ideas are kept separate here, and the separation is the point:

- **Signing in** establishes *which* address you are — Google, or a one-time
  link emailed to you.
- **The allowlist** decides whether that address may look.

Anyone in the world can create a Google account, so treating "signed in" as
"allowed" would be a lock with no key. The allowlist currently holds one
address; adding more is one line in the config, and takes effect within ten
seconds without a restart.

### What you have to set up

Both methods need a credential only you can create. They go in
`/etc/opspanel/config.json` on the droplet (root-owned, `0640`) — put them
there over SSH rather than sending them anywhere.

**Google.** In Google Cloud Console → APIs & Services → Credentials → Create
credentials → OAuth client ID → Web application. The authorised redirect URI
has to be exactly:

```
https://aytingchi.uz/admin/auth/google/callback
```

Then set `google_client_id` and `google_client_secret`.

**Email magic link.** Any SMTP sender. For Gmail that is `smtp.gmail.com`,
port 587, your address, and an **App Password** — not your account password,
which will not work with 2FA on and should not be put in a config file
anyway. Set `smtp_host`, `smtp_port`, `smtp_user`, `smtp_password` and
`smtp_from`. Leave `smtp_host` blank to keep magic links off.

Either one alone is enough. Whichever you configure is what the sign-in page
offers; the other simply does not appear.

```bash
ssh aitutor
sudo nano /etc/opspanel/config.json     # fill in what you want
sudo systemctl restart opspanel         # not strictly needed; picks up in ~10s
```

### How it is protected

- nginx sets `X-Panel-Public: 1` on everything it proxies, **overwriting**
  any value the client sent, so a request cannot pretend to have come over
  the tunnel and skip sign-in. Verified by sending a forged header.
- The session is an HMAC-signed cookie: `HttpOnly`, `Secure`, `SameSite=Lax`,
  scoped to `/admin`, 12 hours. Nothing is stored server-side.
- The OAuth `state` is itself a signed, expiring token, so a callback that
  did not start at this panel is refused.
- Google's `id_token` is taken only from the token endpoint over TLS using
  the client secret, and `aud`, `iss`, `exp` and `email_verified` are all
  checked before the address is believed.
- Magic links are single-use and expire in ten minutes.
- The sign-in form answers identically for allowlisted and unknown addresses
  — **including when sending fails**. An error for a real address and
  "sent" for an unknown one would confirm allowlist membership to anyone who
  asked. Delivery problems go to `journalctl -u opspanel` instead, where the
  operator sees them and a prober does not.

`ops/test_auth.py` covers the parts where a mistake is a hole rather than a
bug — forged and tampered signatures, expiry, replay of a one-time link, the
allowlist, fail-closed behaviour, and that last indistinguishability
property. `ops/test_bans.py` covers the ban list: what the panel accepts and
writes, what the lobby service matches, and that a missing or corrupt file
opens the door rather than locking everyone out. Run them on the droplet
with `python3 /opt/opspanel/test_auth.py` and `python3 /opt/opspanel/test_bans.py`.

## What it shows

| Card | Reading |
| --- | --- |
| Right now | Tables open, games in progress, tables waiting in a lobby, players online and disconnected, bots seated, public rooms listed. |
| Who's online | Every human seat at every live table, one row each: name, account or guest, which table and game, cash, online or dropped - and a Ban button. Refreshes every 3 seconds. |
| Live tables | Every open table - public, private and solo - with its code, game, whether it has started, the round and whose move it is, each seat (name, bot or human, host, online or dropped, bankrupt, cash), how long it has been open and when it last reported. Also the host's device (phone or desktop) and language. Banned seats are flagged, and every human seat has a Ban button; every room has Close. |
| Moderation | The active bans (account and name), who set them and why, with Unban; the rooms currently closed, with Reopen; and a form for banning by hand. |
| Last 24 hours | Tables opened (by game, and public / private / solo), games started and finished, average game length, distinct player names, peak players online, tables opened from a phone, connection drops, tables that went quiet. A players-online chart (one point per 5 minutes) and tables opened per day for the last week. |
| Recently ended | The last 60 tables to close: players, winner or where it stopped, how long it ran, and whether it was left or went quiet. |
| Activity | A feed of the last 24 hours: opened, joined, left, dropped, reconnected, started, finished, closed, moderated. |
| Services | `coturn`, `nginx`, `lobbies`, `aitutor`: active or not, and for how long. |
| Relay | Allocations in the last 24h, how many are still open, bytes each way, and the split between `turns:` on 443 and plain `turn:` on 3478. |
| Web traffic | Requests over 24h bucketed by hour, split into page loads / assets / `/api`, with status codes and bytes served. |
| Certificate | Days left — read from the socket, per SNI name. |
| Top paths | The eight most requested paths. |
| Host | Load, memory, disk, uptime. |

The page polls `api/live` (tables, who is online, bans - one small file)
every 3 seconds and `api/stats` (journald, nginx's log, /proc) every 15.

## The controls

**Ban a player.** Two kinds, and the difference matters:

- An **account ban** names a signed-in player's `u_…` id. The accounts
  service stops signing or refreshing their pass (their current one expires
  on its own, in at most 30 days), and their saved tables and history stop
  answering. The lobby service names the banned seat in every table report's
  answer, and the host's client removes that seat - in a lobby it is
  deleted, in a running game it plays on as a bot, and the kicked list keeps
  them from walking back into that table.
- A **name ban** matches a display name, case-insensitively. Names are
  claimed, not owned, so it does one thing only: nobody calling themselves
  that can host a *public* room. A banned name's announces are answered
  `banned`, the room never reaches the list, and the host's client disbands
  the table. Guests at someone else's table are never matched by name.

**Close a room.** The room leaves the public list at once and cannot be
listed again for 24 hours; the host's next announce is answered `closed` and
its client unlists and says so. A game already running on the code is not
interrupted - closing is about discoverability, and so is its limit.

Bans and closes land in `bans.json` and are enforced at the next beat of any
table - within about 20 seconds. Each enforcement is written to the day file
as a `moderated` event, so the Activity feed shows the controls working.

Two honest limits. The game itself runs in browsers, so the client-side half
of enforcement (removing a seat, disbanding a banned host's table) is done by
the *unmodified* client: someone who patches their build can ignore it, but
their room still never lists, their account still dies, and the panel still
sees their table. And "distinct players" counts names, not people.

The controls ride the same two ways in as the page - the tunnel, or an
allowlisted session - plus an `X-Ops-Admin` header the page sends and a
cross-site request cannot: the header is the CSRF proof. The panel is the
only writer of `bans.json`; the lobby and accounts services only read it.

## Three things it is careful about

**The certificate is read from the socket, not from disk.** The way TLS
breaks here is that certbot renews, the files under `/etc/letsencrypt` are
new, and coturn goes on presenting the old one because it reads its
certificate only at startup. A disk check would report the renewed date and
call it healthy while clients were served an expired cert. The panel opens a
TLS connection for each SNI name and reads what comes back, so it sees what
clients see — and flags it loudly if the two backends disagree, which is
exactly what that failure looks like.

**It does not count its own probes as relay traffic.** Those certificate
checks are connections to coturn, and so are plain STUN binds. Counting
sessions would have made the relay look busy because the panel was watching
it. Only sessions that actually allocated a relay are counted; the rest are
reported separately as what they are.

**It knows who is playing only because tables say so.** The game still lives
in the host's browser and nothing about play goes through this server. What
the tables section shows comes from reports: whoever runs a table (a room's
host, or the browser a solo game is in) posts the table's shape to
`/lobbies/report` when it changes and every 20 seconds
(`src/net/telemetry.ts`). Guests never report. The lobby service keeps live
tables in memory and appends every change to a day file in
`/var/lib/lobbies`; the panel reads those files and never talks to the
service over HTTP, and the service never serves them back out. A table that
stops reporting for 90 seconds is closed as "went quiet", and one that comes
back within the hour (a refresh, a host hand-over) resumes rather than
counting twice.

What is recorded: room code, game, public/private/solo, phase, round, whose
move, winner, and each seat's name, bot or human, online or not, cash and
net worth (passive income for Cashflow), plus the host's device class and
language. No IP addresses (there are none to record - see below), no chat,
no moves. Day files are deleted after 30 days.

Two limits worth knowing. Reports come from browsers, so anyone who wants to
can post a fake one; the service caps and sanitises them (500 live tables,
8 seats, 18-character names) but cannot prove them. And "distinct players"
counts names, not people.

One more limit worth knowing: because nginx splits 443 by TLS name and
passes the stream through untouched, every request in the access log has a
client address of `127.0.0.1`. There are no visitor counts or geography,
and the panel says so on the card rather than showing a number that is not
true.

## Where it lives

| | |
| --- | --- |
| Source | `ops/panel.py` in this repo, deployed to `/opt/opspanel/panel.py` |
| Unit | `ops/opspanel.service` → `/etc/systemd/system/opspanel.service` |
| Config | `/etc/opspanel/config.json` — secrets and allowlist, never in git |
| Tests | `ops/test_auth.py` and `ops/test_bans.py` → `/opt/opspanel/` |
| Table log | Written by `ops/lobbies.py` (`lobbies.service`, `StateDirectory=lobbies`) to `/var/lib/lobbies`: `tables.json` (live and recently ended, rewritten every few seconds) and `events-YYYY-MM-DD.jsonl` (30 days) |
| Ban list | `/var/lib/lobbies/bans.json` — written by this panel, read and enforced by the lobby service (listings, report answers) and the accounts service (passes, saves, history) |
| Runs as | `opspanel`, in `adm` (nginx logs) and `systemd-journal` (coturn logs) |
| Deps | Python 3 standard library only |

It runs as its own unprivileged user with `ProtectSystem=strict`, a
read-only mount of its config, and a 128M cap. It shares the lobby service's
`StateDirectory` so that exactly one path is writable: the ban list it
exists to write.

There is deliberately no `IPAddressDeny` any more. Public sign-in has to
reach Google's token endpoint and an SMTP server, so the panel needs egress;
what still protects it is that it **listens** only on loopback and is never
opened in ufw.

To update it after editing `ops/panel.py` (the units changed too, so reload
and restart all three):

```bash
scp ops/panel.py ops/lobbies.py ops/accounts.py ops/test_bans.py aitutor:/opt/opspanel/
scp ops/opspanel.service ops/lobbies.service ops/accounts.service aitutor:/etc/systemd/system/
ssh aitutor 'systemctl daemon-reload && systemctl restart opspanel lobbies accounts'
```
