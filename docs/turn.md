# The relay

Two browsers usually find each other on their own. STUN tells each one what
its public address looks like from outside, both punch a hole outward at the
same moment, and the packets cross in the middle.

Some pairs have no middle. Behind **symmetric NAT** the router picks a fresh
external port for every destination, so the address STUN reported is not the
address the other side will be talking to. A firewall that permits no
inbound UDP at all has the same effect. No amount of signalling fixes it:
the only path left is a machine both ends can reach *outbound*, which takes
packets from one and forwards them to the other. That is TURN, and it is why
8–15% of pairs could not connect before this existed.

A relay is a last resort, not a route. ICE gathers host, server-reflexive
and relay candidates and tries them in that order, so a relay costs nothing
for the pairs that would have connected anyway.

## What is running

`159.223.6.35`, Ubuntu 24.04, coturn 4.6.1 as `coturn.service`, enabled at
boot. Config in `/etc/turnserver.conf`, log at `/var/log/turnserver.log`.
`aytingchi.uz`, `www.aytingchi.uz` and `turn.aytingchi.uz` are A records
pointing at it.

The same droplet runs `aitutor.service` (FastAPI, port 8000). coturn does
not go near it: it binds only `159.223.6.35` on its own ports, and the ufw
rules added for it are additive.

| Port | Why |
| --- | --- |
| 3478/udp | TURN. The normal path. |
| 3478/tcp | TURN for networks that block UDP outright. |
| 443/tcp | nginx, which splits the port by TLS name: `turn.aytingchi.uz` to coturn, everything else to the website. |
| 80/tcp | nginx: the ACME challenge, and a redirect to https. |
| 5349 | coturn's TLS listener, bound to localhost and the public IP but firewalled off outside. Reached only through nginx. |
| 49160–49200/udp | The relay's allocation range, deliberately narrow so the firewall rule stays small. |

**The bare IP still works and is still the normal path.** A TURN URL is not
an HTTP request — browsers do not apply mixed-content rules to ICE — so the
page at `https://isoqovjorabek2.github.io/monopoly/` can use `turn:` on an
IP with no certificate involved. (That github.io address is where the *game*
is served from. It cannot point at this droplet: GitHub owns DNS for
`*.github.io`.) The domain exists for one reason only: `turns:` on 443 needs
a name to put on a certificate.

## How the game finds it

Three repository secrets, read by the deploy workflow and compiled into the
bundle:

| Secret | Value |
| --- | --- |
| `TURN_URLS` | `turn:159.223.6.35:3478,turn:159.223.6.35:3478?transport=tcp,turns:turn.aytingchi.uz:443` |
| `TURN_USERNAME` | `monopoly` |
| `TURN_CREDENTIAL` | matches `user=monopoly:…` in `/etc/turnserver.conf` |

With none of them set the client builds STUN-only and behaves exactly as it
did before, so the repo is safe to build without any of this. Local builds
read the same three from `.env` (see `.env.example`).

## The credential is public, on purpose

It is compiled into a static bundle. Anyone who opens devtools can read it,
and there is no way around that here: short-lived TURN credentials are
minted by a backend, and not having a backend is the entire point of the
project.

So it is not treated as a secret. It is a public service made cheap to run
and useless to steal:

- `max-bps=100000` — generous for a board game's few KB per action, far too
  little to be worth taking for video.
- `user-quota=50`, `total-quota=100` — a ceiling on how bad a bad day gets.
- `denied-peer-ip` covering every private and reserved range. **This is the
  one that matters.** Without it the relay will forward into the droplet's
  own private networks (`10.18.0.5`, `10.110.0.2`) and anywhere else it can
  route, which is how an open relay becomes a port scanner wearing your IP.

Rotating it is a password change in `/etc/turnserver.conf`, `systemctl
restart coturn`, and updating `TURN_CREDENTIAL`. Old clients fail over to a
direct connection rather than breaking, since the relay was only ever the
fallback.

## Checking it

```bash
npm run check:turn
```

`scripts/turncheck.mjs` sends a real Allocate request from wherever you run
it: once unsigned, expecting the 401 that carries the realm and nonce, then
signed with the long-term credential. A success response carrying
`XOR-RELAYED-ADDRESS` in the 49160–49200 range means an actual internet
client can allocate — which is the only claim worth making. It needs no
browser and no WebRTC stack.

