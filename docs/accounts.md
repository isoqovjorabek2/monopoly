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
https://partyhall.io/auth/google/callback
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

## Party Hall Plus

Plus is decided here and nowhere else. `/var/lib/playerauth/plus.json` maps a
player id to a paid-until date; every pass this service signs carries that
date as a `plus` claim while it is still running, so a host believes a Plus
seat the same way it believes the seat itself - by the signature, offline.

| Perk | Where it lives | Who enforces it |
| --- | --- | --- |
| Board themes (Tashkent, Europe) | `src/i18n/themes.ts`, lobby picker | The host, from verified seats (`net/plus.ts`) |
| Piece & dice finishes | `SeatInfo.skin`, `ui/finish.tsx` | The host keeps a finish only on a verified Plus seat |
| Saved games for 90 days, 100 slots | `put_save` here (`ttl` on the record) | This service |
| Game history & stats | `POST`/`GET /history` here, `net/history.ts` | This service: totals for everyone, the game list with Plus |

The table-side perks are cosmetic, so a modified client could draw them for
itself; nothing it could do reaches another player's screen through a host
that is not also modified, and the server-side perks cannot be faked at all.

Routes added for Plus, signed exactly like the saves (pass + browser-key proof):

- `POST /refresh` - a fresh pass for the same player and browser key, stamped
  with their current Plus. The game calls it on load (at most every ten
  minutes) and from "Already bought Plus? Check again", which is how a
  purchase reaches a browser without signing in again.
- `POST /history` - the caller's own result from a finished table. Duplicate
  reports of one game are ignored; a win is only ever first place; the newest
  200 games are kept per player.
- `GET /history` - totals, and the newest 50 games when the caller has Plus.

Granting Plus by hand, until a checkout is wired in (the player finds their id
in the Plus sheet):

```bash
ssh aitutor python3 /opt/opspanel/accounts.py plus u_xxxxxxxxxxxxxxxxxxxx        # show
ssh aitutor python3 /opt/opspanel/accounts.py plus u_xxxxxxxxxxxxxxxxxxxx 30 paid-payme-0915   # add 30 days
ssh aitutor python3 /opt/opspanel/accounts.py plus u_xxxxxxxxxxxxxxxxxxxx -30    # take 30 days away
```

Days are added from the end of any Plus still running, so buying early never
loses time. The player then presses "Check again" (or reloads after ten
minutes) and every table they sit at shows it.

## Selling Plus through Paddle

Paddle is the merchant of record: it runs the checkout, takes the money,
handles tax and refunds, and tells this service by webhook. Plus is granted
only by that webhook, never by the browser.

**Prices.** $2.99 a month and $19.72 a year (`src/net/pricing.ts`, and the
static `public/legal/pricing.html`). Change both together.

**One-time setup in Paddle** (do it in Sandbox first, then again in Live):

1. Catalog → Products: a product "Party Hall Plus" with two recurring prices,
   $2.99 monthly and $19.72 yearly. Note both `pri_...` ids.
2. Developer tools → Authentication: a client-side token (`test_...` in
   sandbox, `live_...` in live).
3. Developer tools → Notifications: a destination
   `https://partyhall.io/auth/paddle/webhook` for `transaction.completed`,
   `adjustment.created` and `adjustment.updated`. Note its secret key
   (`pdl_ntfset_...`).
4. Checkout settings: approve the domain `partyhall.io`; the legal pages at
   `/legal/terms.html`, `/legal/privacy.html` and `/legal/refund.html` are what
   Paddle's domain review looks for.

**Server config**, in `/etc/playerauth/config.json` (then restart `accounts`):

```json
"paddle_webhook_secret": "pdl_ntfset_...",
"paddle_prices": { "pri_monthly_id": 31, "pri_yearly_id": 366 }
```

**Game build**, as GitHub repository *variables* (Settings → Secrets and
variables → Actions → Variables) - they are public by design:
`PADDLE_CLIENT_TOKEN`, `PADDLE_ENV` (`sandbox` or `production`),
`PADDLE_PRICE_MONTHLY`, `PADDLE_PRICE_YEARLY`. Locally, the same names with
`VITE_` in front go in `.env`. Without them the Plus sheet offers no checkout
and falls back to granting by hand.

What the webhook does (`paddle_webhook` in `ops/accounts.py`, tested in
`ops/test_accounts.py`): refuses anything without a valid `Paddle-Signature`
(five minutes of clock tolerance); on `transaction.completed` grants the
configured days for each Plus price to the player id in `custom_data`, or -
for a renewal - to the player that subscription belongs to; on an approved full
refund or chargeback takes that payment's days back. Every event id and
transaction id is processed once. Its ledger is `/var/lib/playerauth/paddle.json`.

**The legal pages** read the operator's name, country and contact email from
`public/legal/site.js`. Fill those in before submitting the domain to Paddle.

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
