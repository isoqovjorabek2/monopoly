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

The same droplet runs `aitutor.service` (FastAPI, port 8000). coturn does
not go near it: it binds only `159.223.6.35` on its own ports, and the ufw
rules added for it are additive.

| Port | Why |
| --- | --- |
| 3478/udp | TURN. The normal path. |
| 3478/tcp | TURN for networks that block UDP outright. |
| 49160–49200/udp | The relay's allocation range, deliberately narrow so the firewall rule stays small. |

**No domain and no certificate are involved.** A TURN URL is not an HTTP
request — browsers do not apply mixed-content rules to ICE — so the page at
`https://isoqovjorabek2.github.io/monopoly/` can use `turn:` on a bare IP.
(That github.io address is where the *game* is served from. It cannot point
at this droplet: GitHub owns DNS for `*.github.io`.) A domain is only needed
for `turns:` on 443 — see the end.

## How the game finds it

Three repository secrets, read by the deploy workflow and compiled into the
bundle:

| Secret | Value |
| --- | --- |
| `TURN_URLS` | `turn:159.223.6.35:3478,turn:159.223.6.35:3478?transport=tcp` |
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

Confirmed working from outside the droplet on 2026-09-09.

For a browser-level check, Trickle ICE
(`https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/`)
takes the same three values and should list a candidate of type `relay`.

Two tabs on one machine prove nothing about any of this. The pairs it exists
for are on different networks, so the real test is a phone on cellular.

## Operating it

```bash
ssh aitutor systemctl status coturn
ssh aitutor tail -f /var/log/turnserver.log
```

Session lines only appear once a client actually allocates; a quiet log with
a healthy `systemctl status` means nobody has needed the relay, which is the
normal state.

## If you later want `turns:` on 443

Some corporate networks allow nothing outbound except TLS on 443. Reaching
those players means TURN over TLS on that port, which does need a real
certificate and therefore a domain name you own:

```conf
tls-listening-port=443
cert=/etc/letsencrypt/live/turn.example.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.example.com/privkey.pem
```

Point `turn.example.com` at the droplet with an A record, issue with
certbot, add `turns:turn.example.com:443` to `TURN_URLS`, and open 443 —
noting that nothing is on 443 today, so it is free.
