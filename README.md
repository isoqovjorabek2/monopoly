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

## The board is 3D

The default board is a real three.js scene: a lit object on a table rather than
a diagram of one. Perspective, brass that actually reflects, dice that tumble
and land, pieces that hop in arcs, and a camera that leans toward whatever the
game is drawing attention to.

It is **lazy-loaded**: three.js is a 227KB gzipped chunk that only downloads
when the 3D board is actually used, so the main bundle stays at ~144KB and a
player who prefers the flat board pays nothing for the one they don't use.

There is a **flat board toggle in the game header**, and the flat board is
selected automatically when WebGL is unavailable or the reader has
`prefers-reduced-motion: reduce`. Both renderers read the same `GameState` and
the same `animPos` from the store, so they are interchangeable and the engine
never learns that 3D exists.

Everything in the scene is procedural geometry and canvas textures generated at
runtime - the eight pieces, the houses and hotels, the tile faces, the dice
pips, the centre medallion. Nothing is downloaded, so there is no model to
license, no texture to 404, and no CDN in the critical path.

Two things worth knowing if you work on it:

- **The engine decides the roll before anything moves.** `Dice3D` only plays the
  throw and lands on the value it was given; it snaps to that value when there
  is no animation to play, so a player joining mid-turn always sees the truth.
- **Camera framing accounts for foreshortening.** A flat board seen from
  elevation θ is only `span × sin(θ)` tall on screen. Framing to the raw span
  leaves the board tiny, and a zero width on the first measure makes the
  distance `Infinity`, which puts a NaN in the camera matrix and silently
  blanks the entire scene.

## Art direction

The look is a 1930s private gaming room: lacquered green felt, brass and
champagne gold, ivory card stock, cinematic depth. Everything visual resolves
to a token in `src/styles/tokens.css` - no component contains a raw hex, a px
shadow, or a magic duration.

**Everything that scales or tints is drawn as SVG in `src/ui/Pieces.tsx`, not
generated as raster.** That is a deliberate choice, not a fallback:

- The eight playing pieces render at ~16px on the board and ~34px in the player
  rail *from the same source*, staying crisp at both. A raster asset sized for
  the rail turns to mush on the board.
- They tint to each player's colour through `currentColor`, so eight players
  need one drawing each, not eight.
- On a static host with no backend, an asset that is inline in the bundle can
  never 404 and costs no extra request.

The colour-group icons, the houses and hotels, and the Chance / Community Chest
medallions are all built the same way. So are the tile faces, which carry
property names and prices and are drawn to a canvas in `src/ui/three/tileFace.ts`
- text has to stay text.

### The generated set

Everything a vector could not supply - woven cloth, engraved metal, printed
illustration, a lit room, falling coins - is an image in `public/art`,
generated with FLUX.2 and MiniMax H3 and addressed through `src/art/art.ts`.
64 files, about 2.2 MB, almost all of it fetched only when it is needed.

| Group | Files | Where | What it replaced |
| --- | --- | --- | --- |
| `felt-*` | 4 | the block the plaques sit in, and the inner surface | two flat greens |
| `medal-*` | 4 | the centre emblem under the wordmark | 48 drawn wedges and two rings |
| `hero-*` | 4 | the home screen backdrop | an empty dark page |
| `cards/ch*`, `cards/cc*` | 32 | the drawn-card modal | nothing - the card was text only |
| `cards/back-*` | 2 | the reverse of a card mid-flip | nothing - there was no flip |
| `stickers/*` | 12 | the chat composer | nothing - chat was text only |
| `fx/*` | 3 | table effects on cash, a win, a bankruptcy | nothing |
| `paper`, `table`, `og` | 3 | card stock, the 3D tabletop, the link preview | flat cream, empty fog, no preview |

**Card illustrations** are one engraved vignette per card, keyed by card id, so
"Speeding fine" and "Go to Jail" never share a picture. The generated ivory
ground is multiplied into the card stock and its edges are feathered with a
mask, so the art sits *on* the paper rather than in a pale box on top of it.

**Stickers** travel as ordinary chat text - `:sticker:money:` - so no protocol
change was needed and an unknown id degrades to visible text rather than a
broken image. They are WebP with real alpha, cut out with `rembg`.

**Effects** are 16 frames of a generated clip in one strip; CSS `steps()` walks
it once. No `<video>`, no decoder, no alpha channel: the clips were rendered on
black and the effect layer is composited with `screen`, which drops the ground.
Two details matter and both bit on the way in - the timing function has to be
`steps(16, jump-none)` ending 15 cells along, or the last frame lands one cell
past the strip and freezes on black; and the blend has to sit on the `.fx`
container, because a stacking context forms an isolated group and a blended
child of one has nothing behind it to blend with.

None of this scales, tints per player, or carries text, so the reasons above do
not apply. Three rules keep them honest:

- **They degrade.** `useArtTexture` loads by hand instead of suspending, and
  reports `null` on failure, so a missing file falls back to exactly the
  procedural drawing it replaced. The board never depends on an image, an
  unknown sticker id renders as text, and the effect layer is decoration that
  sits behind pointer events and never blocks a turn.
- **They are pre-graded.** Each felt texture is scaled so its average is the
  board's own felt colour, which means swapping variants changes the weave and
  never how dark the board reads.
- **They avoid alpha where blending will do.** The medallion and the three
  effect strips are drawn on black and composited with `additive` / `screen`,
  which keeps them JPEGs instead of PNGs several times the size. Only the
  stickers, which sit on an unknown background, actually carry an alpha
  channel - and those are WebP, not PNG.

Everything obeys `prefers-reduced-motion`: the effect layer does not play at
all, and the home backdrop stops being fixed-attachment.

Only the first three groups have variants. Four versions of each ship, and any
of them can be previewed without a rebuild:

```
?art=3              every surface at version 3
?felt=1&medal=4     one surface at a time
```

A choice made in the URL is remembered; the committed defaults live in
`DEFAULTS` in `src/art/art.ts`.

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
    Pieces.tsx     every drawn 2D asset: pieces, buildings, board icons
    BoardStage.tsx picks the 3D or flat renderer, with capability fallback
    three/         the 3D board: layout, tile textures, pieces, dice
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

Everything in `public/art` was generated via fal.ai: stills with FLUX.2
[klein], the three effect clips with MiniMax H3, and the sticker cutouts
through `rembg`. They are original material, ornament and illustration - no
trademarked mark, character or board design is reproduced in any of them.

Sound is still synthesised in the browser with WebAudio (`src/audio/sfx.ts`)
rather than shipped as files, for the same reason the playing pieces are still
SVG: zero bytes and nothing to 404.
