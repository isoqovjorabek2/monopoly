import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BOARD } from '../game/board';
import { clockKey, clockSeconds, maxRaisable } from '../game/rules';
import type { GameAction, GameState } from '../game/types';
import { cap, spaceName, trReason, useBoardTheme, useT } from '../i18n';
import { useStore } from '../store/store';
import { BoardStage, readRenderMode, writeRenderMode, type RenderMode } from './BoardStage';
import { BoardTools, readBoardZoom, useFocusMode, writeBoardZoom, ZOOM_STEPS } from './BoardTools';
import { DeedCard } from './DeedCard';
import {
  AuctionPanel, GameOver, IncomingTrades, LogFeed, PlayerRail, PortfolioModal, TradePanel,
  type CounterSeed,
} from './Panels';
import { Modal, fmt, useCountdown } from './bits';
import { BoardIcon } from './Pieces';
import { FxLayer, useFx } from './Fx';
import { cardArt, themedDeckBack } from '../art/art';
import { HelpModal, useGameKeys } from './Help';
import { ContractGlyph, ContractsModal, myContractCount } from './Deals';
import { SeatRequestsDock, CoownerDock, TakeSeatPanel } from './Account';
import { tableNeed, useAlertsSwitch, useTableAlert } from './alerts';
import { useWakeLock } from './wakeLock';
import { LangSwitch } from './LangSwitch';
import { TableMenu } from './TableMenu';
import { Reactions } from './Reactions';
import { Coach, monopolyTips } from './Coach';
import { EndVoteBanner, EndVoteButton, EndVoteMenuRow, useEndVote } from './EndVote';
import { useDockInset } from './dockInset';
import { canKick } from '../net/moderation';
import { useBreakBefore } from './Ads';

/* Shared props for the header buttons' icons, which stand in for the labels
   on narrow screens (`.btn__icon` is hidden until a breakpoint asks for it). */
const glyph = {
  className: 'btn__icon', width: 14, height: 14, viewBox: '0 0 16 16',
  'aria-hidden': true, fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
} as const;

