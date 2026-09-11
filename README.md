# Monopoly Royale

Two board games you can actually play with friends who are somewhere else:
Monopoly, and **Cashflow** - the one about getting out of the Rat Race. Pick
one on the front door, share a link, play. No signup, no install, and no
server.

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
- **Bots** at three difficulties that play by exactly the same rules you do, and
  that open trade negotiations for the deed they need instead of waiting to be
  asked.
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
  (symmetric NAT, strict corporate firewalls) have no direct path to each other
  at all — behind symmetric NAT the address STUN reports is not the address the
  other side will see, so there is no middle for the two to meet in.
- Those pairs need a **relay** both ends can reach outbound, which is the one
  thing a static host cannot provide. There is one: coturn on a small droplet,
  reached over a bare IP because WebRTC does not apply mixed-content rules to
  ICE, so no domain or certificate is involved. ICE only picks a relay
  candidate when nothing direct works, so it costs nothing for everyone else.
  [`docs/turn.md`](docs/turn.md) covers what runs, why the credential is public
  on purpose, and the quotas and denied peer ranges that keep a public relay
  from becoming somebody else's bandwidth. `npm run check:turn` proves it
  allocates without needing a browser. With the three secrets unset the client
  builds STUN-only and says so plainly instead of spinning forever.
- Identity is a `playerId` in `sessionStorage`, not the connection, so a guest
  who drops reconnects into their own seat with their property intact.

**The host must stay on the page.** If they close the tab the room ends — there is
nowhere else for the state to live. Everyone else can drop and rejoin freely.

## The board is 3D

The default board is a real three.js scene: a lit object on a table rather than
a diagram of one. Perspective, brass that actually reflects, dice that tumble
and land, pieces that hop in arcs, and a camera that leans toward whatever the
game is drawing attention to.

It is **lazy-loaded**: three.js is a ~230KB gzipped chunk that only downloads
when the 3D board is actually used, so the main bundle stays at ~208KB and a
player who prefers the flat board pays nothing for the one they don't use.
(~178KB before Cashflow; its rules and three dictionaries are the difference,
and its table is a separate chunk on top.)

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
78 files, about 2.4 MB, almost all of it fetched only when it is needed.

| Group | Files | Where | What it replaced |
| --- | --- | --- | --- |
| `felt-*` | 4 | the block the plaques sit in, the inner surface, **and the flat board's cloth** | two flat greens |
| `corners/*` | 4 | the four corner emblems on the flat board | four small drawn icons |
| `groups/*` | 10 | one motif per colour set, plus stations and utilities | flat felt |
| `medal-*` | 4 | the centre emblem under the wordmark | 48 drawn wedges and two rings |
| `hero-*` | 4 | the home screen backdrop | an empty dark page |
| `cards/ch*`, `cards/cc*` | 32 | the drawn-card modal | nothing - the card was text only |
| `cards/back-*` | 2 | the reverse of a card mid-flip | nothing - there was no flip |
| `stickers/*` | 12 | the chat composer | nothing - chat was text only |
| `fx/*` | 3 | table effects on cash, a win, a bankruptcy | nothing |
| `paper`, `table`, `og` | 3 | card stock, the 3D tabletop, the link preview | flat cream, empty fog, no preview |

**Corner emblems** are the flat board's share of this. GO, Jail, Free Parking
and Go To Jail were four SVG icons at a size where they read as clip art; they
are now engraved vignettes on pure black, composited with `screen` so the
ground drops out against the felt with no alpha channel to pay for. The black
point is graded to true zero first, because JPEG ringing around linework that
fine leaves the ground sitting around 8-14, and `screen` turns any non-zero
ground into a haze over the whole tile. The label moved to the bottom quarter
of the square so the emblem is not sitting under the type, which at ~50px
turns both to mush.

**Colour-set motifs** are how a set reads as a set before you have read a single
name: twelve squares share ten pictures rather than each carrying its own, which
is what keeps this ten files instead of twenty-eight. Same contract as the
corners - engraved on black, `screen`, no alpha - anchored to the outer edge of
the plaque, away from the name, and the first thing dropped at phone board sizes.

