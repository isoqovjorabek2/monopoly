import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BOARD } from '../game/board';
import { maxRaisable } from '../game/rules';
import type { GameAction, GameState } from '../game/types';
import { useStore } from '../store/store';
import { BoardStage, readRenderMode, writeRenderMode, type RenderMode } from './BoardStage';
import { DeedCard } from './DeedCard';
import {
  AuctionPanel, GameOver, IncomingTrades, LogFeed, PlayerRail, PortfolioModal, TradePanel,
} from './Panels';
import { Modal, fmt } from './bits';
import { BoardIcon } from './Pieces';
import { FxLayer, useFx } from './Fx';
import { cardArt, deckBack } from '../art/art';
import { HelpModal, useGameKeys } from './Help';

export function Game() {
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
  const [tradeOpen, setTradeOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [renderMode, setRenderMode] = useState<RenderMode>(readRenderMode);
  // Stable by construction: BoardStage keys an effect on this, and an inline
  // arrow made that effect re-run on every render of the game screen.
  const fallBackTo2D = useCallback(() => setRenderMode('2d'), []);

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

  useGameKeys(useCallback(() => setHelpOpen((v) => !v), []));

  if (!room || !state) return null;

  const isMyTurn = state.seats[state.seatIndex] === myId;
  const iAmBankrupt = state.players[myId]?.bankrupt ?? false;

  return (
    <div className="game">
      <header className="game__top">
        <button type="button" className="btn btn--ghost btn--sm" onClick={leave}>Leave</button>
        <span className="game__turn overline">
          Turn {state.turnNumber}
          {state.settings.winCondition === 'turn-limit' && ` of ${state.settings.turnLimit}`}
        </span>
        <div className="spacer" />
        {state.settings.freeParkingJackpot && (
          <span className="chip num" title="Free Parking pot">Pot {fmt(state.freeParkingPot)}</span>
        )}
        <span className="chip" title="Houses and hotels still available from the bank">
          <span className="num">{state.housesRemaining}</span>&nbsp;houses
          <span aria-hidden>&middot;</span>
          <span className="num">{state.hotelsRemaining}</span>&nbsp;hotels
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={toggleRender}
          aria-pressed={renderMode === '3d'}
          title={renderMode === '3d'
            ? 'Switch to the flat board'
            : 'Switch to the three-dimensional board'}
        >
          {renderMode === '3d' ? '3D board' : 'Flat board'}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={toggleSound}
          aria-pressed={soundOn}
        >
          {soundOn ? 'Sound on' : 'Sound off'}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setHelpOpen(true)}
          title="Rules and keyboard shortcuts"
        >
          How to play
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
          />
        </aside>

        <main className="game__stage">
          <div className="game__boardWrap" data-mode={renderMode}>
            <BoardStage
              mode={renderMode}
              state={state}
              animPos={animPos}
              rolling={rolling}
              onInspect={inspect}
              onFallback={fallBackTo2D}
              highlight={state.phase === 'awaiting_buy' || state.phase === 'auction'
                ? (state.auction?.spaceId ?? state.players[state.seats[state.seatIndex]].position)
                : null}
            />
          </div>
        </main>

        <aside className="game__side" data-open={sheet === 'log' || undefined}>
          <ActionBar state={state} myId={myId} dispatch={dispatch} onTrade={() => setTradeOpen(true)} />
          <LogFeed log={log} chat={chat} state={state} onSend={useStore.getState().sendChat} />
        </aside>
      </div>

      <nav className="game__tabbar" aria-label="Panels">
        <button type="button" className="tabbar__item" data-on={sheet === 'players' || undefined}
          onClick={() => openSheet(sheet === 'players' ? 'none' : 'players')}>
          Players
        </button>
        <button type="button" className="tabbar__item" data-on={sheet === 'none' || undefined}
          onClick={() => openSheet('none')}>
          Board
        </button>
        <button type="button" className="tabbar__item" data-on={sheet === 'log' || undefined}
          onClick={() => openSheet(sheet === 'log' ? 'none' : 'log')}>
          Actions
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
        onInspect={(id) => { setPortfolioOf(null); inspect(id); }}
      />
      <TradePanel
        state={state}
        myId={myId}
        open={tradeOpen && !iAmBankrupt}
        onClose={() => setTradeOpen(false)}
        dispatch={dispatch}
      />
      <IncomingTrades state={state} myId={myId} dispatch={dispatch} />
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
  const me = state.players[myId];
  const isMyTurn = state.seats[state.seatIndex] === myId;
  const current = state.players[state.seats[state.seatIndex]];
  const spectator = !me || me.bankrupt;

  const timeLeft = useTurnTimer(state);

  if (spectator) {
    return (
      <section className="actions">
        <p className="actions__title">Spectating</p>
        <p className="muted small">
          You are out of the game, but you can watch it finish.
        </p>
      </section>
    );
  }

  /* --- raising cash outranks everything --- */
  if (state.phase === 'must_raise' && state.debt?.from === myId) {
    const debt = state.debt;
    const short = debt.amount - me.cash;
    const doomed = maxRaisable(state, myId) < debt.amount;
    return (
      <section className="actions actions--urgent">
        <p className="actions__title">You owe {fmt(debt.amount)}</p>
        <p className="muted small">
          {debt.reason}. You are <strong className="num">{fmt(short)}</strong> short.
          {doomed
            ? ' Even selling everything will not cover it.'
            : ' Mortgage deeds or sell buildings from the board to raise it.'}
        </p>
        <div className="actions__row">
          <button
            type="button"
            className={doomed ? 'btn btn--danger' : 'btn btn--ghost'}
            onClick={() => dispatch({ type: 'DECLARE_BANKRUPTCY', playerId: myId })}
          >
            Declare bankruptcy
          </button>
          {state.settings.allowTrades && (
            <button type="button" className="btn" onClick={onTrade}>Offer a trade</button>
          )}
        </div>
        <p className="muted small">
          Tap any deed you own on the board to mortgage it or sell its buildings.
        </p>
      </section>
    );
  }

  if (!isMyTurn) {
    return (
      <section className="actions">
        <p className="actions__title" style={{ color: current?.color }}>
          {current?.name}&apos;s turn
        </p>
        <p className="muted small">
          You can still manage your own property and offer trades while you wait.
        </p>
        <div className="actions__row">
          {state.settings.allowTrades && (
            <button type="button" className="btn btn--sm" onClick={onTrade}>Offer a trade</button>
          )}
        </div>
      </section>
    );
  }

  /* --- your turn --- */
  const space = BOARD[me.position];

  return (
    <section className="actions actions--mine">
      <p className="actions__title">
        Your turn
        {timeLeft != null && <span className="actions__timer num"> {timeLeft}s</span>}
      </p>

      {state.phase === 'jailed_choice' && (
        <>
          <p className="muted small">
            You are in jail (turn {me.jailTurns + 1} of {state.settings.maxJailTurns}).
            Roll for doubles, or buy your way out.
          </p>
          <div className="actions__row">
            <button
              type="button" className="btn btn--primary"
              onClick={() => dispatch({ type: 'ROLL', playerId: myId })}
            >
              Roll for doubles
            </button>
            <button
              type="button" className="btn"
              disabled={me.cash < state.settings.jailFine}
              title={me.cash < state.settings.jailFine ? 'Not enough cash' : undefined}
              onClick={() => dispatch({ type: 'PAY_JAIL_FINE', playerId: myId })}
            >
              Pay {fmt(state.settings.jailFine)}
            </button>
            {me.getOutOfJailCards > 0 && (
              <button
                type="button" className="btn"
                onClick={() => dispatch({ type: 'USE_JAIL_CARD', playerId: myId })}
              >
                Use free pass
              </button>
            )}
          </div>
        </>
      )}

      {state.phase === 'preroll' && (
        <>
          <p className="muted small">
            {state.doublesCount > 0
              ? `You rolled doubles - go again. ${state.doublesCount} in a row; three sends you to jail.`
              : 'Roll the dice to move.'}
          </p>
          <button
            type="button" className="btn btn--primary btn--block"
            data-hotkey="advance"
            onClick={() => dispatch({ type: 'ROLL', playerId: myId })}
          >
            Roll the dice
            <kbd className="kbd">space</kbd>
          </button>
        </>
      )}

      {state.phase === 'awaiting_buy' && (
        <>
          <p className="actions__lead">
            {space.name} is unowned. It costs <strong className="num">{fmt(space.price ?? 0)}</strong>.
          </p>
          <div className="actions__row">
            <button
              type="button" className="btn btn--primary"
              disabled={me.cash < (space.price ?? 0)}
              title={me.cash < (space.price ?? 0) ? 'Not enough cash' : undefined}
              onClick={() => dispatch({ type: 'BUY_PROPERTY', playerId: myId })}
            >
              Buy for {fmt(space.price ?? 0)}
            </button>
            <button
              type="button" className="btn"
              onClick={() => dispatch({ type: 'DECLINE_PROPERTY', playerId: myId })}
            >
              {state.settings.auctionsEnabled ? 'Send to auction' : 'Pass'}
            </button>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => useStore.getState().inspect(me.position)}>
            See the title deed
          </button>
        </>
      )}

      {state.phase === 'turn_end' && (
        <>
          <p className="muted small">
            Build, mortgage or trade before you pass the dice.
          </p>
          <button
            type="button" className="btn btn--primary btn--block"
            data-hotkey="advance"
            onClick={() => dispatch({ type: 'END_TURN', playerId: myId })}
          >
            End turn
            <kbd className="kbd">space</kbd>
          </button>
        </>
      )}

      <div className="actions__row actions__row--sub">
        {state.settings.allowTrades && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={onTrade}>Trade</button>
        )}
        <button
          type="button" className="btn btn--ghost btn--sm"
          onClick={() => useStore.getState().inspect(me.position)}
        >
          Where am I?
        </button>
      </div>
    </section>
  );
}

