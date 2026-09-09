import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BOARD, GROUPS, GROUP_COLOR, GROUP_LABEL, GROUP_ORDER } from '../game/board';
import { canTrade, netWorth, ownedBy } from '../game/rules';
import { acceptMargin, completesFor, suggestTrade, tradeGain } from '../game/ai';
import type { GameAction, GameState, Player, TradeBody, TradeOffer } from '../game/types';
import type { LogLine } from '../game/describe';
import type { ChatMessage, SeatInfo } from '../net/protocol';
import { Avatar, Empty, Modal, Money, fmt } from './bits';
import type { CashFloat } from '../store/store';
import { STICKERS, parseSticker, stickerLabel, stickerToken, stickerUrl } from '../art/art';

/* ============================ player rail ============================ */

export function PlayerRail({
  state, seats, myId, floats, onInspectPlayer,
}: {
  state: GameState;
  seats: SeatInfo[];
  myId: string;
  floats: CashFloat[];
  onInspectPlayer: (id: string) => void;
}) {
  const current = state.seats[state.seatIndex];
  // Seat order, not a leaderboard: cards that reshuffle as fortunes change
  // make it impossible to see who plays next, and the movement is jarring
  // mid-turn. Standing is shown as a rank badge instead.
  const order = state.seats;
  const rank = useMemo(() => {
    const sorted = [...state.seats]
      .filter((id) => !state.players[id].bankrupt)
      .sort((a, b) => netWorth(state, b) - netWorth(state, a));
    const map: Record<string, number> = {};
    sorted.forEach((id, i) => { map[id] = i + 1; });
    return map;
  }, [state]);

  return (
    <ul className="rail">
      {order.map((id) => {
        const p = state.players[id];
        const seat = seats.find((s) => s.playerId === id);
        const active = id === current;
        const mine = id === myId;
        const myFloats = floats.filter((f) => f.playerId === id);

        return (
          <li key={id}>
            <button
              type="button"
              className="playerCard"
              data-active={active || undefined}
              data-bankrupt={p.bankrupt || undefined}
              data-me={mine || undefined}
              style={{ ['--pc' as string]: p.color } as React.CSSProperties}
              onClick={() => onInspectPlayer(id)}
              aria-label={`${p.name}, ${fmt(p.cash)}${active ? ', current turn' : ''}`}
            >
              <Avatar color={p.color} token={p.token} size={34} active={active} dim={p.bankrupt} />

              <span className="playerCard__main">
                <span className="playerCard__top">
                  <span className="playerCard__name truncate" title={p.name}>{p.name}</span>
                  {mine && <span className="chip">You</span>}
                  {p.isBot && <span className="chip">Bot</span>}
                  {rank[id] === 1 && !p.bankrupt && state.turnNumber > 3 && (
                    <span className="chip" data-tone="good" title="Highest net worth">Leading</span>
                  )}
                </span>
                <span className="playerCard__cash">
                  {p.bankrupt
                    ? <span className="muted small">Bankrupt</span>
                    : <Money value={p.cash} />}
                  <span className="playerCard__worth num" title="Net worth">
                    {/* Only worth showing once property makes it differ from cash. */}
                    {p.bankrupt || netWorth(state, id) === p.cash
                      ? ''
                      : `${fmt(netWorth(state, id))} net`}
                  </span>
                </span>
                <PortfolioStrip state={state} playerId={id} />
              </span>

              <span className="playerCard__flags">
                {p.inJail && <span className="chip" data-tone="bad">Jail</span>}
                {p.getOutOfJailCards > 0 && (
                  <span className="chip" title="Get Out of Jail Free">Key x{p.getOutOfJailCards}</span>
                )}
                {seat && !seat.connected && !p.isBot && (
                  <span className="chip" data-tone="bad">Offline</span>
                )}
                {seat && seat.connected && seat.ping > 400 && (
                  <span className="chip num" title="Latency">{seat.ping}ms</span>
                )}
              </span>

              <AnimatePresence>
                {myFloats.map((f) => (
                  <motion.span
                    key={f.id}
                    className="cashFloat"
                    data-neg={f.delta < 0 || undefined}
                    initial={{ opacity: 0, y: 6, scale: 0.9 }}
                    animate={{ opacity: 1, y: -18, scale: 1 }}
                    exit={{ opacity: 0, y: -34 }}
                    transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {f.delta > 0 ? '+' : '-'}{fmt(Math.abs(f.delta))}
                  </motion.span>
                ))}
              </AnimatePresence>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Colour-group ownership at a glance: filled pips per deed held. */
function PortfolioStrip({ state, playerId }: { state: GameState; playerId: string }) {
  return (
    <span className="strip" aria-hidden>
      {GROUP_ORDER.map((g) => {
        const ids = GROUPS[g];
        const held = ids.filter((id) => state.properties[id].owner === playerId);
        if (held.length === 0) return null;
        const full = held.length === ids.length;
        return (
          <span key={g} className="strip__group" data-full={full || undefined}>
            {ids.map((id) => (
              <span
                key={id}
                className="strip__pip"
                data-on={state.properties[id].owner === playerId || undefined}
                data-mortgaged={state.properties[id].mortgaged || undefined}
                style={{ ['--gc' as string]: GROUP_COLOR[g] } as React.CSSProperties}
              />
            ))}
          </span>
        );
      })}
      {[5, 15, 25, 35].some((id) => state.properties[id].owner === playerId) && (
        <span className="strip__count num">
          RR {[5, 15, 25, 35].filter((id) => state.properties[id].owner === playerId).length}
        </span>
      )}
      {[12, 28].some((id) => state.properties[id].owner === playerId) && (
        <span className="strip__count num">
          U {[12, 28].filter((id) => state.properties[id].owner === playerId).length}
        </span>
      )}
    </span>
  );
}

/* ============================== log ================================= */

export function LogFeed({
  log, chat, state, onSend,
}: {
  log: LogLine[];
  chat: ChatMessage[];
  state: GameState | null;
  onSend: (text: string) => void;
}) {
  const [tab, setTab] = useState<'log' | 'chat'>('log');
  const [draft, setDraft] = useState('');
  const [stickersOpen, setStickersOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = boxRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [log, chat, tab]);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  return (
    <div className="feed">
      <div className="tabs tabs--sm" role="tablist" aria-label="Table feed">
        <button
          type="button" role="tab" aria-selected={tab === 'log'}
          className="tabs__item" data-on={tab === 'log' || undefined}
          onClick={() => setTab('log')}
        >
          Table log
        </button>
        <button
          type="button" role="tab" aria-selected={tab === 'chat'}
          className="tabs__item" data-on={tab === 'chat' || undefined}
          onClick={() => setTab('chat')}
        >
          Chat{chat.length > 0 ? ` (${chat.length})` : ''}
        </button>
      </div>

      <div className="feed__box" ref={boxRef} onScroll={onScroll} aria-live="polite">
        {tab === 'log' ? (
          log.length === 0
            ? <Empty>Nothing has happened yet.</Empty>
            : log.map((l) => (
              <p key={l.id} className="logLine" data-tone={l.tone}>
                {l.actor && state?.players[l.actor] && (
                  <span className="logLine__dot" style={{ background: state.players[l.actor].color }} />
                )}
                {l.text}
              </p>
            ))
        ) : (
          chat.length === 0
            ? <Empty>Say something to the table.</Empty>
            : chat.map((m) => {
              const sticker = parseSticker(m.text);
              return (
                <p key={m.id} className="chatLine" data-sticker={sticker ? '' : undefined}>
                  <strong style={{ color: m.color }}>{m.name}</strong>{' '}
                  {sticker
                    ? <img className="chatSticker" src={stickerUrl(sticker)} alt={stickerLabel(sticker)} />
                    : m.text}
                </p>
              );
            })
        )}
      </div>

      {tab === 'chat' && (
        <>
          {stickersOpen && (
            <div className="stickerTray" role="group" aria-label="Stickers">
              {STICKERS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="stickerTray__item"
                  title={s.label}
                  onClick={() => { onSend(stickerToken(s.id)); setStickersOpen(false); }}
                >
                  <img src={stickerUrl(s.id)} alt={s.label} loading="lazy" decoding="async" />
                </button>
              ))}
            </div>
          )}
          <form
            className="feed__compose"
            onSubmit={(e) => { e.preventDefault(); onSend(draft); setDraft(''); }}
          >
            <button
              type="button"
              className="btn btn--sm btn--icon"
              aria-expanded={stickersOpen}
              aria-label={stickersOpen ? 'Hide stickers' : 'Show stickers'}
              title="Stickers"
              onClick={() => setStickersOpen((v) => !v)}
            >
              {/* The tray's own handle, drawn rather than lettered so it
                  matches the rest of the iconography. */}
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="currentColor">
                <path d="M2 3.2A1.2 1.2 0 0 1 3.2 2h9.6A1.2 1.2 0 0 1 14 3.2V9h-3.1A1.9 1.9 0 0 0 9 10.9V14H3.2A1.2 1.2 0 0 1 2 12.8z" />
                <path d="M10.2 13.7V11a.8.8 0 0 1 .8-.8h2.7z" opacity="0.55" />
              </svg>
            </button>
            <input
              className="field"
              value={draft}
              maxLength={220}
              placeholder="Message the table"
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Chat message"
            />
            <button type="submit" className="btn btn--sm" disabled={!draft.trim()}>Send</button>
          </form>
        </>
      )}
    </div>
  );
}

/* ============================ portfolio ============================= */

export function PortfolioModal({
  state, playerId, onClose, onInspect,
}: {
  state: GameState;
  playerId: string | null;
  onClose: () => void;
  onInspect: (id: number) => void;
}) {
  if (!playerId) return null;
  const p = state.players[playerId];
  if (!p) return null;
  const deeds = ownedBy(state, playerId);

  return (
    <Modal open onClose={onClose} title={`${p.name} - ${fmt(netWorth(state, playerId))} net worth`}>
      <div className="portfolio">
        <div className="portfolio__stats">
          <Stat label="Cash" value={fmt(p.cash)} />
          <Stat label="Deeds" value={String(deeds.length)} />
          <Stat label="Buildings" value={String(deeds.reduce((n, id) => n + state.properties[id].houses, 0))} />
          <Stat label="Position" value={BOARD[p.position].short} />
        </div>

        {deeds.length === 0 ? (
          <Empty>No property yet.</Empty>
        ) : (
          <ul className="portfolio__list">
            {deeds.map((id) => {
              const st = state.properties[id];
              const space = BOARD[id];
              return (
                <li key={id}>
                  <button type="button" className="portfolio__row" onClick={() => onInspect(id)}>
                    <span
                      className="portfolio__band"
                      style={{ background: space.group ? GROUP_COLOR[space.group] : 'var(--n-50)' }}
                    />
                    <span className="portfolio__name truncate">{space.name}</span>
                    <span className="portfolio__meta num">
                      {st.mortgaged && <span className="chip" data-tone="bad">Mortgaged</span>}
                      {st.houses === 5 ? 'Hotel' : st.houses > 0 ? `${st.houses}h` : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="overline">{label}</span>
      <span className="stat__value num">{value}</span>
    </div>
  );
}

/* ============================== auction ============================= */

export function AuctionPanel({
  state, myId, dispatch,
}: { state: GameState; myId: string; dispatch: (a: GameAction) => void }) {
  const a = state.auction;
  const [amount, setAmount] = useState(0);

  useEffect(() => {
    if (a) setAmount(a.currentBid + 10);
  }, [a?.currentBid, a?.spaceId]);

  if (!a) return null;
  const space = BOARD[a.spaceId];
  const me = state.players[myId];
  const canAct = a.active.includes(myId) && !me.bankrupt;
  const high = a.highBidder ? state.players[a.highBidder] : null;

  return (
    <Modal open onClose={() => {}} title={`Auction: ${space.name}`} dismissable={false}>
      <div className="auction">
        <p className="muted">
          {space.name} went unsold, so it goes to the highest bidder. List price is{' '}
          <strong className="num">{fmt(space.price ?? 0)}</strong>.
        </p>

        <div className="auction__bid">
          <span className="overline">Current bid</span>
          <span className="auction__amount num">{a.currentBid > 0 ? fmt(a.currentBid) : 'No bids'}</span>
          {high && <span className="muted small" style={{ color: high.color }}>{high.name}</span>}
        </div>

        <ul className="auction__bidders">
          {state.seats.filter((id) => !state.players[id].bankrupt).map((id) => {
            const p = state.players[id];
            const out = !a.active.includes(id);
            return (
              <li key={id} className="auction__bidder" data-out={out || undefined}>
                <Avatar color={p.color} token={p.token} size={24} dim={out} />
                <span className="truncate">{p.name}</span>
                <span className="num muted small">{out ? 'passed' : fmt(p.cash)}</span>
              </li>
            );
          })}
        </ul>

        {canAct ? (
          <div className="auction__controls">
            <div className="auction__quick">
              {[10, 25, 50, 100].map((inc) => (
                <button
                  key={inc}
                  type="button"
                  className="btn btn--sm"
                  disabled={a.currentBid + inc > me.cash}
                  title={a.currentBid + inc > me.cash ? 'More than you have in cash' : undefined}
                  onClick={() => dispatch({ type: 'BID', playerId: myId, amount: a.currentBid + inc })}
                >
                  +{fmt(inc)}
                </button>
              ))}
            </div>
            <div className="auction__custom">
              <input
                type="number"
                className="field num"
                value={amount}
                min={a.currentBid + 1}
                max={me.cash}
                onChange={(e) => setAmount(Number(e.target.value))}
                aria-label="Custom bid"
              />
              <button
                type="button"
                className="btn btn--primary"
                disabled={amount <= a.currentBid || amount > me.cash}
                title={amount > me.cash ? 'More than you have in cash' : undefined}
                onClick={() => dispatch({ type: 'BID', playerId: myId, amount })}
              >
                Bid
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => dispatch({ type: 'PASS_BID', playerId: myId })}
              >
                Pass
              </button>
            </div>
          </div>
        ) : (
          <p className="muted">You are out of this auction. Waiting for the others.</p>
        )}
      </div>
    </Modal>
  );
}

/* =============================== trade ==============================
 *
 * Trading is where a Monopoly game is actually decided and it is the
 * screen people give up on, because a list of deeds and two number boxes
 * asks the player to know three things the board never tells them: which
 * deed finishes whose set, what a deed is worth to the other side, and
 * whether the offer they just built has any chance of being accepted.
 *
 * So the panel answers all three. Deeds are grouped into their sets and
 * badged when they complete one. The running balance is shown from both
 * chairs, using the same valuation the bots trade on. And against a bot
 * the verdict is exact - `acceptMargin` is the function the bot will
 * answer with - so a player can tune an offer until it says yes instead
 * of sending it and hoping.
 *
 * `Suggest a deal` composes one outright, from the same search a bot uses
 * to open a negotiation. It is the shortest path from "I know I want the
 * orange set" to a sendable offer.
 * ================================================================== */

const EMPTY_OFFER = {
  give: [] as number[],
  want: [] as number[],
  giveCash: 0,
  wantCash: 0,
  giveCards: 0,
  wantCards: 0,
};

export function TradePanel({
  state, myId, open, onClose, dispatch,
}: {
  state: GameState;
  myId: string;
  open: boolean;
  onClose: () => void;
  dispatch: (a: GameAction) => void;
}) {
  const others = state.seats.filter((id) => id !== myId && !state.players[id].bankrupt);
  const [withId, setWithId] = useState(others[0] ?? '');
  const [draft, setDraft] = useState(EMPTY_OFFER);
  const [noDeal, setNoDeal] = useState(false);

  useEffect(() => {
    if (!others.includes(withId) && others.length > 0) setWithId(others[0]);
  }, [others, withId]);

  useEffect(() => { setDraft(EMPTY_OFFER); setNoDeal(false); }, [withId, open]);

  const me = state.players[myId];
  const them = state.players[withId];

  const offer: TradeBody | null = useMemo(() => (them ? {
    from: myId,
    to: withId,
    giveCash: draft.giveCash,
    giveProperties: draft.give,
    giveJailCards: draft.giveCards,
    wantCash: draft.wantCash,
    wantProperties: draft.want,
    wantJailCards: draft.wantCards,
  } : null), [myId, withId, draft, them]);

  if (!open) return null;
  if (others.length === 0 || !them || !offer) {
    return <Modal open onClose={onClose} title="Trade"><Empty>Nobody left to trade with.</Empty></Modal>;
  }

  const empty = draft.give.length + draft.want.length
    + draft.giveCash + draft.wantCash + draft.giveCards + draft.wantCards === 0;
  const sound = canTrade(state, offer);

  const myGain = tradeGain(state, myId, offer);
  const theirGain = tradeGain(state, withId, offer);
  // Only a bot's answer is knowable in advance. A human's is not, and
  // pretending otherwise would be a lie dressed as help.
  const margin = them.isBot ? acceptMargin(state, withId, offer) : null;

  const set = (patch: Partial<typeof EMPTY_OFFER>) => {
    setNoDeal(false);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const toggle = (side: 'give' | 'want', id: number) => {
    const list = draft[side];
    set({ [side]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] });
  };

  const onSuggest = () => {
    const s = suggestTrade(state, myId, withId);
    if (!s) { setNoDeal(true); return; }
    setNoDeal(false);
    setDraft({
      give: s.giveProperties, want: s.wantProperties,
      giveCash: s.giveCash, wantCash: s.wantCash,
      giveCards: s.giveJailCards, wantCards: s.wantJailCards,
    });
  };

  const send = () => {
    dispatch({ type: 'PROPOSE_TRADE', playerId: myId, offer });
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Propose a trade" wide>
      <div className="trade">
        <div className="trade__who">
          <span className="switch__label">Trade with</span>
          <div className="trade__whoList">
            {others.map((id) => {
              const p = state.players[id];
              return (
                <button
                  key={id}
                  type="button"
                  className="trade__whoItem"
                  data-on={withId === id || undefined}
                  onClick={() => setWithId(id)}
                >
                  <Avatar color={p.color} token={p.token} size={22} />
                  <span className="truncate">{p.name}</span>
                </button>
              );
            })}
          </div>
          <span className="spacer" />
          <button type="button" className="btn btn--ghost btn--sm" onClick={onSuggest}>
            Suggest a deal
          </button>
        </div>

        {noDeal && (
          <p className="trade__note">
            No obvious deal with {them.name} yet — neither of you is one deed from a set.
            You can still build an offer by hand.
          </p>
        )}

        <div className="trade__cols">
          <TradeSide
            title="You give"
            state={state}
            ownerId={myId}
            receiverId={withId}
            selected={draft.give}
            onToggle={(id) => toggle('give', id)}
            cash={draft.giveCash}
            maxCash={me.cash}
            onCash={(v) => set({ giveCash: v })}
            cards={draft.giveCards}
            maxCards={me.getOutOfJailCards}
            onCards={(v) => set({ giveCards: v })}
          />
          <TradeSide
            title={`${them.name} gives`}
            state={state}
            ownerId={withId}
            receiverId={myId}
            selected={draft.want}
            onToggle={(id) => toggle('want', id)}
            cash={draft.wantCash}
            maxCash={them.cash}
            onCash={(v) => set({ wantCash: v })}
            cards={draft.wantCards}
            maxCards={them.getOutOfJailCards}
            onCards={(v) => set({ wantCards: v })}
          />
        </div>

        {!empty && (
          <div className="trade__verdict" aria-live="polite">
            <div className="trade__balance">
              <Gain label="You" value={myGain} />
              <Gain label={them.name} value={theirGain} />
            </div>
            <p className="trade__reading">
              {!sound
                ? 'That deal cannot be made: a deed cannot change hands while its colour set has buildings on it, and neither side can pay more cash than it holds.'
                : margin === null
                  ? `${them.name} decides for themselves — the figures above are what the deal is worth to each of you.`
                  : margin > 90 ? `${them.name} will take this.`
                    : margin > 0 ? `${them.name} will probably take this.`
                      : margin > -120 ? `${them.name} will turn this down. Add a little.`
                        : `${them.name} will turn this down flat.`}
            </p>
          </div>
        )}

        <footer className="trade__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={empty || !sound}
            onClick={send}
          >
            Send offer
          </button>
        </footer>
      </div>
    </Modal>
  );
}

/** A signed value with its sign carried by colour as well as a glyph. */
function Gain({ label, value }: { label: string; value: number }) {
  const rounded = Math.round(value);
  return (
    <span className="trade__gain" data-sign={rounded > 0 ? 'up' : rounded < 0 ? 'down' : undefined}>
      <span className="trade__gainWho truncate">{label}</span>
      <span className="num">{rounded > 0 ? '+' : rounded < 0 ? '−' : ''}{fmt(Math.abs(rounded))}</span>
    </span>
  );
}

function TradeSide({
  title, state, ownerId, receiverId, selected, onToggle,
  cash, maxCash, onCash, cards, maxCards, onCards,
}: {
  title: string;
  state: GameState;
  /** Whose deeds these are. */
  ownerId: string;
  /** Who would end up with them - which is what decides the badges. */
  receiverId: string;
  selected: number[];
  onToggle: (id: number) => void;
  cash: number;
  maxCash: number;
  onCash: (v: number) => void;
  cards: number;
  maxCards: number;
  onCards: (v: number) => void;
}) {
  const deeds = ownedBy(state, ownerId);

  // Grouped into sets, in board order, because "two of the three oranges"
  // is the unit a player actually thinks in.
  const groups = GROUP_ORDER.map((g) => ({
    key: g as string,
    label: GROUP_LABEL[g],
    color: GROUP_COLOR[g],
    all: [...GROUPS[g]],
    ids: GROUPS[g].filter((id) => deeds.includes(id)),
  })).filter((x) => x.ids.length > 0);

  const others = deeds.filter((id) => !BOARD[id].group);
  if (others.length > 0) {
    groups.push({ key: 'other', label: 'Stations & utilities', color: 'var(--n-50)', all: others, ids: others });
  }

  return (
    <section className="tradeSide">
      <h4 className="section__title">{title}</h4>

      {deeds.length === 0 ? <Empty>No deeds to offer.</Empty> : (
        <div className="tradeSide__sets">
          {groups.map((g) => (
            <div key={g.key} className="tradeSet">
              <div className="tradeSet__head">
                <span className="tradeSet__swatch" style={{ background: g.color }} />
                <span className="tradeSet__name">{g.label}</span>
                {g.key !== 'other' && (
                  <span className="tradeSet__count num">{g.ids.length}/{g.all.length}</span>
                )}
              </div>
              <ul className="tradeSide__list">
                {g.ids.map((id) => {
                  const space = BOARD[id];
                  const st = state.properties[id];
                  const grp = space.group;
                  const built = grp ? GROUPS[grp].some((x) => state.properties[x].houses > 0) : false;
                  const completes = completesFor(state, receiverId, id);
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        className="tradeSide__item"
                        data-on={selected.includes(id) || undefined}
                        data-key={completes || undefined}
                        disabled={built}
                        onClick={() => onToggle(id)}
                      >
                        <span className="truncate">{space.short}</span>
                        {completes && <span className="tradeSide__tag">completes the set</span>}
                        {st.mortgaged && <span className="tradeSide__tag tradeSide__tag--warn">mortgaged</span>}
                        <span className="spacer" />
                        <span className="num muted small">{fmt(space.price ?? 0)}</span>
                      </button>
                      {built && (
                        <span className="tradeSide__why">
                          Sell the buildings on this set before it can be traded.
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div className="tradeSide__cash">
        <div className="tradeSide__cashHead">
          <span className="switch__label">Cash</span>
          <span className="num">{fmt(cash)}</span>
        </div>
        <input
          type="range"
          className="tradeSide__slider"
          min={0}
          max={maxCash}
          step={10}
          value={Math.min(cash, maxCash)}
          aria-label={`${title} cash`}
          onChange={(e) => onCash(Number(e.target.value))}
        />
        <span className="tradeSide__max small muted">of {fmt(maxCash)}</span>
      </div>

      {maxCards > 0 && (
        <button
          type="button"
          className="tradeSide__cards"
          data-on={cards > 0 || undefined}
          onClick={() => onCards(cards > 0 ? 0 : 1)}
        >
          Get out of jail free
          <span className="num">{cards}/{maxCards}</span>
        </button>
      )}
    </section>
  );
}

/* ========================= incoming offers ========================== */

export function IncomingTrades({
  state, myId, dispatch,
}: { state: GameState; myId: string; dispatch: (a: GameAction) => void }) {
  const mine = state.trades.filter((t) => t.to === myId);
  if (mine.length === 0) return null;
  const offer = mine[0];
  const from = state.players[offer.from];

  const list = (ids: number[], cash: number): string => {
    const parts = ids.map((id) => BOARD[id].short);
    if (cash > 0) parts.push(fmt(cash));
    return parts.length > 0 ? parts.join(', ') : 'nothing';
  };

  return (
    <Modal open onClose={() => {}} title={`${from.name} offers a trade`} dismissable={false}>
      <div className="offer">
        <div className="offer__side">
          <span className="overline">You receive</span>
          <p>{list(offer.giveProperties, offer.giveCash)}</p>
        </div>
        <div className="offer__side">
          <span className="overline">You give</span>
          <p>{list(offer.wantProperties, offer.wantCash)}</p>
        </div>
        <footer className="offer__foot">
          <button
            type="button" className="btn btn--ghost"
            onClick={() => dispatch({ type: 'DECLINE_TRADE', playerId: myId, tradeId: offer.id })}
          >
            Decline
          </button>
          <button
            type="button" className="btn btn--primary"
            onClick={() => dispatch({ type: 'ACCEPT_TRADE', playerId: myId, tradeId: offer.id })}
          >
            Accept
          </button>
        </footer>
      </div>
    </Modal>
  );
}

/* ============================ game over ============================= */

export function GameOver({
  state, onLeave,
}: { state: GameState; onLeave: () => void }) {
  const ranked = [...state.seats].sort((a, b) => netWorth(state, b) - netWorth(state, a));
  const winner = state.winnerId ? state.players[state.winnerId] : null;

  return (
    <Modal open onClose={() => {}} title="Final standings" dismissable={false}>
      <div className="gameOver">
        {winner && (
          <motion.p
            className="gameOver__winner"
            style={{ color: winner.color }}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 16 }}
          >
            {winner.name} wins
          </motion.p>
        )}
        <ol className="gameOver__list">
          {ranked.map((id, i) => {
            const p: Player = state.players[id];
            return (
              <li key={id} className="gameOver__row">
                <span className="gameOver__rank num">{i + 1}</span>
                <Avatar color={p.color} token={p.token} size={26} dim={p.bankrupt} />
                <span className="truncate">{p.name}</span>
                <span className="spacer" />
                <span className="num">{p.bankrupt ? 'Bankrupt' : fmt(netWorth(state, id))}</span>
              </li>
            );
          })}
        </ol>
        <button type="button" className="btn btn--primary btn--block" onClick={onLeave}>
          Back to the front door
        </button>
      </div>
    </Modal>
  );
}

export type { TradeOffer };