The 3D board carries the same set, drawn into its canvas tile faces rather than
laid on as CSS. That needs one extra move: a face is drawn synchronously the
moment its tile mounts, and the ornament is a raster file that is not there yet.
So the faces are drawn once without it, the images load in the background, and
`onFaceArtReady` tells the board to draw them again - a face that waits on a
network image is a board that does not appear, and a 404 has to cost the
ornament and nothing else. The corners take their emblems the same way, and the
plaque tops gained a clearcoat so the board reads as a lacquered object rather
than a texture on a box.

They are **abstract deco ornament, in the set's own colour**, and that took two
attempts. The first set was illustration - a trumpet for the oranges, a streetcar
for the light blues - which is a fine idea at card size and noise at the ~47px a
tile actually gets: too much detail to resolve, and literal enough to read as
clip art pasted onto an engraved board. The replacements are ziggurats, chevrons,
lattices and starbursts: one bold silhouette each, so what survives at tile size
is a shape and a colour, which is exactly what you need to tell one set from
another at a glance. Which is also why they carry the set's colour rather than
plain brass - the same reason the printed board has a colour band.

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

The flat board draws on the same set. It used to be gradients pretending to be
cloth: it now has one continuous piece of felt under the whole grid rather than
forty repeats of a swatch - the plaques above it are translucent, so the weave
runs through them and through the seams between - and the centre carries the
generated medallion under the drawn one. The generated one is masked to an
annulus and kept faint on purpose: at any real strength its concentric linework
sits exactly where the wordmark is and buries it, and the middle of the board is
where the dice and the turn HUD live.

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

## The front door

The shape a generated landing page takes is well enough known to be a tell, and
this one had five of them: a centred hero under an all-caps badge, a lead
paragraph, three identical action cards, a row of chips, and grey body text on
dark. Every one of those is on the published lists of
[what marks a page as vibe-coded](https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it),
and the fix those lists converge on is the one thing a template cannot do:
commit to decisions that are specific to *this* product.

So the page is asymmetric and has one subject. The masthead is ranged left and
set as a printed plate - the second word hanging off the first on a rule, the
way a plate on a door does - rather than a headline with a label floating above
it. There is **one** primary action, because hosting, joining and playing alone
are not three products; joining is a field under it and solo is an aside.

And it shows the artefact. A real **title deed** lies at an angle across the
lower half, built from the same `BOARD` data the game is played with, so the
rent ladder printed on it is the rent you will actually pay. A board game whose
front page is only type is a front page for anything.

The lead copy carries full ink rather than `--text-muted`: body text in medium
grey on a dark ground is the contrast failure those same lists call out, and the
lead is where the argument is made.

## Playing it

The board is the thing you look at; everything else tries to stay out of the
way. Three decisions carry most of that:

- **Space advances the turn** - roll, continue through a card, end the turn -
  from anywhere on the page. It is bound to a `data-hotkey="advance"` attribute
  rather than to a phase, so it always does whatever the primary button says.
  Buying, bidding and declaring bankruptcy are deliberately *not* on a key: a
  stray space bar should never spend money.
