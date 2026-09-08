import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BOARD, GROUPS, GROUP_COLOR, GROUP_ORDER } from '../game/board';
import { netWorth, ownedBy } from '../game/rules';
import type { GameAction, GameState, Player, TradeOffer } from '../game/types';
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

/* =============================== trade ============================== */

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
  const [giveProps, setGiveProps] = useState<number[]>([]);
  const [wantProps, setWantProps] = useState<number[]>([]);
  const [giveCash, setGiveCash] = useState(0);
  const [wantCash, setWantCash] = useState(0);

  useEffect(() => {
    if (!others.includes(withId) && others.length > 0) setWithId(others[0]);
  }, [others, withId]);

  useEffect(() => {
    setGiveProps([]); setWantProps([]); setGiveCash(0); setWantCash(0);
  }, [withId, open]);

  if (!open) return null;
  if (others.length === 0) {
    return <Modal open onClose={onClose} title="Trade"><Empty>Nobody left to trade with.</Empty></Modal>;
  }

  const me = state.players[myId];
  const them = state.players[withId];
  const mine = ownedBy(state, myId);
  const theirs = ownedBy(state, withId);

  const blocked = (id: number): boolean => {
    const g = BOARD[id].group;
    return Boolean(g && GROUPS[g].some((x) => state.properties[x].houses > 0));
  };

  const toggle = (list: number[], setList: (v: number[]) => void, id: number) =>
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const valid =
    (giveProps.length + wantProps.length + giveCash + wantCash) > 0
    && giveCash <= me.cash && wantCash <= them.cash
    && ![...giveProps, ...wantProps].some(blocked);

  const send = () => {
    dispatch({
      type: 'PROPOSE_TRADE',
      playerId: myId,
      offer: {
        from: myId, to: withId,
        giveCash, giveProperties: giveProps, giveJailCards: 0,
        wantCash, wantProperties: wantProps, wantJailCards: 0,
      },
    });
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
        </div>

        <div className="trade__cols">
          <TradeSide
            title="You give"
            cash={giveCash}
            maxCash={me.cash}
            onCash={setGiveCash}
            deeds={mine}
            selected={giveProps}
            blocked={blocked}
            state={state}
            onToggle={(id) => toggle(giveProps, setGiveProps, id)}
          />
          <TradeSide
            title={`${them.name} gives`}
            cash={wantCash}
            maxCash={them.cash}
            onCash={setWantCash}
            deeds={theirs}
            selected={wantProps}
            blocked={blocked}
            state={state}
            onToggle={(id) => toggle(wantProps, setWantProps, id)}
          />
        </div>

        {[...giveProps, ...wantProps].some(blocked) && (
          <p className="banner banner--bad small">
            A deed cannot change hands while its colour set has buildings on it. Sell them first.
          </p>
        )}

        <footer className="trade__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn--primary" disabled={!valid} onClick={send}>
            Send offer
          </button>
        </footer>
      </div>
    </Modal>
  );
}

function TradeSide({
  title, cash, maxCash, onCash, deeds, selected, blocked, state, onToggle,
}: {
  title: string;
  cash: number;
  maxCash: number;
  onCash: (v: number) => void;
  deeds: number[];
  selected: number[];
  blocked: (id: number) => boolean;
  state: GameState;
  onToggle: (id: number) => void;
}) {
  return (
    <section className="tradeSide">
      <h4 className="section__title">{title}</h4>
      <label className="labelled">
        <span className="switch__label">Cash (max {fmt(maxCash)})</span>
        <input
          type="number"
          className="field num"
          min={0}
          max={maxCash}
          value={cash}
          onChange={(e) => onCash(Math.max(0, Math.min(maxCash, Number(e.target.value))))}
        />
      </label>
      {deeds.length === 0 ? (
        <Empty>No deeds to offer.</Empty>
      ) : (
        <ul className="tradeSide__list">
          {deeds.map((id) => {
            const space = BOARD[id];
            const isBlocked = blocked(id);
            return (
              <li key={id}>
                <button
                  type="button"
                  className="tradeSide__item"
                  data-on={selected.includes(id) || undefined}
                  disabled={isBlocked}
                  title={isBlocked ? 'This set has buildings on it' : undefined}
                  onClick={() => onToggle(id)}
                >
                  <span
                    className="tradeSide__band"
                    style={{ background: space.group ? GROUP_COLOR[space.group] : 'var(--n-50)' }}
                  />
                  <span className="truncate">{space.short}</span>
                  <span className="num muted small">
                    {state.properties[id].mortgaged ? 'M' : fmt(space.price ?? 0)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
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
