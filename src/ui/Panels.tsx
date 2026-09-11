import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BOARD, GROUPS, GROUP_COLOR, GROUP_ORDER } from '../game/board';
import { canTrade, netWorth, ownedBy } from '../game/rules';
import { acceptMargin, completesFor, suggestTrade, tradeGain } from '../game/ai';
import type { GameAction, GameState, Player, TradeBody, TradeOffer } from '../game/types';
import { describe, type LogLine } from '../game/describe';
import { spaceName, spaceShort, useT } from '../i18n';
import type { ChatMessage, SeatInfo } from '../net/protocol';
import { Avatar, Empty, Modal, Money, fmt } from './bits';
import type { CashFloat } from '../store/store';
import {
  STICKERS, groupArt, parseSticker, stickerToken, stickerUrl, type GroupMotif,
} from '../art/art';

/* ============================ player rail ============================ */

export function PlayerRail({
  state, seats, myId, floats, onInspectPlayer, onSpotlight,
}: {
  state: GameState;
  seats: SeatInfo[];
  myId: string;
  floats: CashFloat[];
  onInspectPlayer: (id: string) => void;
  /** Point the board at this player. Null puts the light out. */
  onSpotlight: (id: string | null) => void;
}) {
  const t = useT();
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
              /* Mouse and keyboard both, so the board answers whether you are
                 reaching for a pointer or tabbing through the rail. Touch is
                 deliberately excluded: a tap fires enter and often never
                 fires leave, which would leave the light stuck on whoever
                 was tapped last. Phones get the explicit button on the
                 player's card instead. */
              onPointerEnter={(e) => { if (e.pointerType === 'mouse') onSpotlight(id); }}
              onPointerLeave={(e) => { if (e.pointerType === 'mouse') onSpotlight(null); }}
              onFocus={() => onSpotlight(id)}
              onBlur={() => onSpotlight(null)}
              aria-label={t.rail.aria(p.name, fmt(p.cash), active)}
            >
              <Avatar color={p.color} token={p.token} size={34} active={active} dim={p.bankrupt} />

              <span className="playerCard__main">
                <span className="playerCard__top">
                  <span className="playerCard__name truncate" title={p.name}>{p.name}</span>
                  {mine && <span className="chip">{t.common.you}</span>}
                  {p.isBot && <span className="chip">{t.common.bot}</span>}
                  {rank[id] === 1 && !p.bankrupt && state.turnNumber > 3 && (
                    <span className="chip" data-tone="good" title={t.rail.leadingTitle}>{t.rail.leading}</span>
                  )}
                </span>
                <span className="playerCard__cash">
                  {p.bankrupt
                    ? <span className="muted small">{t.common.bankrupt}</span>
                    : <Money value={p.cash} />}
                  <span className="playerCard__worth num" title={t.rail.netTitle}>
                    {/* Only worth showing once property makes it differ from cash. */}
                    {p.bankrupt || netWorth(state, id) === p.cash
                      ? ''
                      : t.rail.net(fmt(netWorth(state, id)))}
                  </span>
                </span>
                <PortfolioStrip state={state} playerId={id} />
              </span>

              <span className="playerCard__flags">
                {p.inJail && <span className="chip" data-tone="bad">{t.rail.jail}</span>}
                {p.getOutOfJailCards > 0 && (
                  <span className="chip" title={t.rail.jailCardTitle}>{t.rail.keys(p.getOutOfJailCards)}</span>
                )}
                {seat && !seat.connected && !p.isBot && (
                  <span className="chip" data-tone="bad">{t.rail.offline}</span>
                )}
                {seat && seat.connected && seat.ping > 400 && (
                  <span className="chip num" title={t.rail.latency}>{seat.ping}ms</span>
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
  const t = useT();
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
          {t.rail.railroadsShort} {[5, 15, 25, 35].filter((id) => state.properties[id].owner === playerId).length}
        </span>
      )}
      {[12, 28].some((id) => state.properties[id].owner === playerId) && (
        <span className="strip__count num">
          {t.rail.utilitiesShort} {[12, 28].filter((id) => state.properties[id].owner === playerId).length}
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
  const t = useT();
  const lines: FeedLine[] = log.map((l) => ({
    id: l.id,
    tone: l.tone,
    color: l.actor ? state?.players[l.actor]?.color : undefined,
    text: state ? describe(state, l.event, t) : '',
  }));
  return <FeedView lines={lines} chat={chat} onSend={onSend} />;
}

/** A log line with its words already chosen. Both games' logs reduce to
 *  this, so one feed - and one chat with its stickers - serves both. */
export interface FeedLine {
  id: string;
  tone: string;
  color?: string;
  text: string;
}

export function FeedView({
  lines, chat, onSend,
}: {
  lines: FeedLine[];
  chat: ChatMessage[];
  onSend: (text: string) => void;
}) {
  const t = useT();
  const log = lines;
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
      <div className="tabs tabs--sm" role="tablist" aria-label={t.feed.aria}>
        <button
          type="button" role="tab" aria-selected={tab === 'log'}
          className="tabs__item" data-on={tab === 'log' || undefined}
          onClick={() => setTab('log')}
        >
          {t.feed.log}
        </button>
        <button
          type="button" role="tab" aria-selected={tab === 'chat'}
          className="tabs__item" data-on={tab === 'chat' || undefined}
          onClick={() => setTab('chat')}
        >
          {t.feed.chat(chat.length)}
        </button>
      </div>

      <div className="feed__box" ref={boxRef} onScroll={onScroll} aria-live="polite">
        {tab === 'log' ? (
          log.length === 0
            ? <Empty>{t.feed.emptyLog}</Empty>
            : log.map((l) => (
              <p key={l.id} className="logLine" data-tone={l.tone}>
                {l.color && <span className="logLine__dot" style={{ background: l.color }} />}
                {l.text}
              </p>
            ))
        ) : (
          chat.length === 0
            ? <Empty>{t.feed.emptyChat}</Empty>
            : chat.map((m) => {
              const sticker = parseSticker(m.text);
              return (
                <p key={m.id} className="chatLine" data-sticker={sticker ? '' : undefined}>
                  <strong style={{ color: m.color }}>{m.name}</strong>{' '}
                  {sticker
                    ? <img className="chatSticker" src={stickerUrl(sticker)} alt={t.stickers[sticker] ?? sticker} />
                    : m.text}
                </p>
              );
            })
        )}
      </div>

      {tab === 'chat' && (
        <>
          {stickersOpen && (
            <div className="stickerTray" role="group" aria-label={t.feed.stickers}>
              {STICKERS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="stickerTray__item"
                  title={t.stickers[s.id] ?? s.label}
                  onClick={() => { onSend(stickerToken(s.id)); setStickersOpen(false); }}
                >
                  <img src={stickerUrl(s.id)} alt={t.stickers[s.id] ?? s.label} loading="lazy" decoding="async" />
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
              aria-label={stickersOpen ? t.feed.hideStickers : t.feed.showStickers}
              title={t.feed.stickers}
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
              placeholder={t.feed.placeholder}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={t.feed.messageAria}
            />
            <button type="submit" className="btn btn--sm" disabled={!draft.trim()}>{t.common.send}</button>
          </form>
        </>
      )}
    </div>
  );
}

/* ============================ portfolio ============================= */

export function PortfolioModal({
  state, playerId, onClose, onInspect, onShowOnBoard,
}: {
  state: GameState;
  playerId: string | null;
  onClose: () => void;
  onInspect: (id: number) => void;
  /** Put this card away and stand a light on their square instead. */
  onShowOnBoard: (id: string) => void;
}) {
  const t = useT();
  if (!playerId) return null;
  const p = state.players[playerId];
  if (!p) return null;
  const deeds = ownedBy(state, playerId);

  return (
    <Modal open onClose={onClose} title={t.portfolio.title(p.name, fmt(netWorth(state, playerId)))}>
      <div className="portfolio">
        <div className="portfolio__stats">
          <Stat label={t.common.cash} value={fmt(p.cash)} />
          <Stat label={t.portfolio.deeds} value={String(deeds.length)} />
          <Stat label={t.portfolio.buildings} value={String(deeds.reduce((n, id) => n + state.properties[id].houses, 0))} />
          <Stat label={t.portfolio.position} value={spaceShort(t, p.position)} />
        </div>

        {/* The card is over the board, so pointing at a square is only useful
            if the card gets out of the way first. */}
        {!p.bankrupt && (
          <button
            type="button"
            className="btn btn--sm portfolio__locate"
            onClick={() => onShowOnBoard(playerId)}
          >
            {t.portfolio.showOnBoard(p.name)}
          </button>
        )}

        {deeds.length === 0 ? (
          <Empty>{t.portfolio.empty}</Empty>
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
                    <span className="portfolio__name truncate">{spaceName(t, id)}</span>
                    <span className="portfolio__meta num">
                      {st.mortgaged && <span className="chip" data-tone="bad">{t.common.mortgaged}</span>}
                      {st.houses === 5 ? t.common.hotel : st.houses > 0 ? t.common.housesShort(st.houses) : ''}
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
  const t = useT();
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
  const name = spaceName(t, a.spaceId);
  const [introBefore, introAfter] = t.auction.intro(name);

  return (
    <Modal open onClose={() => {}} title={t.auction.title(name)} dismissable={false}>
      <div className="auction">
        <p className="muted">
          {introBefore}<strong className="num">{fmt(space.price ?? 0)}</strong>{introAfter}
        </p>

        <div className="auction__bid">
          <span className="overline">{t.auction.currentBid}</span>
          <span className="auction__amount num">{a.currentBid > 0 ? fmt(a.currentBid) : t.auction.noBids}</span>
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
                <span className="num muted small">{out ? t.auction.passed : fmt(p.cash)}</span>
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
                  title={a.currentBid + inc > me.cash ? t.auction.tooMuch : undefined}
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
                aria-label={t.auction.customAria}
              />
              <button
                type="button"
                className="btn btn--primary"
                disabled={amount <= a.currentBid || amount > me.cash}
                title={amount > me.cash ? t.auction.tooMuch : undefined}
                onClick={() => dispatch({ type: 'BID', playerId: myId, amount })}
              >
                {t.auction.bid}
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => dispatch({ type: 'PASS_BID', playerId: myId })}
              >
                {t.common.pass}
              </button>
            </div>
          </div>
        ) : (
          <p className="muted">{t.auction.out}</p>
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

/**
 * A deed, shown the way it looks on the board.
 *
 * Every trade surface used to render deeds as bare short names - "St.
 * Charles, $140" - which asks the player to hold the whole board in their
 * head to work out what is being offered. The chip carries the set's
 * colour and its motif, so a deed in a list is recognisable as the same
 * object you have been looking at on the board all game.
 */
export function motifOf(spaceId: number): GroupMotif | null {
  const space = BOARD[spaceId];
  if (space.group) return space.group;
  if (space.kind === 'railroad') return 'railroad';
  if (space.kind === 'utility') return 'utility';
  return null;
}

function DeedChip({
  state, id, badge,
}: { state: GameState; id: number; badge?: string }) {
  const t = useT();
  const space = BOARD[id];
  const motif = motifOf(id);
  const st = state.properties[id];
  return (
    <span
      className="deedChip"
      style={{ ['--dc' as string]: space.group ? GROUP_COLOR[space.group] : 'var(--brass-500)' }}
    >
      {motif && (
        <span
          className="deedChip__art"
          style={{ backgroundImage: `url("${groupArt(motif)}")` }}
          aria-hidden
        />
      )}
      <span className="deedChip__band" aria-hidden />
      <span className="deedChip__name truncate">{spaceShort(t, id)}</span>
      {badge && <span className="deedChip__badge">{badge}</span>}
      {st?.mortgaged && <span className="deedChip__badge deedChip__badge--warn">{t.trade.mortgagedBadge}</span>}
      <span className="spacer" />
      <span className="deedChip__price num">{fmt(space.price ?? 0)}</span>
    </span>
  );
}

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
  const t = useT();
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
    return <Modal open onClose={onClose} title={t.trade.title}><Empty>{t.trade.nobody}</Empty></Modal>;
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
    <Modal open onClose={onClose} title={t.trade.propose} wide>
      <div className="trade">
        <div className="trade__who">
          <span className="switch__label">{t.trade.with}</span>
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
            {t.trade.suggest}
          </button>
        </div>

        {noDeal && (
          <p className="trade__note">
            {t.trade.noDeal(them.name)}
          </p>
        )}

        <div className="trade__cols">
          <TradeSide
            title={t.trade.youGive}
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
            title={t.trade.theyGive(them.name)}
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
              <Gain label={t.common.you} value={myGain} />
              <Gain label={them.name} value={theirGain} />
            </div>
            <p className="trade__reading">
              {!sound
                ? t.trade.unsound
                : margin === null
                  ? t.trade.human(them.name)
                  : margin > 90 ? t.trade.willTake(them.name)
                    : margin > 0 ? t.trade.probably(them.name)
                      : margin > -120 ? t.trade.addLittle(them.name)
                        : t.trade.flat(them.name)}
            </p>
          </div>
        )}

        <footer className="trade__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose}>{t.common.cancel}</button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={empty || !sound}
            onClick={send}
          >
            {t.trade.send}
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
  const t = useT();
  const deeds = ownedBy(state, ownerId);

  // Grouped into sets, in board order, because "two of the three oranges"
  // is the unit a player actually thinks in.
  const groups = GROUP_ORDER.map((g) => ({
    key: g as string,
    label: t.groups[g],
    color: GROUP_COLOR[g],
    all: [...GROUPS[g]],
    ids: GROUPS[g].filter((id) => deeds.includes(id)),
  })).filter((x) => x.ids.length > 0);

  const others = deeds.filter((id) => !BOARD[id].group);
  if (others.length > 0) {
    groups.push({ key: 'other', label: t.trade.otherDeeds, color: 'var(--n-50)', all: others, ids: others });
  }

  return (
    <section className="tradeSide">
      <h4 className="section__title">{title}</h4>

      {deeds.length === 0 ? <Empty>{t.trade.noDeeds}</Empty> : (
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
                  const grp = BOARD[id].group;
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
                        <DeedChip
                          state={state}
                          id={id}
                          badge={completes ? t.trade.completesSet : undefined}
                        />
                      </button>
                      {built && (
                        <span className="tradeSide__why">
                          {t.trade.builtWhy}
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
          <span className="switch__label">{t.common.cash}</span>
          <span className="num">{fmt(cash)}</span>
        </div>
        <input
          type="range"
          className="tradeSide__slider"
          min={0}
          max={maxCash}
          step={10}
          value={Math.min(cash, maxCash)}
          aria-label={t.trade.cashAria(title)}
          onChange={(e) => onCash(Number(e.target.value))}
        />
        <span className="tradeSide__max small muted">{t.trade.of(fmt(maxCash))}</span>
      </div>

      {maxCards > 0 && (
        <button
          type="button"
          className="tradeSide__cards"
          data-on={cards > 0 || undefined}
          onClick={() => onCards(cards > 0 ? 0 : 1)}
        >
          {t.trade.jailCard}
          <span className="num">{cards}/{maxCards}</span>
        </button>
      )}
    </section>
  );
}

/* ========================= incoming offers ==========================
 *
 * The hardest thing to read in the whole game was somebody else's offer:
 * two lines of bare short names, no colour, no indication of whether the
 * deal was any good. You had to reconstruct the board from memory to
 * answer a yes/no question with your money on it.
 *
 * Now it shows the deeds as they look on the board, badges the ones that
 * finish a set for either side, and says plainly what the deal is worth
 * to you - the same arithmetic the bot used to decide to send it.
 * ================================================================== */

function OfferSide({
  state, label, viewerId, otherId, props, cash, cards, tone,
}: {
  state: GameState;
  label: string;
  /** Who ends up holding these - which decides whether a set is completed. */
  viewerId: string;
  otherId: string;
  props: number[];
  cash: number;
  cards: number;
  tone: 'get' | 'give';
}) {
  const t = useT();
  const nothing = props.length === 0 && cash === 0 && cards === 0;
  return (
    <div className="offer__side" data-tone={tone}>
      <span className="overline">{label}</span>
      {nothing ? <p className="muted">{t.offers.nothing}</p> : (
        <div className="offer__items">
          {props.map((id) => (
            <DeedChip
              key={id}
              state={state}
              id={id}
              badge={completesFor(state, viewerId, id)
                ? t.offers.completesYours
                : completesFor(state, otherId, id) ? t.offers.completesTheirs : undefined}
            />
          ))}
          {cash > 0 && <span className="offer__cash num">{fmt(cash)}</span>}
          {cards > 0 && (
            <span className="offer__cash">
              {t.offers.jailCards(cards)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Offers wait in a dock rather than seizing the screen.
 *
 * This was a Modal with `dismissable={false}`: it covered the board, trapped
 * focus, and had to be answered before anything else could happen - including
 * looking at the very deeds the offer was about. An offer is a question, not
 * an interrupt, and you cannot answer it well without seeing the board.
 *
 * So they stack in a corner, all of them rather than only the first, summarised
 * to one line each with the two answers always reachable. Opening one shows the
 * full detail in place; nothing is ever hidden behind it.
 */
export function IncomingTrades({
  state, myId, dispatch,
}: { state: GameState; myId: string; dispatch: (a: GameAction) => void }) {
  const t = useT();
  const mine = state.trades.filter((o) => o.to === myId);
  const [openId, setOpenId] = useState<string | null>(null);

  // Newest first: the one just sent to you is the one you are being asked about.
  const offers = [...mine].reverse();
  if (offers.length === 0) return null;

  return (
    <aside
      className="offerDock"
      aria-label={t.offers.aria(offers.length)}
    >
      <AnimatePresence initial={false}>
        {offers.map((offer) => (
          <OfferCard
            key={offer.id}
            state={state}
            myId={myId}
            offer={offer}
            open={openId === offer.id}
            onToggle={() => setOpenId((cur) => (cur === offer.id ? null : offer.id))}
            dispatch={dispatch}
          />
        ))}
      </AnimatePresence>
    </aside>
  );
}

function OfferCard({
  state, myId, offer, open, onToggle, dispatch,
}: {
  state: GameState;
  myId: string;
  offer: TradeOffer;
  open: boolean;
  onToggle: () => void;
  dispatch: (a: GameAction) => void;
}) {
  const from = state.players[offer.from];
  const gain = Math.round(tradeGain(state, myId, offer));
  const sign = gain > 0 ? 'up' : gain < 0 ? 'down' : undefined;

  const t = useT();
  const reading = gain > 150 ? t.offers.good
    : gain > 0 ? t.offers.slightlyUp
      : gain > -150 ? t.offers.slightlyDown
        : t.offers.bad;

  return (
    <motion.article
      layout
      className="offerCard"
      data-open={open || undefined}
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
    >
      <button
        type="button"
        className="offerCard__head"
        aria-expanded={open}
        onClick={onToggle}
      >
        <Avatar color={from.color} token={from.token} size={26} />
        <span className="offerCard__who truncate">{t.offers.offersTrade(from.name)}</span>
        <span className="offerCard__gain num" data-sign={sign}>
          {gain > 0 ? '+' : gain < 0 ? '−' : ''}{fmt(Math.abs(gain))}
        </span>
        <svg
          className="offerCard__chev" viewBox="0 0 16 16" width="13" height="13"
          aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="offerCard__body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="offer">
              <OfferSide
                state={state}
                label={t.offers.receive}
                viewerId={myId}
                otherId={offer.from}
                props={offer.giveProperties}
                cash={offer.giveCash}
                cards={offer.giveJailCards}
                tone="get"
              />
              <OfferSide
                state={state}
                label={t.offers.give}
                viewerId={offer.from}
                otherId={myId}
                props={offer.wantProperties}
                cash={offer.wantCash}
                cards={offer.wantJailCards}
                tone="give"
              />
              <p className="offer__reading" data-sign={sign}>
                <span className="num">{gain > 0 ? '+' : gain < 0 ? '−' : ''}{fmt(Math.abs(gain))}</span>
                {t.offers.valueToYou} {reading}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="offerCard__foot">
        <button
          type="button" className="btn btn--ghost btn--sm"
          onClick={() => dispatch({ type: 'DECLINE_TRADE', playerId: myId, tradeId: offer.id })}
        >
          {t.offers.decline}
        </button>
        <button
          type="button" className="btn btn--primary btn--sm"
          onClick={() => dispatch({ type: 'ACCEPT_TRADE', playerId: myId, tradeId: offer.id })}
        >
          {t.offers.accept}
        </button>
      </footer>
    </motion.article>
  );
}

/* ============================ game over ============================= */

export function GameOver({
  state, onLeave,
}: { state: GameState; onLeave: () => void }) {
  const t = useT();
  const ranked = [...state.seats].sort((a, b) => netWorth(state, b) - netWorth(state, a));
  const winner = state.winnerId ? state.players[state.winnerId] : null;

  return (
    <Modal open onClose={() => {}} title={t.gameOver.title} dismissable={false}>
      <div className="gameOver">
        {winner && (
          <motion.p
            className="gameOver__winner"
            style={{ color: winner.color }}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 16 }}
          >
            {t.gameOver.wins(winner.name)}
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
                <span className="num">{p.bankrupt ? t.common.bankrupt : fmt(netWorth(state, id))}</span>
              </li>
            );
          })}
        </ol>
        <button type="button" className="btn btn--primary btn--block" onClick={onLeave}>
          {t.gameOver.home}
        </button>
      </div>
    </Modal>
  );
}

export type { TradeOffer };
