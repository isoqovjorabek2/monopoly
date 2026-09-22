import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import '../../styles/mafia.css';
import { MAF_ART, mafRoleCard } from '../../art/art';
import { useT } from '../../i18n';
import { ROLE_TEAM } from '../../mafia/data';
import { deathLine, mafDescribe } from '../../mafia/describe';
import { clockKey, clockSeconds, isFamily, waitingOn } from '../../mafia/rules';
import type {
  MafiaAction, MafiaDeath, MafiaPrivate, MafiaState, NightKind,
} from '../../mafia/types';
import { canKick } from '../../net/moderation';
import { useStore } from '../../store/store';
import { CoownerDock, SeatRequestsDock, TakeSeatPanel } from '../Account';
import { useBreakBefore } from '../Ads';
import { useAlertsSwitch, useTableAlert } from '../alerts';
import { useCountdown } from '../bits';
import { FxLayer, useFx } from '../Fx';
import { useGameKeys } from '../Help';
import { LangSwitch } from '../LangSwitch';
import type { FeedLine } from '../Panels';
import { useWakeLock } from '../wakeLock';
import { playSting, playTrack, readMusicOn, saveMusicOn, type MafTrack } from './audio';
import { MafiaFeed } from './MafiaChat';
import { ElimScreen, MafiaGameOver, MafiaHelp, RoleReveal, myTeamWon } from './MafiaOverlays';
import { Town, type TownLayout } from './MafiaTown';

type Dispatch = (a: MafiaAction) => void;

/** What a tap on a chair means right now. */
type Aim = { kind: NightKind } | { kind: 'vote' } | { kind: 'snipe' };

/** Who an aim may land on, mirroring rules.isLegal from what this seat can
 *  see: the family never marks its own, only the doctor may pick themselves,
 *  and not last night's patient. */
function targetsFor(m: MafiaState, me: string, aim: Aim, priv: MafiaPrivate | null): string[] {
  const family = new Set((priv?.teammates ?? []).map((x) => x.id));
  return m.seats.filter((id) => {
    if (!m.players[id]?.alive) return false;
    if (aim.kind === 'protect') return id !== priv?.noProtect;
    if (id === me) return false;
    if (aim.kind === 'kill') return !family.has(id);
    return true;
  });
}

const LAYOUT_KEY = 'mply.mafLayout';
const readLayout = (): TownLayout => {
  try { return localStorage.getItem(LAYOUT_KEY) === 'round' ? 'round' : 'grid'; } catch { return 'grid'; }
};

/**
 * The Omertà table: the town as a ring of chairs, the night or the day
 * across the middle, the talk and the log to the side. Everything a
 * player may know comes from the public state plus their own private
 * slice; nothing here can see another seat's role.
 */
