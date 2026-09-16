import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../../styles/cashflow.css';
import { cfDescribe } from '../../cashflow/describe';
import { useT } from '../../i18n';
import { useStore } from '../../store/store';
import { canKick } from '../../net/moderation';
import { SeatRequestsDock, CoownerDock } from '../Account';
import { tableNeed, useAlertsSwitch, useTableAlert } from '../alerts';
import { useWakeLock } from '../wakeLock';
import { FxLayer, useFx } from '../Fx';
import { useGameKeys } from '../Help';
import { LangSwitch } from '../LangSwitch';
import { FeedView, type FeedLine } from '../Panels';
import { CFActions } from './CFActions';
import { CFBoard } from './CFBoard';
import { CFGameOver, CFHelp, DreamPicker, PlayerStatementModal } from './CFModals';
import { CFRail } from './CFRail';
import { CFStatement } from './CFStatement';

/**
 * The Cashflow table. Same shell as the Monopoly one - rail of players on
 * the left, the board as the hero, actions and the log on the right, and
 * sheets on a phone - but every panel in it reads a financial statement
 * rather than a stack of deeds.
 */
export default function CashflowGame() {
  const t = useT();
  const room = useStore((s) => s.room);
  const me = useStore((s) => s.me);
  const cfLog = useStore((s) => s.cfLog);
  const chat = useStore((s) => s.chat);
  const floats = useStore((s) => s.floats);
  const rolling = useStore((s) => s.rolling);
  const sheet = useStore((s) => s.sheet);
  const soundOn = useStore((s) => s.soundOn);
  const hapticsOn = useStore((s) => s.hapticsOn);
  const netError = useStore((s) => s.netError);
  const dispatch = useStore((s) => s.dispatch);
  const openSheet = useStore((s) => s.openSheet);
  const toggleSound = useStore((s) => s.toggleSound);
  const toggleHaptics = useStore((s) => s.toggleHaptics);
  const leave = useStore((s) => s.leave);
  const sendChat = useStore((s) => s.sendChat);

  // As on the other table: the screen stays lit while the game is on it.
  useWakeLock(true);

  const [helpOpen, setHelpOpen] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const noFocusMode = useCallback(() => {}, []);
  useGameKeys(useCallback(() => setHelpOpen((v) => !v), []), noFocusMode);

  const s = room?.cf ?? null;
  const myId = me.playerId;
  const mine = s?.players[myId] ?? null;
  const role = useStore((st) => st.role);
  const removeSeat = useStore((st) => st.removeSeat);
  // The seat I actually play: my own id, or a bot seat I took over.
  const mySeatId = room?.seats.find((x) => x.playerId === myId || room.owners?.[x.playerId] === myId)?.playerId ?? myId;

  const alerts = useAlertsSwitch();
  const need = useMemo(() => tableNeed(t, room, myId, role === 'host'), [t, room, myId, role]);
  useTableAlert(need, alerts.on);

  /* Table effects, only ever for the local player. */
  const [fx, fire] = useFx();
  const myCash = mine?.cash ?? null;
  const prevCash = useRef<number | null>(null);
  const fired = useRef({ out: false, won: false, escaped: false });
  useEffect(() => {
    if (myCash == null) return;
    const before = prevCash.current;
    prevCash.current = myCash;
    if (before != null && myCash > before) fire('coins');
  }, [myCash, fire]);
  const iAmOut = mine?.out ?? false;
  const iWon = s?.phase === 'game_over' && s.winnerId === myId;
  useEffect(() => {
    if (iAmOut && !fired.current.out) { fired.current.out = true; fire('ash'); }
    if (iWon && !fired.current.won) { fired.current.won = true; fire('victory'); }
  }, [iAmOut, iWon, fire]);

  const lines: FeedLine[] = useMemo(() => (s
    ? cfLog.map((l) => ({
      id: l.id,
      tone: l.tone,
      color: l.actor ? s.players[l.actor]?.color : undefined,
      text: cfDescribe(s, l.event, t),
    }))
    : []), [cfLog, s, t]);

  if (!room || !s) return null;

  const round = Math.max(1, s.round);

  return (
    <div className="cfGame">
      <header className="cfGame__top">
        <button type="button" className="btn btn--ghost btn--sm" onClick={leave}>{t.common.leave}</button>
        <span className="overline cfGame__title">
          {t.cf.name} · {t.game.turn(round, s.settings.turnLimit > 0 ? s.settings.turnLimit : null)}
        </span>
        <div className="spacer" />
        <button type="button" className="btn btn--ghost btn--sm" onClick={toggleSound} aria-pressed={soundOn}>
          {soundOn ? t.game.soundOn : t.game.soundOff}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={toggleHaptics}
          aria-pressed={hapticsOn}
          title={t.game.haptics}
        >
          {t.game.haptics}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={alerts.toggle}
          aria-pressed={alerts.on}
          title={alerts.blocked ? t.table.alerts.blocked : t.table.alerts.title}
        >
          {alerts.on ? t.table.alerts.on : t.table.alerts.off}
        </button>
        <LangSwitch />
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setHelpOpen(true)}
          aria-label={t.game.howToPlay}
        >
          <span className="cfGame__helpLabel">{t.game.howToPlay}</span>
          <kbd className="kbd">?</kbd>
        </button>
      </header>

      {netError && <div className="banner banner--bad" role="alert">{netError}</div>}

      <div className="cfGame__layout">
        <aside className="cfGame__rail" data-open={sheet === 'players' || undefined}>
          <CFRail
            s={s}
            myId={myId}
            floats={floats}
            onOpen={setViewing}
            seats={room.seats}
            coowners={room.coowners ?? []}
            canKickSeat={(id) => canKick(room, mySeatId, room.seats.find((x) => x.playerId === id))}
            onKick={removeSeat}
          />
        </aside>

        <main className="cfGame__stage">
          <CFBoard s={s} myId={myId} rolling={rolling} />
        </main>

        <aside className="cfGame__side" data-open={sheet === 'log' || undefined}>
          <SeatRequestsDock />
          <CoownerDock />
          <CFActions s={s} myId={myId} dispatch={dispatch} />
          {mine && <CFStatement s={s} p={mine} interactive dispatch={dispatch} />}
          <FeedView lines={lines} chat={chat} onSend={sendChat} />
        </aside>
      </div>

      <nav className="cfGame__tabbar" aria-label={t.game.panelsAria}>
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

      <DreamPicker s={s} myId={myId} dispatch={dispatch} />
      <PlayerStatementModal s={s} playerId={viewing} onClose={() => setViewing(null)} />
      {s.phase === 'game_over' && (
        <CFGameOver
          s={s}
          myId={myId}
          onLeave={leave}
          onRematch={role !== 'guest' ? useStore.getState().rematch : undefined}
        />
      )}
      <CFHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <FxLayer request={fx} />
    </div>
  );
}
