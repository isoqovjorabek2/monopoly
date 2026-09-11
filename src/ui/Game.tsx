import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BOARD } from '../game/board';
import { clockKey, clockSeconds, maxRaisable } from '../game/rules';
import type { GameAction, GameState } from '../game/types';
import { cap, spaceName, trReason, useT } from '../i18n';
import { useStore } from '../store/store';
import { BoardStage, readRenderMode, writeRenderMode, type RenderMode } from './BoardStage';
import { BoardTools, readBoardZoom, useFocusMode, writeBoardZoom, ZOOM_STEPS } from './BoardTools';
import { DeedCard } from './DeedCard';
import {
  AuctionPanel, GameOver, IncomingTrades, LogFeed, PlayerRail, PortfolioModal, TradePanel,
} from './Panels';
import { Modal, fmt, useCountdown } from './bits';
import { BoardIcon } from './Pieces';
import { FxLayer, useFx } from './Fx';
import { cardArt, deckBack } from '../art/art';
import { HelpModal, useGameKeys } from './Help';
import { LangSwitch } from './LangSwitch';

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
  const netError = useStore((s) => s.netError);

  const dispatch = useStore((s) => s.dispatch);
  const inspect = useStore((s) => s.inspect);
  const openSheet = useStore((s) => s.openSheet);
  const toggleSound = useStore((s) => s.toggleSound);
  const leave = useStore((s) => s.leave);

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

  if (!room || !state) return null;

  const isMyTurn = state.seats[state.seatIndex] === myId;
  const iAmBankrupt = state.players[myId]?.bankrupt ?? false;

  return (
    <div className="game" data-focus={focused || undefined}>
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
          title={renderMode === '3d' ? t.game.toFlat : t.game.to3d}
        >
          {renderMode === '3d' ? t.game.board3d : t.game.boardFlat}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={toggleSound}
          aria-pressed={soundOn}
        >
          {soundOn ? t.game.soundOn : t.game.soundOff}
        </button>
        <LangSwitch />
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setHelpOpen(true)}
          title={t.game.helpTitle}
        >
          {t.game.howToPlay}
          <kbd className="kbd">?</kbd>
        </button>
      </header>

      {netError && <div className="banner banner--bad" role="alert">{netError}</div>}

      <div className="game__layout">
        <aside className="game__rail" data-open={sheet === 'players' || undefined}>
          <PlayerRail
            state={state}
            seats={room.seats}
            myId={myId}
            floats={floats}
            onInspectPlayer={setPortfolioOf}
            onSpotlight={setSpotlight}
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
          <IncomingTrades state={state} myId={myId} dispatch={dispatch} />
          <ActionBar state={state} myId={myId} dispatch={dispatch} onTrade={() => setTradeOpen(true)} />
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
        onClose={() => setTradeOpen(false)}
        dispatch={dispatch}
      />
      {state.phase === 'auction' && <AuctionPanel state={state} myId={myId} dispatch={dispatch} />}
      <CardModal state={state} myId={myId} isMyTurn={isMyTurn} dispatch={dispatch} />
      {state.phase === 'game_over' && <GameOver state={state} onLeave={leave} />}
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      <FxLayer request={fx} />
    </div>
  );
}

/* ============================ action bar ============================ */

function ActionBar({
  state, myId, dispatch, onTrade,
}: {
  state: GameState;
  myId: string;
  dispatch: (a: GameAction) => void;
  onTrade: () => void;
}) {
  const t = useT();
  const A = t.actions;
  const me = state.players[myId];
  const isMyTurn = state.seats[state.seatIndex] === myId;
  const current = state.players[state.seats[state.seatIndex]];
  const spectator = !me || me.bankrupt;

  const timeLeft = useCountdown(clockSeconds(state), clockKey(state));

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
              style={{ backgroundImage: `url("${deckBack(card.deck)}")` }}
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