- **`?` opens the reference** - rent for railroads and utilities, the even-build
  rule, how jail resolves. Mid-game rules questions used to mean leaving the
  game to look something up, which is the memory-load problem
  [NN/g describes in board games](https://www.nngroup.com/articles/usability-heuristics-board-games/):
  recognition over recall, so the numbers are one key away.
- **Controls say why they are dead.** A disabled button with only a tooltip is
  invisible to a touch user and easy to miss on a mouse; the home screen now
  states what is missing instead.

### Seeing the board

The board is sized off the shorter viewport axis so it is always square and
always whole, which on a wide screen leaves a small board ringed by empty felt.
Two controls under it fix that, and they are deliberately separate:

- **Zoom**, 82% to 150%, remembered between sessions because it is a property of
  the player's eyesight and monitor rather than of the game. Past the height the
  rails leave, the page scrolls rather than cropping the board.
- **Full screen** (`F`) folds the rails away, floats the action panel over the
  felt, and asks the browser for real fullscreen on top. The layout half stands
  on its own when that request is refused - iOS Safari has no
  `Element.requestFullscreen`, and the request needs a real user gesture - so
  the button always does something.

A game **opens into full screen by itself**. The click on Start is a user
gesture a second old, so the browser usually grants the real thing too. Folding
the rails back out is remembered: a player who does it once is not asked again
next game.

Once you are in it, the chrome goes with the rails. The header carries nothing
you need mid-turn - leaving, the renderer toggle, sound, the rules - so it
leaves the layout entirely and slides back when the pointer goes looking along
the top edge, or when anything in it takes keyboard focus. The view controls do
the same at the bottom.

The **player rail** does not, and that took two goes to get right. It was hidden
outright in full screen, then put behind a hover, and both were wrong for the
same reason: who is winning and who is nearly broke is not chrome, it is the
state of the game, checked between every roll. Information you consult that
often should not cost a gesture. It floats over the felt instead, which costs
the board a strip it has plenty of. `Esc` leaves, and it is handled directly for the case
where the fullscreen request was refused and there is no fullscreen for `Esc`
to exit on its own.

**In full screen the 3D board takes the whole window**, rather than the square
the flat board needs. A square container is a requirement a Monopoly board has
and the 3D scene only inherited by sharing a box with it: a camera fills
whatever frame you give it, so a wide window is simply a wider shot of the same
table. Full screen also drops the shell's centred 1560px column and its
padding, which were otherwise 180px of dead black down either side of a 1920
monitor, and floats the view controls instead of leaving them a 42px row the
board does not get.

### Colour on the 3D board

The same eight colours that carry the sets read vividly on the flat board and
washed out in 3D, for two reasons that both had to go.

The first is the tone map. `@react-three/fiber` reaches for **ACES Filmic** by
default, which is a film curve, and film curves desaturate saturated colour on
purpose - it is what stops highlights clipping in a photograph. On a board whose
whole legibility rests on eight flat colours being told apart that is the wrong
trade, so this uses **Khronos PBR Neutral**, which tone maps the highlights
without taking the chroma with them. The second was self-inflicted: a 38% white
highlight painted across the top half of every colour band.

The bands also carry a tiny **emissive map** now - their own colour on black,
twenty pixels wide, everything black emitting nothing. A printed board's bands
are ink, and ink in a dimly lit room goes dark; these are inlay, and hold their
colour in shadow, which is what lets you read the sets at an angle where the
lights are not helping.

### Framing the 3D board

Fitting the board in the frame has been wrong twice, in opposite directions.
Framing to the raw span left it tiny. Foreshortening it - `span x sin(elevation)`
- is the orthographic answer, and orthographic is exactly what a perspective
camera is not: the near edge is closer than the middle and subtends a much
larger angle than the average. That put the near edge **20.1 degrees** off the
view axis against a **19 degree** half-FOV on every landscape window, and the
front row of the board was quietly cropped off the bottom of the screen.

`fitDistance()` asks the real question instead: place the four corners, and
bisect for the smallest distance at which all of them are inside the frustum.
The angle shrinks monotonically as the camera retreats, so bisection is both
correct and quick, and it runs once per resize. The corners are padded past the
board itself, because the rig leans toward the active square and an edge fitted
exactly is an edge that clips the moment it moves. Worst-case corner angle is
now 15.6 degrees at 16:9, with the margin going to the lean.

Two things the board answers without a modal now:

- **Hovering a square shows what it is worth** - owner, price, and the rent it
  currently charges - and so does arrowing onto it. Opening a modal to compare
  two parts of the board costs you the view of the board you were comparing.
- **The forty squares are one composite widget**, not forty tab stops. One tile
  is in the tab order and the arrow keys walk around the ring, Home and End jump
  to GO and Free Parking. The flat board is also `inert` while it stands in
  underneath the 3D canvas, which it was not before: tabbing through a 3D game
  used to walk an invisible board.

## The bots negotiate

A Monopoly table where nobody trades is a dice game. Sets end up split three
ways, no monopoly is ever completed, and the winner is whoever landed on the
most railroads. So the bots open negotiations rather than only answering them.

Valuing a deed properly is most of the work. A deed in a colour group an
opponent otherwise owns is not two-thirds of a set — it is a **blocker**: it
can never earn, and its whole worth is that it stops someone else's monopoly.
The scoring used to read it as progress towards a set, which is exactly
backwards, and it is why a bot could not see the deal sitting in front of it.
The deed that *finishes* a set is priced at a multiple of its list price,
because a monopoly roughly triples unimproved rent and is the only thing that
lets you build at all.

The search is deliberately narrow — one deed in, at most one deed out, cash to
balance. The interesting deal in Monopoly is nearly always the same shape:
*you hold the last deed of my set, I hold the last deed of yours.* Anything
wider is that deal plus noise, and the space of subsets is far too large to
score honestly inside a turn.

Both chairs use the same arithmetic. `tradeGain(state, playerId, offer)` reads
an offer from whichever side you hand it, so a bot never proposes a deal it
would refuse sitting opposite. The proposer prices the cash leg so the *other*
side comes out ahead by a premium, then checks what is left still clears its
own bar: a hard bot pays near the floor and holds out for a real edge, a normal
bot overpays and settles for a thin one, and an easy bot answers offers but
never opens with one. Difficulty is judgement, never information — every bot
reads only the deeds and cash that are face-up on the table anyway.

Two things keep it from becoming spam. Both live in the engine rather than in
the bot, because the bots are pure functions of the state: anything they
remember has to be part of it, or it would not survive a reconnect.

- **A refusal cools the pair off.** A decline is recorded in `tradeCooldowns`
  against the turn number, and that bot will not put a deal in front of you
  again for eight turns. Without it, the offer you just declined comes straight
  back on the next tick.
- **An unanswered offer lapses** after six turns. One left hanging used to pin
  its author out of trading for the rest of the game — the recipient keeps a
  modal they never asked for, and the proposer, which holds only one offer open
  at a time, never composes another.

One place they stop short on purpose: a bot facing a debt it cannot pay
mortgages and sells rather than trading its way out. Raising money is a
sequence with a deadline, and an offer that may never be answered is not a step
you can put in the middle of one.

## Trading

Trading is where a Monopoly game is actually decided, and it is the screen
people give up on. A list of deeds and two number boxes asks the player to know
three things the board never tells them: which deed finishes whose set, what a
deed is worth to the other chair, and whether the offer they just built stands
any chance of being accepted.

So the panel answers all three:

- **A deed looks like it does on the board.** Every trade surface used to print
  bare short names - "St. Charles, $140" - which asks the player to hold the
  whole board in their head to work out what is on the table. Deeds are now
  chips carrying the set's colour down one edge and the set's ornament behind
  them, so a deed in a list is recognisably the same object you have been
  staring at all game. The ornament is masked off at both ends: one that makes
  the price it covers unreadable is worse than no ornament at all.
- **Deeds are grouped into their sets** and counted (`2/3`), because "two of the
  three oranges" is the unit a player thinks in and an alphabetical list is not.
  A deed that would complete a set *for whoever receives it* is badged, on both
  sides - that badge is the whole game of trading in one word.
- **The running balance is shown from both chairs**, using the same valuation
  the bots trade on. You can see what you are gaining and what they are.
- **Against a bot the verdict is exact.** `acceptMargin()` is the function the
  bot itself answers with, so "Ada will take this" is not a guess - it is the
  same arithmetic, read early. Tune the offer until it says yes rather than
  sending it and hoping. Against a human it says so instead of pretending to
  know.
- **Suggest a deal** composes an offer outright, from the same search a bot uses
  to open a negotiation - including the case where you are the one holding what
  they need, where it proposes a sale rather than a swap. When neither side is a
  deed from a set it says so rather than inventing something.
- A deed that cannot move says why, under the control, rather than being greyed
  out with a tooltip a touch user never sees.

**An offer somebody sends you** gets the same treatment, and needed it most: it
was two lines of bare short names with no colour and no indication of whether
the deal was any good, asking you to reconstruct the board from memory to answer
a yes/no question with your money on it. It now shows the deeds as chips, badges
the ones that finish a set for either side, marks the two halves as what you
receive and what you give, and states what the deal is worth to you.

The engine tests cover the join between the two: that a suggested deal is one
the reducer accepts *and* the bot then takes, and that an offer predicted to be
refused is refused. If those two drifted apart the panel would start lying, which
is worse than saying nothing.

## Sound

Eleven recorded cues in `public/audio`, mono and 77KB for the whole set, fetched
once on the first sound and only if sound is on. Each is trimmed to the
transient, loudness-matched, then mixed per cue in `MIX` - a footstep that fires
on every tile a piece walks over cannot sit at the same level as a stamp.

## When the GPU drops the board

A WebGL context can be lost at any time - a laptop switching GPUs, a driver
reset, memory pressure - and nothing recovers from it on its own. Left alone,
three stops drawing, the canvas paints **solid white** over the board, and the
next frame throws deep in the renderer and takes the whole game with it.

`BoardStage` handles all three parts of that:

1. The canvas unmounts in the same tick as the loss, which stops three
   rendering into a dead context.
2. `.stage3d__canvas` is hidden until it has drawn a frame, so the flat board
   waiting underneath shows through instead of a white rectangle.
3. The scene remounts after 700ms - the renderer, its programs and every
   texture went with the context, so it is rebuilt rather than resumed. Two
   losses are a hiccup worth riding out; a third drops to the flat board for
   good rather than flashing at the player.

An error boundary around the 3D tree backs all of that up: any throw out of
three costs the board, never the game everyone is in the middle of.

## Cashflow

The second table. Pick it on the front door and everything else - room
codes, invite links, bots, chat, the three languages - works exactly as it
does for Monopoly. The structure follows the published game (a Rat Race you
go round and round, a Fast Track you earn your way onto); the cards, the
numbers and the art are this project's own.

**How it plays**

- Everyone is dealt one of **twelve professions** at random - a salary, taxes,
  a mortgage, loans, a per-child cost - and opens with savings plus one pay
  cheque. The janitor is often out first: a big salary comes with big bills.
- **The Rat Race** is 24 squares on one die. *Opportunity* draws a Small Deal
  (≤ $5,000 in) or a Big Deal (≥ $6,000); *Pay Check* pays monthly cash flow
  for passing as well as landing; *The Market* brings a buyer for what somebody
  holds, and **everyone** holding it may sell (you keep the price less the
  mortgage); *Doodads* are bills you cannot refuse; *Charity* gives 10% of
  income for a second die on three turns; *Baby* adds a child (three at most);
  *Downsized* costs a month of expenses and two turns.
- **Bank loans** come in $1,000s at 10% a month. With *strict lending* (on by
  default, a lobby switch) the bank lends only while monthly cash flow stays
  at or above zero - otherwise a player borrows into every deal and the Rat
  Race stops being one. A bill that has to be paid borrows the shortfall
  regardless.
- You leave the Rat Race at the start of any turn on which **passive income
  beats total expenses**, with a hundred times your passive income as your
  CASHFLOW Day income, paid on the way out.
- **The Fast Track** is 40 squares on two dice: businesses (one owner each),
  ventures (stake cash on a roll), audits and lawsuits (half your cash),
  divorce (all of it), and eight dreams. A rival landing on your dream adds
  100% of its price.
- **You win** by buying your dream, or by building CASHFLOW Day income to your
  starting figure plus $50,000 (a lobby slider). An optional round limit ends
  it early for whoever got furthest.

**Where it deliberately differs from the printed rules**

1. **Bankruptcy is automatic.** The printed rule lets you choose what to sell;
   here it is one deterministic sequence - sell whatever earns nothing at half
   its down payment, pay the dearest debts first, halve car, card and retail
   debt - so a bankruptcy never waits on a menu. Still negative and you are out.
2. **An Opportunity card cannot be sold to another player.** The printed game
   lets you sell the option; that is a negotiation with no clock on it.
3. **Cashflow tables are invite-only.** The public directory only knows
   Monopoly's presets, so a Cashflow room on it would be listed as a Monopoly
   one. The lobby says so instead of pretending.

**How it is built.** `src/cashflow/` keeps the Monopoly engine's contract to
the letter: a pure `reduce(state, action)`, dice from the seeded counter in
the state, JSON-only state, and one `legalActions()` that the buttons, the
bots and the reducer all read. The room carries a `kind`, the protocol went
to version 2 for it, and guests receive Cashflow snapshots with the seed and
the undrawn decks stripped, the same as Monopoly's. The bots are rules
rather than a scoring search - buy what clears a cash-on-cash return, borrow
only when the deal out-earns the loan payment, sell into a buyer who doubles
the money - and a bot that turns over a card a human could sell into holds
the turn open for five seconds so the human gets the chance.

**The board** is two concentric rings of SVG sectors on a 1000-unit square,
so every screen gets the same geometry; labels run along the spokes and turn
over on the left half so nothing is read upside down. Beside it sits the
financial statement - income, expenses, the pay cheque, assets, liabilities -
because that, not the board, is what the game is about. Pay off a debt or
take a loan from it on your own turn.

**The art** is 37 images generated with FLUX.2 [klein] 9B on fal.ai: two
covers that pair as the front door's choice, fifteen square emblems, eight
dreams and twelve profession portraits. Where the Monopoly set is deco brass,
this one is banknote engraving - mint and champagne linework on pure black,
black point graded to true zero and composited with `screen`, the same trick
the Monopoly corners use. About 1.9 MB, and only the cover loads before you
sit down at a Cashflow table; the table itself is a separate 9 KB chunk.

## Architecture

```
src/
  cashflow/      the second game: same contract - pure, seeded, one legalActions()
    data.ts        professions, both tracks, all four decks
    rules.ts       the financial statement maths + legalActions()
    engine.ts      reduce(state, action) -> { state, events }
    ai.ts          bots that buy what pays for itself
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
npm run check:turn # prove the TURN relay still allocates (reads .env)
npm run build      # production build into dist/
BASE_PATH=/ npm run build && npm run preview   # serve from the root instead
```

To test multiplayer properly you need **two different networks** — two tabs on one
machine proves nothing about NAT traversal. Open the room on a phone on cellular.

## Tests

`npm test` runs 48 checks over the engine, including:

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
- trading bots: that a composed offer is always one the reducer will take, that
  a declined deal is not re-sent, that an unanswered one lapses, and that four
  full bot games close real deals rather than only proposing them
- a full bot-vs-bot game played to completion

Cashflow has its own 24, in `src/cashflow/cashflow.test.ts`: the tables (every
profession starts cash-positive, Small Deals stay small), pay cheques for
passing, strict lending and the loan maths, a doodad that forces a loan, the
hundred-times buyout onto the Fast Track, dream pricing and both Fast Track
wins, hostile and malformed intents, determinism and the JSON round trip, a
fuzz pass over 40 random games, and six full bot games that must all escape
the Rat Race and finish.

The netcode tests include the seat takeover this project used to allow: the
host's own seat and every bot's are reserved, because they never connect and
so never had a secret on file - the first HELLO claiming one used to simply
get it, and with it the host's turns and powers. In all, `npm test` runs 96
checks.

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

CASHFLOW is a registered trademark of CASHFLOW Technologies, Inc. The
Cashflow table follows the structure of that game for playing with friends,
non-commercially; its cards, figures, text and art are original to this
project, and it is not affiliated with or endorsed by CASHFLOW Technologies
or The Rich Dad Company.

Built with React, TypeScript, Vite, Zustand, Framer Motion and PeerJS.

Everything in `public/art` was generated via fal.ai: stills with FLUX.2
[klein], the three effect clips with MiniMax H3, and the sticker cutouts
through `rembg`. The Cashflow set (`public/art/cashflow`, and the two picker
covers) is FLUX.2 [klein] 9B. They are original material, ornament and
illustration - no trademarked mark, character or board design is reproduced
in any of them.

The eleven table cues in `public/audio` were generated with CassetteAI's sound
effects model. The synthesised WebAudio cues they replaced are still in
`src/audio/sfx.ts` and still wired up: they cover the moment before the samples
finish decoding, and they cover a sample that 404s or fails to decode, so sound
degrades rather than stopping.