export function Game() {
  const t = useT();
  const room = useStore((s) => s.room);
  const me = useStore((s) => s.me);
  const log = useStore((s) => s.log);
  const chat = useStore((s) => s.chat);
  const floats = useStore((s) => s.floats);
  const animPos = useStore((s) => s.animPos);
  const rolling = useStore((s) => s.rolling);
  const inspecting = useStore((s) => s.inspecting);
  const sheet = useStore((s) => s.sheet);
  const soundOn = useStore((s) => s.soundOn);
  const hapticsOn = useStore((s) => s.hapticsOn);
  const netError = useStore((s) => s.netError);

  const dispatch = useStore((s) => s.dispatch);
  const inspect = useStore((s) => s.inspect);
  const openSheet = useStore((s) => s.openSheet);
  const toggleSound = useStore((s) => s.toggleSound);
  const toggleHaptics = useStore((s) => s.toggleHaptics);
  const leave = useStore((s) => s.leave);
  const leaveAfterBreak = useBreakBefore(leave);
  const removeSeat = useStore((s) => s.removeSeat);

  // The screen stays lit while the table is on it - a turn timer for
  // reading text should not dim a board game mid-hand.
  useWakeLock(true);

  const [portfolioOf, setPortfolioOf] = useState<string | null>(null);
  /* Who the board is currently pointing at.
   *
   * Hovering a player card is enough on a pointer device - answering "where
   * are they" should not cost a click, and should not open anything that
   * then covers the answer. A phone has no hover and its player list is a
   * sheet over the board, so there the card carries an explicit "show me on
   * the board", which puts the sheet away and leaves the light standing for
   * a few seconds. */
  const [spotlight, setSpotlight] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const pinTimer = useRef<number | null>(null);

  useEffect(() => () => { if (pinTimer.current) window.clearTimeout(pinTimer.current); }, []);

  const showOnBoard = useCallback((id: string) => {
    setPortfolioOf(null);
    openSheet('none');
    setPinned(id);
    if (pinTimer.current) window.clearTimeout(pinTimer.current);
    pinTimer.current = window.setTimeout(() => setPinned(null), 7000);
  }, [openSheet]);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [counterSeed, setCounterSeed] = useState<CounterSeed | null>(null);
  const [contractsOpen, setContractsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [renderMode, setRenderMode] = useState<RenderMode>(readRenderMode);
  // Stable by construction: BoardStage keys an effect on this, and an inline
  // arrow made that effect re-run on every render of the game screen.
  const fallBackTo2D = useCallback(() => setRenderMode('2d'), []);

  const [zoom, setZoom] = useState(readBoardZoom);
  const { focused, toggle: toggleFocus, autoEnter } = useFocusMode();

  const stepZoom = useCallback((delta: number) => {
    setZoom((z) => {
      const i = ZOOM_STEPS.indexOf(z);
      const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + delta))];
      writeBoardZoom(next);
      return next;
    });
  }, []);

  const toggleRender = () => {
    const next: RenderMode = renderMode === '3d' ? '2d' : '3d';
    setRenderMode(next);
    writeRenderMode(next);
  };

  const state = room?.game ?? null;
  const myId = me.playerId;
  const role = useStore((s) => s.role);
  // The seat I actually play: my own id, or a bot seat I took over.
  const mySeatId = room?.seats.find((s) => s.playerId === myId || room.owners?.[s.playerId] === myId)?.playerId ?? myId;

  const endVote = useEndVote(state, myId);

  const alerts = useAlertsSwitch();
  const need = useMemo(() => tableNeed(t, room, myId, role === 'host'), [t, room, myId, role]);
  useTableAlert(need, alerts.on);

  /* Table effects. These watch the state everyone already has rather than
   * needing new events across the wire, so a guest sees its own windfall
   * the moment the snapshot lands. Only ever fired for the local player -
   * a table of six should not strobe every time somebody collects rent. */
  const [fx, fire] = useFx();
  const myCash = state?.players[myId]?.cash ?? null;
  const iAmOut = state?.players[myId]?.bankrupt ?? false;
  const iWon = state?.phase === 'game_over' && state.winnerId === myId;
  const prevCash = useRef<number | null>(null);
  const fired = useRef({ out: false, won: false });

  useEffect(() => {
    if (myCash == null) return;
    const before = prevCash.current;
    prevCash.current = myCash;
    if (before != null && myCash > before) fire('coins');
  }, [myCash, fire]);

  useEffect(() => {
    if (iAmOut && !fired.current.out) { fired.current.out = true; fire('ash'); }
    if (iWon && !fired.current.won) { fired.current.won = true; fire('victory'); }
  }, [iAmOut, iWon, fire]);

  useGameKeys(useCallback(() => setHelpOpen((v) => !v), []), toggleFocus);

  /* Open into focus mode when the game starts. Once, and only on the way in
   * from the lobby: a player who folds the rails back out has said what they
   * want, and re-entering on the next render would be an argument. The
   * browser usually grants real fullscreen here too, because Start was a
   * click a moment ago and the gesture is still warm. */
  const openedFullScreen = useRef(false);
  useEffect(() => {
    if (openedFullScreen.current || !room?.game) return;
    if (room.game.phase === 'lobby' || room.game.phase === 'game_over') return;
    openedFullScreen.current = true;
    autoEnter();
  }, [room?.game, autoEnter]);

  const gameRef = useRef<HTMLDivElement>(null);
  useDockInset(gameRef, '.game__side', Boolean(room && state));

  if (!room || !state) return null;

  const isMyTurn = state.seats[state.seatIndex] === myId;
  const iAmBankrupt = state.players[myId]?.bankrupt ?? false;

  return (
    <div className="game" ref={gameRef} data-focus={focused || undefined}>
      {/* A strip along the top edge that reveals the header. The header
          itself is out of the way in focus mode, so something has to be
          left behind to bring it back. */}
      {focused && <div className="game__reveal" aria-hidden />}
      <header className="game__top">
        <button type="button" className="btn btn--ghost btn--sm" onClick={leave}>{t.common.leave}</button>
        <span className="game__turn overline">
          {t.game.turn(
            state.round,
            state.settings.winCondition === 'turn-limit' ? state.settings.turnLimit : null,
          )}
        </span>
        <div className="spacer" />
        {state.settings.freeParkingJackpot && (
          <span className="chip num" title={t.game.potTitle}>{t.game.pot(fmt(state.freeParkingPot))}</span>
        )}
        <span className="chip" title={t.game.stockTitle}>
          <span className="num">{state.housesRemaining}</span>&nbsp;{t.game.houses(state.housesRemaining)}
          <span aria-hidden>&middot;</span>
          <span className="num">{state.hotelsRemaining}</span>&nbsp;{t.game.hotels(state.hotelsRemaining)}
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={toggleRender}
          aria-pressed={renderMode === '3d'}
          data-hdr="wide"
          title={renderMode === '3d' ? t.game.toFlat : t.game.to3d}
        >
          {renderMode === '3d' ? (
            <svg {...glyph}><path d="M2.5 3.5h11v9h-11z" /><path d="M2.5 8h11M8 3.5v9" /></svg>
          ) : (
            <svg {...glyph}><path d="M8 2.2l4.8 2.4v6.8L8 13.8 3.2 11.4V4.6z" /><path d="M8 13.8V7.4M3.2 4.6L8 7.4l4.8-2.8" /></svg>
          )}
          <span className="btn__label">{renderMode === '3d' ? t.game.board3d : t.game.boardFlat}</span>
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={toggleSound}
          aria-pressed={soundOn}
          data-hdr="wide"
          title={soundOn ? t.game.soundOn : t.game.soundOff}
        >
          <svg {...glyph}>
            <path d="M2.5 6.2h2.8l3.2-2.7v9l-3.2-2.7H2.5z" fill="currentColor" stroke="none" />
            {soundOn
              ? <path d="M10.8 5.2a4 4 0 010 5.6M12.8 3.6a6.4 6.4 0 010 8.8" />
              : <path d="M10.8 5.8l3.4 4.4M14.2 5.8l-3.4 4.4" />}
          </svg>
          <span className="btn__label">{soundOn ? t.game.soundOn : t.game.soundOff}</span>
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={toggleHaptics}
          aria-pressed={hapticsOn}
          data-hdr="wide"
          title={t.game.haptics}
        >
          <svg {...glyph}>
            <rect x="5.4" y="2.6" width="5.2" height="10.8" rx="1.4" />
            {hapticsOn
              ? <path d="M2.6 6.4v3.2M13.4 6.4v3.2M1.4 7.6v.8M14.6 7.6v.8" />
              : <path d="M2.8 3.2l10.6 9.6" />}
          </svg>
          <span className="btn__label">{t.game.haptics}</span>
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={alerts.toggle}
          aria-pressed={alerts.on}
          data-hdr="wide"
          title={alerts.blocked ? t.table.alerts.blocked : t.table.alerts.title}
        >
          <svg {...glyph}>
            <path d="M8 2.4a3.6 3.6 0 013.6 3.6c0 2.8.9 3.9 1.4 4.4H3c.5-.5 1.4-1.6 1.4-4.4A3.6 3.6 0 018 2.4z" />
            <path d="M6.7 12.6a1.4 1.4 0 002.6 0" />
            {!alerts.on && <path d="M3.2 2.8l9.8 10.4" />}
          </svg>
          <span className="btn__label">{alerts.on ? t.table.alerts.on : t.table.alerts.off}</span>
        </button>
        <span data-hdr="wide"><LangSwitch /></span>
        <EndVoteButton vote={endVote} state={state} myId={myId} />
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setHelpOpen(true)}
          title={t.game.helpTitle}
          aria-label={t.game.howToPlay}
        >
          <span className="btn__label">{t.game.howToPlay}</span>
          <kbd className="kbd">?</kbd>
        </button>
        <TableMenu
          alerts={alerts}
          extra={[{ key: 'view', label: t.game.board3d, hint: t.game.to3d, on: renderMode === '3d', onToggle: toggleRender }]}
          footer={<EndVoteMenuRow vote={endVote} state={state} myId={myId} />}
        />
      </header>

      {netError && <div className="banner banner--bad" role="alert">{netError}</div>}
      <EndVoteBanner vote={endVote} state={state} myId={myId} dispatch={dispatch} />
      <Coach tips={monopolyTips(state, mySeatId)} />
      <Reactions game="monopoly" seat={room.seats.some((x) => x.playerId === mySeatId) ? mySeatId : null} />

      <div className="game__layout">
        <aside className="game__rail" data-open={sheet === 'players' || undefined}>
          <PlayerRail
            state={state}
            seats={room.seats}
            myId={myId}
            floats={floats}
            onInspectPlayer={setPortfolioOf}
            onSpotlight={setSpotlight}
            coowners={room.coowners ?? []}
            canKickSeat={(id) => canKick(room, mySeatId, room.seats.find((s) => s.playerId === id))}
            onKick={removeSeat}
          />
        </aside>

        <main className="game__stage">
          <div
            className="game__boardWrap"
            data-mode={renderMode}
            style={{ ['--board-zoom' as string]: zoom } as React.CSSProperties}
          >
            <BoardStage
              mode={renderMode}
              state={state}
              myId={myId}
              animPos={animPos}
              spotlight={spotlight ?? portfolioOf ?? pinned}
              rolling={rolling}
              onInspect={inspect}
              onFallback={fallBackTo2D}
              highlight={state.phase === 'awaiting_buy' || state.phase === 'auction'
                ? (state.auction?.spaceId ?? state.players[state.seats[state.seatIndex]].position)
                : null}
            />
          </div>
          <BoardTools
            zoom={zoom}
            focused={focused}
            onZoom={stepZoom}
            onToggleFocus={toggleFocus}
          />
        </main>

        <aside className="game__side" data-open={sheet === 'log' || undefined}>
          <SeatRequestsDock />
          <CoownerDock />
          <IncomingTrades
            state={state}
            myId={myId}
            dispatch={dispatch}
            onCounter={(offer) => { setCounterSeed({ offer }); setTradeOpen(true); }}
          />
          <ActionBar
            state={state}
            myId={myId}
            dispatch={dispatch}
            onTrade={() => { setCounterSeed(null); setTradeOpen(true); }}
            onContracts={() => setContractsOpen(true)}
          />
          <LogFeed log={log} chat={chat} state={state} onSend={useStore.getState().sendChat} />
        </aside>
      </div>

      <nav className="game__tabbar" aria-label={t.game.panelsAria}>
        <button type="button" className="tabbar__item" data-on={sheet === 'players' || undefined}
          onClick={() => openSheet(sheet === 'players' ? 'none' : 'players')}>
          {t.game.players}
        </button>
        <button type="button" className="tabbar__item" data-on={sheet === 'none' || undefined}
          onClick={() => openSheet('none')}>
          {t.game.board}
        </button>
        <button type="button" className="tabbar__item" data-on={sheet === 'log' || undefined}
          onClick={() => openSheet(sheet === 'log' ? 'none' : 'log')}>
          {t.game.actions}
        </button>
      </nav>

      <DeedCard
        state={state}
        spaceId={inspecting}
        myId={myId}
        onClose={() => inspect(null)}
        dispatch={dispatch}
      />
      <PortfolioModal
        state={state}
        playerId={portfolioOf}
        onClose={() => setPortfolioOf(null)}
        onShowOnBoard={showOnBoard}
        onInspect={(id) => { setPortfolioOf(null); inspect(id); }}
      />
      <TradePanel
        state={state}
        myId={myId}
        open={tradeOpen && !iAmBankrupt}
        onClose={() => { setTradeOpen(false); setCounterSeed(null); }}
        dispatch={dispatch}
        counter={counterSeed}
      />
      <ContractsModal
        state={state}
        myId={myId}
        open={contractsOpen && state.settings.dealsEnabled}
        onClose={() => setContractsOpen(false)}
        dispatch={dispatch}
      />
      {state.phase === 'auction' && <AuctionPanel state={state} myId={myId} dispatch={dispatch} />}
      <CardModal state={state} myId={myId} isMyTurn={isMyTurn} dispatch={dispatch} />
      {state.phase === 'game_over' && (
        <GameOver
          state={state}
          onLeave={leaveAfterBreak}
          onRematch={role !== 'guest' ? useStore.getState().rematch : undefined}
        />
      )}
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      <FxLayer request={fx} />
    </div>
  );
}