It checks **every** URL in `VITE_TURN_URLS`, over the transport that URL
names, and fails if any of them cannot allocate. UDP, TCP and TLS are
separate listeners behind separate firewall rules, so one of them answering
says nothing about the other two — which is the whole reason there are
three. The TLS check also prints the certificate it was served, so an
expired one shows up here rather than as a player who cannot connect.

Confirmed from outside the droplet on 2026-09-10, 3/3 transports:

```
turn:159.223.6.35:3478  [UDP]           200 SUCCESS  relayed 159.223.6.35:49170
turn:159.223.6.35:3478?transport=tcp    200 SUCCESS  relayed 159.223.6.35:49169
turns:turn.aytingchi.uz:443  [TLS]           200 SUCCESS  relayed 159.223.6.35:49197
```

For a browser-level check, Trickle ICE
(`https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/`)
takes the same three values and should list a candidate of type `relay`.

Two tabs on one machine prove nothing about any of this. The pairs it exists
for are on different networks, so the real test is a phone on cellular.

## Operating it

```bash
ssh aitutor systemctl status coturn
ssh aitutor journalctl -u coturn -f
```

Logs go to journald, not to a file. They were configured to go to
`/var/log/turnserver.log`, but that file is owned by root and coturn runs as
`turnserver`, so every start failed with `Cannot open log file for writing`
and fell back to stderr — which journald caught, so nothing looked broken
while the documented `tail -f` read a file frozen at first boot. The
`log-file` directive is gone and `syslog` is set instead, which also means
journald handles rotation.

Session lines need `verbose`; at the default level coturn logs startup and
nothing else, so allocations left no trace at all. That is on now.

A quiet log with a healthy `systemctl status` means nobody has needed the
relay, which is the normal state. [`panel.md`](panel.md) turns the same
lines into numbers.

## `turns:` on 443, and sharing the port

Some corporate networks allow nothing outbound except TLS on 443. A `turn:`
URL on a bare IP cannot reach those players however many transports it
offers, because the port itself is what is blocked.
`turns:turn.aytingchi.uz:443` is TURN wrapped in TLS on the one port such a
network does allow, and to anything watching it is indistinguishable from an
HTTPS connection.

The website at `https://aytingchi.uz` wants that same port, and only one
process can hold it. **nginx holds it and splits the traffic by TLS name:**

```
                    :443  nginx  (stream, ssl_preread)
                            |
        SNI turn.aytingchi.uz          everything else
                            |                    |
              coturn 127.0.0.1:5349    nginx http 127.0.0.1:8443
```

`ssl_preread` reads the SNI out of the ClientHello and hands the **untouched**
byte stream onward — nginx never terminates TLS on 443, so coturn still
presents its own certificate and does its own handshake exactly as it did
when it had the port to itself. Neither backend gives nginx a private key.

The cost: the stream proxy replaces the client address, so the website sees
every visitor as `127.0.0.1`. PROXY protocol would restore it, but coturn
does not speak it and the directive cannot be set per-upstream, so it is off
for both.

Four things have to stay true, and each is a place this can break:

**A certificate covering both names.** One Let's Encrypt cert for
`aytingchi.uz`, `www.aytingchi.uz` and `turn.aytingchi.uz`. The TURN name
must be a *different* name from the website's, or there is nothing for the
SNI map to switch on.

**A certificate coturn can read.** `/etc/letsencrypt/live` is root-only and
coturn runs as `turnserver`, so it never reads that tree. The deploy hook
`/etc/letsencrypt/renewal-hooks/deploy/coturn-certs.sh` copies the pair to
`/etc/coturn/certs` owned by `turnserver` and restarts the service — a
restart rather than a reload, because coturn reads its certificate once at
startup. **Without the hook the relay keeps serving the expired certificate
until someone restarts it by hand**, which is the quietest way this breaks.

**Renewal that does not need port 80 to itself.** It was `--standalone`,
which binds 80 directly; nginx owns 80 now, so that would have failed at the
first renewal — 89 days after setup, long after anyone was looking. It is
`--webroot -w /var/www/certbot` instead, served by the `:80` vhost.

**coturn reachable on 5349 from nginx but not from outside.** ufw never
opens 5349. It is above 1024, so coturn needs no special capability to bind
it — the `CAP_NET_BIND_SERVICE` drop-in that the 443 version required has
been removed rather than left as cruft that outlives its reason.
