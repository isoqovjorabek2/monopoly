# Player accounts

"Sign in with Google" for players. It does two things and nothing else:

- **Your seat comes back from any device.** A guest's seat is tied to the
  browser tab it was taken in. A signed-in player's seat is tied to their
  account, so closing the tab, switching to a phone, or losing the
  connection and coming back later all land them in the same chair. Opening
  the table on a second device moves the seat there and tells the first why.
- **You can join a game that has already started.** A guest is turned away
  from a game in progress, with a prompt to sign in. A signed-in player comes
  in watching, and can take over any bot still in the game: its cash, deeds,
  contracts and turn become theirs.

Guests still play exactly as before.

## How it works without a game server

The game still has no game server: a table lives in its host's browser. So
an account cannot be a session that a server checks on every move - nothing
is on that path to check it. It is a **pass** instead.

```
  browser ──sign in──► aytingchi.uz/auth ──► Google
     ▲                        │
     └──── pass (signed) ─────┘

  browser ──HELLO + pass──► host's browser: checks the signature itself,
                            with the public key compiled into the game
```

- `ops/accounts.py` does the Google round trip and signs a pass: a compact
  ES256 JWT saying "this is player `u_xxxx`, called Asil, for 30 days".
  The signing key is ECDSA P-256 and never leaves the droplet.
- The public key is in `src/net/accountKey.ts`. The host's browser verifies
  every pass with WebCrypto before it binds a connection to a seat
  (`HostNet.helloWithPass` in `src/net/net.ts`). No request to any server is
  made on the way into a room, so a host on GitHub Pages works the same.
- The pass carries an **opaque id**, derived from Google's account id with a
  keyed hash, and a display name. No email address: passes travel to other
  players' browsers, and nobody at a table needs anyone's email.
- Beside the pass, in the same fragment, comes a **profile** for the player's
  own screen: their full Google name, address and picture. It is not signed
  and not inside the pass, and it never leaves that browser - the account
  section on the front door shows it, and the table name defaults to the
  Google name. Hosts only ever see the pass.
- The pass comes back from Google in the URL **fragment**, which browsers
  never send to a server, so it stays out of every access log. Sign-in runs
  in a popup, so a page holding a table never navigates away.

### What stops a forged seat

| Attempt | What happens |
| --- | --- |
| Claim an account id (`u_…`) without a pass | Refused: `auth_invalid` |
| A pass signed with any other key, altered, or expired | Refused: `auth_invalid` |
| Send a `verified` field in HELLO | Stripped; only the host's transport sets it |
| A valid pass for the host's own seat, or a bot nobody took over | Refused: `seat_taken` |
| A seated player sends `TAKE_SEAT` to hop to a bot | Ignored: only a connection bound to its own account id - a watcher - may |
| Take a seat a person already plays | Ignored: only bots can be taken over |
| Claim a taken-over bot's id as a guest | Refused: those seats stay reserved; only the owning pass gets in |

Which account plays which taken-over bot is kept in the room snapshot
(`owners`), so a host hand-over still knows. `src/net/account.test.ts`
covers the table above and verifies a pass signed by `ops/accounts.py`
itself, so the browser and the server provably agree on the format.

## What is running

| | |
| --- | --- |
| Service | `accounts.service`, user `playerauth`, `127.0.0.1:9200` |
| Public route | nginx `location /auth/` in `/etc/nginx/sites-available/aytingchi` |
| Source | `ops/accounts.py`, deployed to `/opt/opspanel/accounts.py` |
| Config | `/etc/playerauth/config.json` (root:playerauth, 0640): Google client, state and id secrets |
| Signing key | `/etc/playerauth/signing-key.pem` (root:playerauth, 0640) |

Routes: `/auth/google/start?return=…`, `/auth/google/callback`, `/auth/key`
(the public JWK), `/auth/health`. A return address must be aytingchi.uz,
the GitHub Pages site, or localhost; anything else is refused before Google
is involved.

## The one Google setting

The service has its own OAuth client, separate from the status panel's; its
id and secret are in `/etc/playerauth/config.json`. That client needs this
**authorised redirect URI** in Google Cloud Console → APIs & Services →
Credentials:

```
https://aytingchi.uz/auth/google/callback
```

Until it is added, Google answers `redirect_uri_mismatch`. If the OAuth
consent screen is still in **Testing**, only its listed test users can sign
in; set it to **In production** for everyone. The scopes used are `openid`,
`profile` and `email`, which need no Google verification.

## Operating it

```bash
ssh aitutor systemctl status accounts
ssh aitutor journalctl -u accounts -f            # sign-in failures are logged here
ssh aitutor python3 /opt/opspanel/test_accounts.py
```

Re-running setup is safe; it never replaces a key or secret:

```bash
scp ops/accounts.py ops/accounts-init.py ops/test_accounts.py aitutor:/opt/opspanel/
scp ops/accounts.service aitutor:/etc/systemd/system/
ssh aitutor 'python3 /opt/opspanel/accounts-init.py && systemctl daemon-reload && systemctl restart accounts'
```

**Testing a table without Google.** `python3 /opt/opspanel/accounts.py mint
u_sometester000000001 Tester` prints a valid pass for a made-up player. Open
`https://aytingchi.uz/#auth=<pass>` in a fresh browser to be that player.
Only root on the droplet can do this, since it reads the signing key.

**Rotating the key** invalidates every pass (everyone signs in again): delete
`signing-key.pem`, re-run `accounts-init.py`, restart the service, put the
new `accounts.py pubkey` output in `src/net/accountKey.ts`, and redeploy the
game.

## Limits worth knowing

- A seat comes back **while the table is open**. The game lives in the host's
  browser; if every player leaves, there is no table to return to. A host who
  drops is replaced by the next connected player, as before.
- Only bots can be taken over, so a mid-game join needs a bot at the table.
  A human who left for good is played by the timeout autopilot, not offered
  as a seat.
- Started games appear in the public room list only while they still have a
  bot seat to take (`inProgress` + `openSeats` in the lobby heartbeat), and
  only signed-in players are shown those rows. Otherwise a mid-game join is
  by room code or invite link.