/* ============================ action bar ============================ */

function ActionBar({
  state, myId, dispatch, onTrade, onContracts,
}: {
  state: GameState;
  myId: string;
  dispatch: (a: GameAction) => void;
  onTrade: () => void;
  onContracts: () => void;
}) {
  const t = useT();
  const A = t.actions;
  /* Deal Maker's ledger sits beside Trade wherever Trade does: the two are
     one negotiation, and a contract you signed is something you check on. */
  const contracts = state.settings.dealsEnabled && state.players[myId] ? (
    <button
      type="button"
      className="btn btn--ghost btn--sm btn--contracts"
      onClick={onContracts}
      data-live={myContractCount(state, myId) > 0 || undefined}
    >
      <ContractGlyph kind="share" size={14} />
      {t.deals.ledger.button(myContractCount(state, myId))}
    </button>
  ) : null;
  const me = state.players[myId];
  const isMyTurn = state.seats[state.seatIndex] === myId;
  const current = state.players[state.seats[state.seatIndex]];
  const spectator = !me || me.bankrupt;

  const timeLeft = useCountdown(clockSeconds(state), clockKey(state));

  // Not at the table at all: a signed-in player watching a game in progress,
  // who can take over a bot.
  if (!me) return <TakeSeatPanel />;

  if (spectator) {
    return (
      <section className="actions">
        <p className="actions__title">{A.spectating}</p>
        <p className="muted small">{A.spectatingNote}</p>
      </section>
    );
  }

  /* --- raising cash outranks everything --- */
  if (state.phase === 'must_raise' && state.debt?.from === myId) {
    const debt = state.debt;
    const short = debt.amount - me.cash;
    const doomed = maxRaisable(state, myId) < debt.amount;
    const [shortBefore, shortAfter] = A.short;
    // A card's own sentence brings its full stop with it.
    const why = cap(trReason(t, debt.reason)).replace(/\.$/, '');
    return (
      <section className="actions actions--urgent">
        <p className="actions__title">
          {A.owe(fmt(debt.amount))}
          {timeLeft != null && <span className="actions__timer num"> {t.common.seconds(timeLeft)}</span>}
        </p>
        <p className="muted small">
          {why}. {shortBefore}<strong className="num">{fmt(short)}</strong>{shortAfter}
          {' '}{doomed ? A.doomed : A.raise}
        </p>
        <div className="actions__row">
          <button
            type="button"
            className={doomed ? 'btn btn--danger' : 'btn btn--ghost'}
            onClick={() => dispatch({ type: 'DECLARE_BANKRUPTCY', playerId: myId })}
          >
            {A.bankruptcy}
          </button>
          {state.settings.allowTrades && (
            <button type="button" className="btn" onClick={onTrade}>{t.common.offerTrade}</button>
          )}
          {contracts}
        </div>
        <p className="muted small">{A.tapHint}</p>
      </section>
    );
  }

  if (!isMyTurn) {
    return (
      <section className="actions">
        <p className="actions__title" style={{ color: current?.color }}>
          {A.theirTurn(current?.name ?? '')}
        </p>
        <p className="muted small">{A.waitNote}</p>
        <div className="actions__row">
          {state.settings.allowTrades && (
            <button type="button" className="btn btn--sm" onClick={onTrade}>{t.common.offerTrade}</button>
          )}
          {contracts}
        </div>
      </section>
    );
  }

  /* --- your turn --- */
  const space = BOARD[me.position];
  const [unownedBefore, unownedAfter] = A.unowned(spaceName(t, me.position));

  return (
    <section className="actions actions--mine">
      <p className="actions__title">
        {A.yourTurn}
        {timeLeft != null && <span className="actions__timer num"> {t.common.seconds(timeLeft)}</span>}
      </p>

      {state.phase === 'jailed_choice' && (
        <>
          <p className="muted small">{A.inJail(me.jailTurns + 1, state.settings.maxJailTurns)}</p>
          <div className="actions__row">
            <button
              type="button" className="btn btn--primary"
              onClick={() => dispatch({ type: 'ROLL', playerId: myId })}
            >
              {A.rollDoubles}
            </button>
            <button
              type="button" className="btn"
              disabled={me.cash < state.settings.jailFine}
              title={me.cash < state.settings.jailFine ? t.common.notEnoughCash : undefined}
              onClick={() => dispatch({ type: 'PAY_JAIL_FINE', playerId: myId })}
            >
              {t.common.pay(fmt(state.settings.jailFine))}
            </button>
            {me.getOutOfJailCards > 0 && (
              <button
                type="button" className="btn"
                onClick={() => dispatch({ type: 'USE_JAIL_CARD', playerId: myId })}
              >
                {A.useCard}
              </button>
            )}
          </div>
        </>
      )}

      {state.phase === 'preroll' && (
        <>
          <p className="muted small">
            {state.doublesCount > 0 ? A.doublesAgain(state.doublesCount) : A.rollToMove}
          </p>
          <button
            type="button" className="btn btn--primary btn--block"
            data-hotkey="advance"
            onClick={() => dispatch({ type: 'ROLL', playerId: myId })}
          >
            {A.roll}
            <kbd className="kbd">{t.common.keySpace}</kbd>
          </button>
        </>
      )}

      {state.phase === 'awaiting_buy' && (
        <>
          <p className="actions__lead">
            {unownedBefore}<strong className="num">{fmt(space.price ?? 0)}</strong>{unownedAfter}
          </p>
          <div className="actions__row">
            <button
              type="button" className="btn btn--primary"
              disabled={me.cash < (space.price ?? 0)}
              title={me.cash < (space.price ?? 0) ? t.common.notEnoughCash : undefined}
              onClick={() => dispatch({ type: 'BUY_PROPERTY', playerId: myId })}
            >
              {A.buyFor(fmt(space.price ?? 0))}
            </button>
            <button
              type="button" className="btn"
              onClick={() => dispatch({ type: 'DECLINE_PROPERTY', playerId: myId })}
            >
              {state.settings.auctionsEnabled ? A.toAuction : t.common.pass}
            </button>
          </div>
          {me.cash < (space.price ?? 0) && maxRaisable(state, myId) >= (space.price ?? 0) && (
            <p className="muted small">{A.raiseToBuy}</p>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => useStore.getState().inspect(me.position)}>
            {A.seeDeed}
          </button>
        </>
      )}

      {state.phase === 'turn_end' && (
        <>
          <p className="muted small">{A.turnEndNote}</p>
          <button
            type="button" className="btn btn--primary btn--block"
            data-hotkey="advance"
            onClick={() => dispatch({ type: 'END_TURN', playerId: myId })}
          >
            {A.endTurn}
            <kbd className="kbd">{t.common.keySpace}</kbd>
          </button>
        </>
      )}

      <div className="actions__row actions__row--sub">
        {state.settings.allowTrades && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={onTrade}>{t.common.trade}</button>
        )}
        {contracts}
        <button
          type="button" className="btn btn--ghost btn--sm"
          onClick={() => useStore.getState().inspect(me.position)}
        >
          {A.whereAmI}
        </button>
      </div>
    </section>
  );
}