/** Counts down only for display; the host is the authority on timeouts. */
function useTurnTimer(state: GameState): number | null {
  const limit = state.settings.turnTimer;
  const [left, setLeft] = useState(limit);

  useEffect(() => {
    if (limit <= 0) return;
    setLeft(limit);
    const t = window.setInterval(() => setLeft((v) => Math.max(0, v - 1)), 1000);
    return () => window.clearInterval(t);
  }, [limit, state.turnNumber, state.phase]);

  if (limit <= 0) return null;
  return left;
}

/* =========================== drawn card ============================= */

function CardModal({
  state, myId, isMyTurn, dispatch,
}: { state: GameState; myId: string; isMyTurn: boolean; dispatch: (a: GameAction) => void }) {
  const card = state.activeCard;
  const drawer = state.players[state.seats[state.seatIndex]];

  const dismiss = useMemo(
    () => () => { if (isMyTurn) dispatch({ type: 'DISMISS_CARD', playerId: myId }); },
    [isMyTurn, dispatch, myId],
  );

  // Cards drawn by other players clear themselves so the table keeps moving.
  useEffect(() => {
    if (!card || isMyTurn) return;
    const t = window.setTimeout(() => {}, 100);
    return () => window.clearTimeout(t);
  }, [card, isMyTurn]);

  return (
    <AnimatePresence>
      {card && (
        <Modal open onClose={dismiss} dismissable={isMyTurn}>
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
              <span className="drawnCard__deck">
                {card.deck === 'chance' ? 'Chance' : 'Community Chest'}
              </span>
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
              <p className="drawnCard__text">{card.text}</p>
              <span className="drawnCard__who" style={{ color: drawer?.color }}>
                drawn by {drawer?.name}
              </span>
              {isMyTurn && (
                <button
                  type="button"
                  className="btn btn--primary btn--block"
                  data-hotkey="advance"
                  onClick={dismiss}
                >
                  Continue
                  <kbd className="kbd">space</kbd>
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