export default function MafiaGame() {
  const t = useT();
  const M = t.maf;
  const room = useStore((s) => s.room);
  const me = useStore((s) => s.me);
  const role = useStore((s) => s.role);
  const priv = useStore((s) => s.mafPrivate);
  const mafLog = useStore((s) => s.mafLog);
  const chat = useStore((s) => s.chat);
  const sheet = useStore((s) => s.sheet);
  const soundOn = useStore((s) => s.soundOn);
  const netError = useStore((s) => s.netError);
  const dispatch = useStore((s) => s.dispatch) as Dispatch;
  const openSheet = useStore((s) => s.openSheet);
  const toggleSound = useStore((s) => s.toggleSound);
  const sendChat = useStore((s) => s.sendChat);
  const skip = useStore((s) => s.mafSkip);
  const removeSeat = useStore((s) => s.removeSeat);
  const leave = useStore((s) => s.leave);
  const leaveAfterBreak = useBreakBefore(leave);

  useWakeLock(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const noFocusMode = useCallback(() => {}, []);
  useGameKeys(useCallback(() => setHelpOpen((v) => !v), []), noFocusMode);

  const [layout, setLayout] = useState<TownLayout>(readLayout);
  const changeLayout = (v: TownLayout) => {
    setLayout(v);
    try { localStorage.setItem(LAYOUT_KEY, v); } catch { /* private mode */ }
  };
  const [musicOn, setMusicOn] = useState(readMusicOn);

  const m = room?.mf ?? null;
  const myId = me.playerId;
  const mine = m?.players[myId] ?? null;
  const isHost = Boolean(room && room.hostId === myId);
  const name = useCallback((id: string | null | undefined): string => (id && m?.players[id]?.name) || M.table.nobody, [m, M]);

  /* A role with two night moves (the detective, a lone silencer) picks one. */
  const [mode, setMode] = useState<NightKind | null>(null);
  /* One choice in hand at a time; a new phase or round starts it afresh. */
  const [picked, setPicked] = useState<string | null>(null);
  const phaseKey = m ? `${m.phase}:${m.round}` : '';
  useEffect(() => { setPicked(null); }, [phaseKey, mode]);

  const left = useCountdown(m ? clockSeconds(m) : 0, m ? clockKey(m) : '');

  /* The score follows the phase. */
  const phase = m?.phase;
  useEffect(() => {
    const track: MafTrack | null = !soundOn || !musicOn ? null
      : phase === 'night' ? 'night' : phase === 'day' ? 'day' : phase === 'vote' ? 'voting' : null;
    playTrack(track);
  }, [phase, soundOn, musicOn]);
  useEffect(() => () => playTrack(null), []);

  /* The card is turned over once per game, when the role arrives. */
  const [revealing, setRevealing] = useState(false);
  const hadRole = useRef(false);
  useEffect(() => {
    if (priv && !hadRole.current && m?.round === 1 && m.phase === 'night') {
      setRevealing(true);
      if (soundOn) playSting('reveal', 0.5);
    }
    hadRole.current = Boolean(priv);
  }, [priv, m?.round, m?.phase, soundOn]);

  /* A death takes the whole screen for a moment, one at a time. The queue
   * is a plain list; the state only ever holds its head, so nothing with a
   * side effect runs inside a state update. */
  const [elims, setElims] = useState<MafiaDeath[]>([]);
  const aliveBefore = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!m) return;
    const alive = new Set(m.seats.filter((id) => m.players[id].alive));
    const before = aliveBefore.current;
    aliveBefore.current = alive;
    if (!before) return;
    const fresh = m.lastDeaths.filter((d) => before.has(d.id) && !alive.has(d.id));
    if (fresh.length === 0) return;
    setElims((q) => [...q, ...fresh]);
    if (soundOn) playSting('elim', 0.6);
  }, [m, soundOn]);
  const elim = elims[0] ?? null;
  const nextElim = useCallback(() => setElims((q) => q.slice(1)), []);

  /* A whisper or the family's word, heard. */
  const heard = useRef(chat.length);
  useEffect(() => {
    const fresh = chat.slice(heard.current);
    heard.current = chat.length;
    if (soundOn && fresh.some((c) => c.from !== myId && (c.channel === 'whisper' || c.channel === 'family'))) {
      playSting('notif', 0.4);
    }
  }, [chat, myId, soundOn]);

  /* The tab title flashes when the table is waiting on this player. */
  const alerts = useAlertsSwitch();
  const need = useMemo(() => {
    if (!m || !mine?.alive) return null;
    const mineToDo = (m.phase === 'night' && Boolean(priv) && priv!.kinds.length > 0 && !priv!.move)
      || (m.phase === 'vote' && !(myId in m.votes));
    return mineToDo ? { key: `maf|${m.phase}|${m.round}`, message: t.table.alerts.needed } : null;
  }, [m, mine, myId, priv, t]);
  useTableAlert(need, alerts.on);

  /* The ending, for this seat. */
  const [fx, fire] = useFx();
  const ended = useRef(false);
  useEffect(() => {
    if (m?.phase !== 'game_over') { ended.current = false; return; }
    if (ended.current) return;
    ended.current = true;
    const won = myTeamWon(m, myId);
    if (won) fire('victory');
    if (soundOn && m.players[myId]) playSting(won ? 'victory' : 'defeat', 0.6);
  }, [m, myId, fire, soundOn]);

  const lines: FeedLine[] = useMemo(() => (m
    ? mafLog.map((l) => ({
      id: l.id,
      tone: l.tone,
      color: l.actor ? m.players[l.actor]?.color : undefined,
      text: mafDescribe(m, l.event, t),
    })).filter((l) => l.text)
    : []), [mafLog, m, t]);

  if (!room || !m) return null;

  const night = m.phase === 'night';
  const aliveCount = m.seats.filter((id) => m.players[id].alive).length;
  const phaseTitle = m.phase === 'night' ? M.night.title(m.round)
    : m.phase === 'day' ? M.day.title(m.round)
      : m.phase === 'vote' ? M.vote.title
        : M.over.title;

  // What a tap on a chair means right now.
  let aim: Aim | null = null;
  if (mine?.alive && priv) {
    const kinds = priv.kinds;
    if (m.phase === 'night' && kinds.length > 0 && !priv.move) {
      aim = { kind: mode && kinds.includes(mode) ? mode : kinds[0] };
    } else if (m.phase === 'vote') {
      aim = { kind: 'vote' };
    } else if (m.phase === 'day' && priv.role === 'sniper' && priv.shotLeft) {
      aim = { kind: 'snipe' };
    }
  }
  const targets = aim ? targetsFor(m, myId, aim, priv) : [];
  const mySeatId = room.seats.find((x) => x.playerId === myId || room.owners?.[x.playerId] === myId)?.playerId ?? myId;
  const toggleMusic = () => { setMusicOn((v) => { saveMusicOn(!v); return !v; }); };

  return (
    <div
      className="mfGame"
      data-phase={m.phase}
      style={{ '--mf-night': `url("${MAF_ART.night}")` } as CSSProperties}
    >
      <header className="mfGame__top">
        <button type="button" className="btn btn--ghost btn--sm" onClick={leave}>{t.common.leave}</button>
        <span className="overline mfGame__title">{M.name}</span>
        <div className="spacer" />
        <button type="button" className="btn btn--ghost btn--sm" onClick={toggleMusic} aria-pressed={musicOn} disabled={!soundOn}>
          {M.table.music}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={toggleSound} aria-pressed={soundOn}>
          {soundOn ? t.game.soundOn : t.game.soundOff}
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
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setHelpOpen(true)} aria-label={t.game.howToPlay}>
          <span className="mfGame__helpLabel">{t.game.howToPlay}</span>
          <kbd className="kbd">?</kbd>
        </button>
      </header>

      {netError && <div className="banner banner--bad" role="alert">{netError}</div>}

      <div className="mfGame__layout">
        <main className="mfGame__stage">
          <motion.section
            key={phaseKey}
            className="mfPhase"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <img className="mfPhase__emblem" src={night ? MAF_ART.moon : MAF_ART.sun} alt="" width={64} height={64} />
            <div className="mfPhase__text">
              <h1 className="mfPhase__title">{phaseTitle}</h1>
              <p className="mfPhase__meta">
                <span className="num">{M.table.alive(aliveCount, m.seats.length)}</span>
                {m.aliveCounts && (
                  <span className="num">{M.table.counts(m.aliveCounts.village, m.aliveCounts.mafia, m.aliveCounts.jester)}</span>
                )}
              </p>
            </div>
            <div className="spacer" />
            {left != null && m.phase !== 'game_over' && (
              <span className="mfPhase__clock num" data-low={left <= 10 || undefined}>{t.common.seconds(left)}</span>
            )}
            {isHost && m.phase !== 'game_over' && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={skip}>{M.table.skip}</button>
            )}
          </motion.section>

          <div className="mfGame__layoutSwitch" role="group" aria-label={M.table.layout.label}>
            {(['grid', 'round'] as const).map((v) => (
              <button key={v} type="button" className="chip" data-on={layout === v || undefined}
                aria-pressed={layout === v} onClick={() => changeLayout(v)}>
                {M.table.layout[v]}
              </button>
            ))}
          </div>

          <Town
            m={m}
            myId={myId}
            priv={priv}
            layout={layout}
            targets={targets}
            picked={picked}
            onPick={aim ? setPicked : undefined}
            canKickSeat={(id) => canKick(room, mySeatId, room.seats.find((x) => x.playerId === id))}
            onKick={removeSeat}
            connected={(id) => room.seats.find((x) => x.playerId === id)?.connected !== false}
          />

          {!mine ? (
            <TakeSeatPanel />
          ) : (
            <ActionPanel
              m={m}
              myId={myId}
              priv={priv}
              aim={aim}
              picked={picked}
              setPicked={setPicked}
              setMode={setMode}
              dispatch={dispatch}
              name={name}
            />
          )}
        </main>

        <aside className="mfGame__side" data-open={sheet === 'log' || undefined}>
          <SeatRequestsDock />
          <CoownerDock />
          {priv && mine && <RoleNote m={m} priv={priv} name={name} />}
          <MafiaFeed m={m} myId={myId} priv={priv} chat={chat} lines={lines} onSend={sendChat} />
        </aside>
      </div>

      <nav className="mfGame__tabbar" aria-label={t.game.panelsAria}>
        <button type="button" className="tabbar__item" data-on={sheet !== 'log' || undefined} onClick={() => openSheet('none')}>
          {M.table.tabs.stage}
        </button>
        <button type="button" className="tabbar__item" data-on={sheet === 'log' || undefined}
          onClick={() => openSheet(sheet === 'log' ? 'none' : 'log')}>
          {M.table.tabs.chat}
        </button>
      </nav>

      <AnimatePresence>
        {revealing && priv && (
          <RoleReveal
            key="reveal"
            role={priv.role}
            teammates={priv.teammates.filter((x) => x.id !== myId)}
            name={(id) => name(id)}
            onClose={() => setRevealing(false)}
          />
        )}
        {!revealing && elim && <ElimScreen key={`elim-${elim.id}`} m={m} death={elim} onClose={nextElim} />}
      </AnimatePresence>
      {m.phase === 'game_over' && !elim && (
        <MafiaGameOver
          m={m}
          myId={myId}
          onLeave={leaveAfterBreak}
          onRematch={role !== 'guest' ? useStore.getState().rematch : undefined}
        />
      )}
      <MafiaHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <FxLayer request={fx} />
    </div>
  );
}