/* =========================== drawn card ============================= */

function CardModal({
  state, myId, isMyTurn, dispatch,
}: { state: GameState; myId: string; isMyTurn: boolean; dispatch: (a: GameAction) => void }) {
  const t = useT();
  const theme = useBoardTheme();
  const card = state.activeCard;
  const drawer = state.players[state.seats[state.seatIndex]];

  // One card on the table is one draw: the roll that drew it moved the dice
  // cursor, so this names it for as long as it stays up.
  const drawKey = card ? `${state.turnNumber}:${state.rngCursor}:${card.id}` : '';
  const [putDown, setPutDown] = useState('');

  const dismiss = useMemo(
    () => () => {
      if (isMyTurn) dispatch({ type: 'DISMISS_CARD', playerId: myId });
      else setPutDown(drawKey);
    },
    [isMyTurn, dispatch, myId, drawKey],
  );

  // Somebody else's card is theirs to act on. The rest of the table reads it
  // for a moment and gets the board back, instead of sitting behind it until
  // that player gets round to clicking.
  useEffect(() => {
    if (!card || isMyTurn) return;
    const timer = window.setTimeout(() => setPutDown(drawKey), 3500);
    return () => window.clearTimeout(timer);
  }, [card, isMyTurn, drawKey]);

  return (
    <AnimatePresence>
      {card && putDown !== drawKey && (
        <Modal open onClose={dismiss}>
          {/* The card turns over rather than tilting into view, which is
              what the printed deck back is for: it is what you see for the
              first half of the rotation. The scene owns the perspective;
              without it the rotation flattens into a horizontal squash. */}
          <div className="cardFlip__scene">
          <motion.div
            className="cardFlip"
            initial={{ rotateY: 180, opacity: 0 }}
            animate={{ rotateY: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 90, damping: 16 }}
          >
            <div
              className="cardFlip__back"
              style={{ backgroundImage: `url("${themedDeckBack(theme, card.deck)}")` }}
              aria-hidden="true"
            />
            <div className={`drawnCard drawnCard--${card.deck} cardFlip__front`}>
              <span className="drawnCard__medallion">
                <BoardIcon icon={card.deck === 'chance' ? 'chance' : 'chest'} />
              </span>
              <span className="drawnCard__deck">{t.decks[card.deck]}</span>
              {/* One engraved vignette per card. Decorative: the card text
                  below already says everything, so it carries no alt text
                  and never delays the modal. */}
              <img
                className="drawnCard__art"
                src={cardArt(card.id)}
                alt=""
                width={320}
                height={320}
                loading="lazy"
                decoding="async"
              />
              <p className="drawnCard__text">{t.cards[card.id] ?? card.text}</p>
              <span className="drawnCard__who" style={{ color: drawer?.color }}>
                {t.card.drawnBy(drawer?.name ?? '')}
              </span>
              {isMyTurn && (
                <button
                  type="button"
                  className="btn btn--primary btn--block"
                  data-hotkey="advance"
                  onClick={dismiss}
                >
                  {t.common.continue}
                  <kbd className="kbd">{t.common.keySpace}</kbd>
                </button>
              )}
            </div>
          </motion.div>
          </div>
        </Modal>
      )}
    </AnimatePresence>
  );
}
