# Monopoly Royale

A browser Monopoly you can actually play with friends who are somewhere else.
Share a link, pick your rules, play. No signup, no install, and no server.

**Play:** https://isoqovjorabek2.github.io/monopoly/

---

## What it is

- **The full official ruleset**, including the parts most people skip: auctions on
  declined purchases, even building, the finite 32 houses / 12 hotels, mortgage
  interest, and forced liquidation before bankruptcy.
- **Every house rule as a switch** — Free Parking jackpot, double salary on GO,
  no auctions, unlimited houses, snake-eyes bonus, and more. The lobby tells you
  how far you have drifted from the printed rules.
- **Peer-to-peer multiplayer.** The host's browser runs the game; everyone else
  connects straight to it over WebRTC. There is no backend to pay for or trust.
- **Bots** at three difficulties that play by exactly the same rules you do.
- **Works on phones**, with the board as the hero and everything else in sheets.

## How multiplayer works

GitHub Pages serves static files and nothing else, so the game uses a
host-authoritative WebRTC star instead of a server:

```
  guest ──┐
  guest ──┼──►  HOST (owns the only real game state) ──► broadcasts snapshots
  guest ──┘         ▲
              guests send intents only, never state
```

- The room code *is* the host's peer id (`GOLD-FALCON-42`), so the invite link
  needs nothing but the hash: `…/monopoly/#/join/GOLD-FALCON-42`.
- Guests send **intents** (`{type:'BUY_PROPERTY'}`). The host validates every one
  against `legalActions()` and rejects anything illegal or spoofed, then
  broadcasts the resulting state. A modified client cannot cheat.
- PeerJS's free public broker is used for the handshake only; after that traffic
  is direct between browsers. It has no SLA, and roughly 8–15% of network pairs
  (symmetric NAT, strict corporate firewalls) cannot form a direct connection at
  all without a TURN relay. The UI says so plainly instead of spinning forever.
- Identity is a `playerId` in `sessionStorage`, not the connection, so a guest
  who drops reconnects into their own seat with their property intact.

**The host must stay on the page.** If they close the tab the room ends — there is
nowhere else for the state to live. Everyone else can drop and rejoin freely.

## Art direction

The look is a 1930s private gaming room: lacquered green felt, brass and
champagne gold, ivory card stock, cinematic depth. Everything visual resolves
to a token in `src/styles/tokens.css` - no component contains a raw hex, a px
shadow, or a magic duration.

**All artwork is drawn as SVG in `src/ui/Pieces.tsx`, not generated as raster.**
That is a deliberate choice, not a fallback:

- The eight playing pieces render at ~16px on the board and ~34px in the player
  rail *from the same source*, staying crisp at both. A raster asset sized for
  the rail turns to mush on the board.
- They tint to each player's colour through `currentColor`, so eight players
  need one drawing each, not eight.
- On a static host with no backend, an asset that is inline in the bundle can
  never 404 and costs no extra request.

The board's centre emblem, the colour-group icons, the houses and hotels, and
the Chance / Community Chest medallions are all built the same way.

## Architecture

```
src/
  game/          the rules engine — pure, deterministic, no DOM, no network
    types.ts       state and action shapes (all JSON-serialisable)
    board.ts       the 40 spaces and every title deed
    cards.ts       the 16 Chance and 16 Community Chest cards
    rng.ts         counter-based PRNG; the whole generator is two numbers
    rules.ts       rent maths + legalActions(), the one source of truth
    engine.ts      reduce(state, action) -> { state, events }
    ai.ts          bots, which choose from legalActions() and nothing else
    settings.ts    the rule switches and presets
  net/           WebRTC transport (protocol + host/guest)
  store/         zustand store gluing engine, transport and UI together
  ui/            React components
    Pieces.tsx     every drawn asset: pieces, buildings, board icons
  styles/        design tokens, board geometry, screen layouts
```

The engine is a **pure function**: no `Date.now()`, no `Math.random()`, no
mutation. Dice come from a seeded counter-based PRNG whose cursor lives in the
state. That means `(seed, actionLog)` replays a game exactly — which is what makes
the tests, the netcode, and any future replay feature all work.

`legalActions(state, playerId)` has three consumers: the UI greys out buttons from
it, the bots pick from it, and the reducer re-validates against it. One definition,
so the UI can never offer a move the rules forbid.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173/monopoly/
npm test           # the engine suite
npm run build      # production build into dist/
BASE_PATH=/ npm run build && npm run preview   # serve from the root instead
```

To test multiplayer properly you need **two different networks** — two tabs on one
machine proves nothing about NAT traversal. Open the room on a phone on cellular.

## Tests

`npm test` runs 35 checks over the engine, including:

- every deed's rent ladder against the printed card
- determinism: same seed + same action log ⇒ byte-identical state
- the reducer never mutates its input, and survives a JSON round-trip
- doubles, three-doubles-to-jail, and the third-turn jail fine
- auctions, including the case where everybody passes
- even building, the house shortage, and hotels returning four houses
- forced liquidation, bankruptcy to a player vs. to the bank
- hostile input: wrong player, unaffordable buys, bids above cash
- a fuzz pass over 60 randomly-played games asserting invariants after every
  action (money never negative, houses conserved, colour groups built evenly)
- a full bot-vs-bot game played to completion

## Deliberate simplifications

Two places where this differs from the printed rules, on purpose:

1. **Bankruptcy to the bank** returns the deeds to the bank unimproved and
   unmortgaged; the official rules auction each one immediately.
2. **"Chairman of the Board"** liquidates the payer's assets up front rather than
   pausing the game for them to choose what to sell, so the other players are
   never left half-paid.

## Credits and trademark

Monopoly is a trademark of Hasbro, Inc. This is a non-commercial hobby
implementation of the public-domain rules for playing with friends, and is not
affiliated with or endorsed by Hasbro.

Built with React, TypeScript, Vite, Zustand, Framer Motion and PeerJS.