/* ------------------------------ what to do ------------------------------ */

function ActionPanel({
  m, myId, priv, aim, picked, setPicked, setMode, dispatch, name,
}: {
  m: MafiaState;
  myId: string;
  priv: MafiaPrivate | null;
  aim: Aim | null;
  picked: string | null;
  setPicked: (id: string | null) => void;
  setMode: (v: NightKind) => void;
  dispatch: Dispatch;
  name: (id: string | null | undefined) => string;
}) {
  const t = useT();
  const M = t.maf;
  const me = m.players[myId];
  const waiting = waitingOn(m).length;

  if (m.phase === 'game_over') return null;

  if (!me.alive) {
    return (
      <section className="mfAct">
        <p className="mfAct__lead">{M.table.deadNote}</p>
      </section>
    );
  }

  if (!priv) return <section className="mfAct"><div className="spinner" aria-hidden /></section>;

  if (m.phase === 'night') {
    const kinds = priv.kinds;
    const family = isFamily(priv.role);
    const crew = priv.teammates.filter((x) => x.id !== myId);
    const act = () => {
      if (!aim || aim.kind === 'vote' || aim.kind === 'snipe' || !picked) return;
      dispatch({ type: 'NIGHT_MOVE', playerId: myId, kind: aim.kind, target: picked });
      setPicked(null);
    };
    return (
      <section className="mfAct mfAct--night" data-team={ROLE_TEAM[priv.role]}>
        <div className="mfAct__head">
          <img src={mafRoleCard(priv.role)} alt="" width={48} height={45} />
          <div>
            <p className="mfAct__role">{M.roles[priv.role].name}</p>
            <p className="mfAct__lead">{kinds.length === 0 ? M.night.asleep : M.night.lead}</p>
          </div>
        </div>

        {family && crew.length > 0 && (
          <p className="mfAct__family">
            {M.night.crew}: {crew.map((x) => `${name(x.id)} (${M.roles[x.role].name})`).join(', ')}
          </p>
        )}
        {family && kinds.includes('kill') && (
          <p className="mfAct__family">{priv.boss === myId ? M.night.youAreBoss : M.night.boss(name(priv.boss))}</p>
        )}

        {aim && aim.kind !== 'vote' && aim.kind !== 'snipe' ? (
          <>
            {kinds.length > 1 && (
              <div className="mfModes" role="group">
                {kinds.map((k) => (
                  <button key={k} type="button" className="mfMode" data-kind={k} data-on={aim.kind === k || undefined}
                    aria-pressed={aim.kind === k} onClick={() => setMode(k)}>
                    {M.night.modes[k]}
                  </button>
                ))}
              </div>
            )}
            {aim.kind === 'investigate' && <p className="muted small">{M.night.investigateNote}</p>}
            {aim.kind === 'shoot' && <p className="muted small">{M.night.shootNote}</p>}
            <p className="mfAct__title">{M.night.choose[aim.kind]}</p>
            <p className="muted small">
              {picked ? M.table.youChose(name(picked)) : M.table.pick}
              {priv.noProtect && aim.kind === 'protect' && <> {M.night.noRepeat} ({name(priv.noProtect)})</>}
            </p>
            <button type="button" className="btn btn--primary" data-kind={aim.kind} disabled={!picked} onClick={act}>
              {M.night.confirm[aim.kind]}
            </button>
          </>
        ) : priv.move ? (
          <>
            <p className="mfAct__title">{M.night.submitted}</p>
            <p className="muted small">{M.table.youChose(name(priv.move.target))}</p>
          </>
        ) : null}
      </section>
    );
  }

  if (m.phase === 'day') {
    const snipe = () => {
      if (!picked) return;
      dispatch({ type: 'SNIPE', playerId: myId, target: picked });
      setPicked(null);
    };
    return (
      <section className="mfAct mfAct--day">
        <div className="mfNews">
          <p className="overline">{M.dawn.title}</p>
          {m.lastDeaths.length === 0 && m.lastSaved.length === 0 && <p>{M.dawn.quiet}</p>}
          {m.lastDeaths.map((d) => <p key={d.id} className="mfNews__death">{deathLine(m, d, t)}</p>)}
          {m.lastSaved.map((id) => <p key={id} className="mfNews__saved">{M.dawn.saved(name(id))}</p>)}
          {m.silencedToday.map((id) => <p key={id} className="mfAct__bad">{M.day.silenced(name(id))}</p>)}
        </div>
        <p className="mfAct__lead">{M.day.lead}</p>
        {m.silencedToday.includes(myId) && <p className="mfAct__bad">{M.day.silencedYou}</p>}
        {priv.role === 'sniper' && (
          <div className="mfSnipe">
            <p className="mfAct__title">{M.day.snipe.title}</p>
            {priv.shotLeft ? (
              <>
                <p className="muted small">{picked ? M.table.youChose(name(picked)) : M.day.snipe.note}</p>
                <button type="button" className="btn btn--primary" data-kind="shoot" disabled={!picked} onClick={snipe}>
                  {M.day.snipe.confirm}
                </button>
              </>
            ) : (
              <p className="muted small">{M.day.snipe.spent}</p>
            )}
          </div>
        )}
      </section>
    );
  }

  // The vote.
  const myVote = m.votes[myId];
  const vote = (target: string | null) => {
    dispatch({ type: 'VOTE', playerId: myId, target });
    setPicked(null);
  };
  return (
    <section className="mfAct mfAct--vote">
      <p className="mfAct__lead">{M.vote.lead}</p>
      {myVote && <p className="mfAct__title">{M.vote.youVoted(name(myVote))}</p>}
      <p className="muted small">{picked ? M.table.youChose(name(picked)) : M.table.pick}</p>
      <div className="mfAct__row">
        <button type="button" className="btn btn--primary" disabled={!picked || picked === myVote} onClick={() => vote(picked)}>
          {myVote ? M.vote.change : M.table.confirm}
        </button>
        {myVote && <button type="button" className="btn btn--ghost" onClick={() => vote(null)}>{M.vote.retract}</button>}
      </div>
      <p className="mfAct__wait">{M.vote.waiting(waiting)}</p>
    </section>
  );
}

/** The side panel's reminder of who you are, and what you have learned. */
function RoleNote({ m, priv, name }: { m: MafiaState; priv: MafiaPrivate; name: (id: string) => string }) {
  const t = useT();
  const M = t.maf;
  return (
    <section className="mfNote" data-team={ROLE_TEAM[priv.role]}>
      <img src={mafRoleCard(priv.role)} alt="" width={64} height={60} />
      <div className="mfNote__body">
        <p className="overline">{M.reveal.yourRole}</p>
        <p className="mfNote__name">{M.roles[priv.role].name}</p>
        <p className="muted small">{M.roles[priv.role].brief}</p>
        {priv.teammates.length > 1 && (
          <p className="small mfNote__family">
            {M.reveal.teammatesTitle}: {priv.teammates.map((x) => name(x.id)).join(', ')}
          </p>
        )}
        {priv.role === 'detective' && priv.checks.length > 0 && (
          <>
            <p className="overline mfNote__sub">{M.table.checksTitle}</p>
            <ul className="mfNote__checks">
              {priv.checks.map((c) => (
                <li key={`${c.round}:${c.target}`} data-guilty={c.guilty || undefined}>
                  <span className="num">{M.night.title(c.round)}</span>{' · '}
                  {M.result.checked(name(c.target), M.roles[c.seen].name, c.guilty ? M.result.guilty : M.result.innocent)}
                </li>
              ))}
            </ul>
          </>
        )}
        {m.phase !== 'game_over' && priv.role === 'sniper' && (
          <p className="muted small">{priv.shotLeft ? M.day.snipe.title : M.day.snipe.spent}</p>
        )}
      </div>
    </section>
  );
}
