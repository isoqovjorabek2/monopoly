import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import '../../styles/mafia.css';
import { MAF_ART, mafRoleArt } from '../../art/art';
import { useT } from '../../i18n';
import { ROLE_TEAM } from '../../mafia/data';
import { mafDescribe } from '../../mafia/describe';
import { clockKey, clockSeconds, waitingOn } from '../../mafia/rules';
import type {
  MafiaAction, MafiaPrivate, MafiaRole, MafiaState, NightDuty,
} from '../../mafia/types';
import { canKick } from '../../net/moderation';
import { mutedAtTable, useStore } from '../../store/store';
import { CoownerDock, SeatRequestsDock, TakeSeatPanel } from '../Account';
import { useBreakBefore } from '../Ads';
import { useAlertsSwitch, useTableAlert } from '../alerts';
import { Avatar, Modal, useCountdown } from '../bits';
import { FxLayer, useFx } from '../Fx';
import { useGameKeys } from '../Help';
import { LangSwitch } from '../LangSwitch';
import { FeedView, type FeedLine } from '../Panels';
import { useWakeLock } from '../wakeLock';

type Dispatch = (a: MafiaAction) => void;

/** The action each night duty is played with. */
const DUTY_ACTION: Record<NightDuty, MafiaAction['type']> = {
  kill: 'NIGHT_KILL',
  silence: 'NIGHT_SILENCE',
  save: 'NIGHT_SAVE',
  check: 'NIGHT_CHECK',
  guard: 'NIGHT_GUARD',
  shoot: 'NIGHT_SHOOT',
};

/** Who a duty may be aimed at, mirroring rules.isLegal from what this seat
 *  can see: the family never marks its own, and only the doctor may choose
 *  themselves. */
function validTargets(m: MafiaState, me: string, duty: NightDuty | 'vote', priv: MafiaPrivate | null): string[] {
  const family = new Set((priv?.teammates ?? []).map((x) => x.id));
  return m.seats.filter((id) => {
    const p = m.players[id];
    if (!p?.alive) return false;
    if (duty === 'save') return true;
    if (id === me) return false;
    if (duty === 'kill') return !family.has(id);
    return true;
  });
}

/**
 * The Omertà table: the town as a ring of chairs, the night or the day
 * across the middle, and the log and chat to the side. Everything a
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
  const openVote = useStore((s) => s.mafOpenVote);
  const removeSeat = useStore((s) => s.removeSeat);
  const leave = useStore((s) => s.leave);
  const leaveAfterBreak = useBreakBefore(leave);

  useWakeLock(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const noFocusMode = useCallback(() => {}, []);
  useGameKeys(useCallback(() => setHelpOpen((v) => !v), []), noFocusMode);

  const m = room?.mf ?? null;
  const myId = me.playerId;
  const mine = m?.players[myId] ?? null;
  const isHost = Boolean(room && room.hostId === myId);

  /* One choice in hand at a time; a new phase or round starts it afresh. */
  const [picked, setPicked] = useState<string | null>(null);
  const stage = m ? `${m.phase}:${m.round}:${priv?.pending.join(',') ?? ''}` : '';
  useEffect(() => { setPicked(null); }, [stage]);

  const left = useCountdown(m ? clockSeconds(m) : 0, m ? clockKey(m) : '');

  /* The tab title flashes when the table is waiting on this player. */
  const alerts = useAlertsSwitch();
  const need = useMemo(() => {
    if (!m || !mine?.alive) return null;
    const mineToDo = (m.phase === 'reveal' && !m.acks.includes(myId))
      || (m.phase === 'night' && (priv?.pending.length ?? 0) > 0)
      || (m.phase === 'vote' && !m.silencedToday.includes(myId) && !(myId in m.votes));
    return mineToDo ? { key: `maf|${m.phase}|${m.round}`, message: t.table.alerts.needed } : null;
  }, [m, mine, myId, priv, t]);
  useTableAlert(need, alerts.on);

  /* Effects, only for this seat. */
  const [fx, fire] = useFx();
  const fired = useRef({ dead: false, over: false });
  const iWon = m?.phase === 'game_over' && myTeamWon(m, myId);
  useEffect(() => {
    if (mine && !mine.alive && !fired.current.dead) { fired.current.dead = true; fire('ash'); }
    if (iWon && !fired.current.over) { fired.current.over = true; fire('victory'); }
  }, [mine, iWon, fire]);

  const lines: FeedLine[] = useMemo(() => (m
    ? mafLog.map((l) => ({
      id: l.id,
      tone: l.tone,
      color: l.actor ? m.players[l.actor]?.color : undefined,
      text: mafDescribe(m, l.event, t),
    })).filter((l) => l.text)
    : []), [mafLog, m, t]);

  if (!room || !m) return null;

  const night = m.phase === 'night' || m.phase === 'reveal';
  const aliveCount = m.seats.filter((id) => m.players[id].alive).length;
  const phaseTitle = m.phase === 'reveal' ? M.reveal.title
    : m.phase === 'night' ? M.night.title(m.round)
      : m.phase === 'day' ? M.day.title(m.round)
        : m.phase === 'vote' ? M.vote.title
          : M.over.title;

  // What a tap on a chair means right now.
  const duty: NightDuty | 'vote' | null = !mine?.alive ? null
    : m.phase === 'night' ? (priv?.pending[0] ?? null)
      : m.phase === 'vote' && !m.silencedToday.includes(myId) ? 'vote'
        : null;
  const targets = duty ? validTargets(m, myId, duty, priv) : [];
  const muted = mutedAtTable(room, myId);
  const mySeatId = room.seats.find((x) => x.playerId === myId || room.owners?.[x.playerId] === myId)?.playerId ?? myId;

  return (
    <div
      className="mfGame"
      data-night={night || undefined}
      style={{ '--mf-night': `url("${MAF_ART.night}")` } as CSSProperties}
    >
      <header className="mfGame__top">
        <button type="button" className="btn btn--ghost btn--sm" onClick={leave}>{t.common.leave}</button>
        <span className="overline mfGame__title">{M.name}</span>
        <div className="spacer" />
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
        <main className="mfGame__stage" data-open={sheet !== 'log' || undefined}>
          <motion.section
            key={`${m.phase}:${m.round}`}
            className="mfPhase"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <img className="mfPhase__emblem" src={night ? MAF_ART.moon : MAF_ART.sun} alt="" width={72} height={72} />
            <div className="mfPhase__text">
              <h1 className="mfPhase__title">{phaseTitle}</h1>
              <p className="mfPhase__meta">
                <span className="num">{M.table.alive(aliveCount, m.seats.length)}</span>
                {left != null && m.phase !== 'game_over' && (
                  <span className="mfPhase__clock num" data-low={left <= 10 || undefined}>{t.common.seconds(left)}</span>
                )}
              </p>
            </div>
          </motion.section>

          <Town
            m={m}
            myId={myId}
            priv={priv}
            targets={targets}
            picked={picked}
            onPick={duty ? setPicked : undefined}
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
              duty={duty}
              picked={picked}
              setPicked={setPicked}
              dispatch={dispatch}
              isHost={isHost}
              onOpenVote={openVote}
            />
          )}
        </main>

        <aside className="mfGame__side" data-open={sheet === 'log' || undefined}>
          <SeatRequestsDock />
          <CoownerDock />
          {priv && mine && <RoleNote m={m} priv={priv} />}
          {muted && <p className="muted small mfMuted">{M.table.deadChat}</p>}
          <FeedView lines={lines} chat={chat} onSend={sendChat} />
        </aside>
      </div>

      <nav className="mfGame__tabbar" aria-label={t.game.panelsAria}>
        <button type="button" className="tabbar__item" data-on={sheet !== 'log' || undefined} onClick={() => openSheet('none')}>
          {M.table.tabs.stage}
        </button>
        <button type="button" className="tabbar__item" data-on={sheet === 'log' || undefined}
          onClick={() => openSheet(sheet === 'log' ? 'none' : 'log')}>
          {M.table.tabs.log}
        </button>
      </nav>

      {m.phase === 'game_over' && (
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

/* ------------------------------- the town ------------------------------- */

function Town({
  m, myId, priv, targets, picked, onPick, canKickSeat, onKick, connected,
}: {
  m: MafiaState;
  myId: string;
  priv: MafiaPrivate | null;
  targets: string[];
  picked: string | null;
  onPick?: (id: string) => void;
  canKickSeat: (id: string) => boolean;
  onKick: (id: string) => void;
  connected: (id: string) => boolean;
}) {
  const t = useT();
  const M = t.maf;
  const family = new Map((priv?.teammates ?? []).map((x) => [x.id, x.role]));
  const tally = new Map<string, number>();
  if (m.phase === 'vote') {
    for (const target of Object.values(m.votes)) if (target) tally.set(target, (tally.get(target) ?? 0) + 1);
  }
  const marked = priv?.nightKill?.target ?? null;
  const [kickArmed, setKickArmed] = useState<string | null>(null);

  return (
    <ul className="mfTown" aria-label={M.table.tabs.players}>
      {m.seats.map((id) => {
        const p = m.players[id];
        const you = id === myId;
        // A role this seat may know: its own, its family's, the dead that
        // were shown, and everyone's once the game is over.
        const known: MafiaRole | null = m.finalRoles?.[id]
          ?? m.revealed?.[id]
          ?? (you ? priv?.role ?? null : null)
          ?? family.get(id)
          ?? null;
        const pickable = Boolean(onPick) && targets.includes(id);
        const votes = tally.get(id) ?? 0;
        const votedFor = m.phase === 'vote' && id in m.votes ? m.votes[id] : undefined;
        return (
          <li key={id}>
            <button
              type="button"
              className="mfSeat"
              data-dead={!p.alive || undefined}
              data-you={you || undefined}
              data-family={(family.has(id) && !you) || undefined}
              data-pickable={pickable || undefined}
              data-picked={(pickable && picked === id) || undefined}
              data-marked={(marked === id) || undefined}
              disabled={!pickable}
              aria-pressed={pickable ? picked === id : undefined}
              onClick={() => pickable && onPick?.(id)}
            >
              <span className="mfSeat__face">
                {known && !p.alive
                  ? <img className="mfSeat__role" src={mafRoleArt(known)} alt="" width={40} height={40} />
                  : <Avatar color={p.color} token={p.token} size={36} dim={!p.alive} />}
              </span>
              <span className="mfSeat__name truncate">{p.name}</span>
              <span className="mfSeat__tags">
                {you && <span className="mfTag">{M.table.you}</span>}
                {known && (you || !p.alive || family.has(id) || m.finalRoles) && (
                  <span className="mfTag" data-team={ROLE_TEAM[known]}>{M.roles[known].name}</span>
                )}
                {!p.alive && <span className="mfTag mfTag--dead">{M.table.dead}</span>}
                {m.silencedToday.includes(id) && p.alive && <span className="mfTag mfTag--bad">{M.table.silenced}</span>}
                {!p.isBot && !connected(id) && p.alive && <span className="mfTag">{M.table.away}</span>}
                {votes > 0 && <span className="mfTag mfTag--votes num">{M.table.votes(votes)}</span>}
              </span>
              {votedFor !== undefined && (
                <span className="mfSeat__vote truncate">
                  {votedFor ? `→ ${m.players[votedFor]?.name ?? ''}` : M.vote.abstain}
                </span>
              )}
            </button>
            {canKickSeat(id) && m.phase !== 'game_over' && !you && !p.isBot && (
              <button
                type="button"
                className="mfSeat__kick btn btn--ghost btn--sm"
                title={t.table.mod.kickTitle(p.name)}
                aria-label={t.table.mod.kickTitle(p.name)}
                onClick={() => {
                  // Two taps: removing a player is not something to do by accident.
                  if (kickArmed === id) { setKickArmed(null); onKick(id); } else setKickArmed(id);
                }}
              >
                {kickArmed === id ? t.table.mod.kickSure : '✕'}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------ what to do ------------------------------ */

function ActionPanel({
  m, myId, priv, duty, picked, setPicked, dispatch, isHost, onOpenVote,
}: {
  m: MafiaState;
  myId: string;
  priv: MafiaPrivate | null;
  duty: NightDuty | 'vote' | null;
  picked: string | null;
  setPicked: (id: string | null) => void;
  dispatch: Dispatch;
  isHost: boolean;
  onOpenVote: () => void;
}) {
  const t = useT();
  const M = t.maf;
  const me = m.players[myId];
  const name = (id: string | null | undefined): string => (id ? m.players[id]?.name ?? '' : M.table.nobody);
  const waiting = waitingOn(m).length;

  if (m.phase === 'game_over') return null;

  if (!me.alive) {
    return (
      <section className="mfAct">
        <p className="mfAct__lead">{M.table.deadNote}</p>
      </section>
    );
  }

  if (m.phase === 'reveal') {
    const acked = m.acks.includes(myId);
    return (
      <section className="mfAct mfAct--reveal">
        {priv ? (
          <RoleReveal role={priv.role} teammates={priv.teammates.filter((x) => x.id !== myId)} name={name} />
        ) : (
          <div className="spinner" aria-hidden />
        )}
        <p className="muted small">{M.reveal.lead}</p>
        {acked
          ? <p className="mfAct__wait">{M.reveal.waiting(waiting)}</p>
          : (
            <button type="button" className="btn btn--primary" disabled={!priv}
              onClick={() => dispatch({ type: 'ACK_ROLE', playerId: myId })}>
              {M.reveal.ack}
            </button>
          )}
      </section>
    );
  }

  if (m.phase === 'night') {
    const hasDuty = Boolean(priv && (priv.pending.length > 0 || Object.keys(priv.chosen).length > 0 || priv.nightKill));
    const prompt: Record<NightDuty, string> = {
      kill: M.night.chooseVictim,
      silence: M.night.chooseSilence,
      save: M.night.chooseSave,
      check: M.night.chooseCheck,
      guard: M.night.chooseGuard,
      shoot: M.night.chooseShoot,
    };
    const act = (target: string | null) => {
      if (!duty || duty === 'vote') return;
      dispatch({ type: DUTY_ACTION[duty], playerId: myId, target } as MafiaAction);
      setPicked(null);
    };
    return (
      <section className="mfAct mfAct--night">
        <p className="mfAct__lead">{M.night.lead}</p>
        {priv?.nightKill && (
          <p className="mfAct__family">
            {priv.nightKill.target
              ? M.night.teamChose(name(priv.nightKill.by), name(priv.nightKill.target))
              : M.night.waiting}
          </p>
        )}
        {duty && duty !== 'vote' ? (
          <>
            <p className="mfAct__title">{prompt[duty]}</p>
            <p className="muted small">{picked ? M.table.youChose(name(picked)) : M.table.pick}</p>
            <div className="mfAct__row">
              <button type="button" className="btn btn--primary" disabled={!picked} onClick={() => act(picked)}>
                {M.table.confirm}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => act(null)}>
                {duty === 'shoot' ? M.night.holdFire : M.table.skip}
              </button>
            </div>
          </>
        ) : hasDuty ? (
          <>
            <p className="mfAct__title">{M.night.submitted}</p>
            {Object.entries(priv?.chosen ?? {}).map(([k, v]) => (
              <p key={k} className="muted small">{v ? M.table.youChose(name(v)) : M.table.youSkipped}</p>
            ))}
          </>
        ) : (
          <p className="mfAct__title">{M.night.asleep}</p>
        )}
      </section>
    );
  }

  if (m.phase === 'day') {
    return (
      <section className="mfAct mfAct--day">
        <DawnNews m={m} name={name} />
        <p className="mfAct__lead">{M.day.lead}</p>
        {m.silencedToday.includes(myId) && <p className="mfAct__bad">{M.day.silencedYou}</p>}
        {isHost && (
          <button type="button" className="btn btn--primary" onClick={onOpenVote}>{M.table.openVote}</button>
        )}
      </section>
    );
  }

  // The vote.
  const silenced = m.silencedToday.includes(myId);
  const voted = myId in m.votes;
  const vote = (target: string | null) => {
    dispatch({ type: 'VOTE', playerId: myId, target });
    setPicked(null);
  };
  return (
    <section className="mfAct mfAct--vote">
      <p className="mfAct__lead">{M.vote.lead}</p>
      {silenced ? (
        <p className="mfAct__bad">{M.day.silencedYou}</p>
      ) : (
        <>
          {voted && (
            <p className="mfAct__title">
              {m.votes[myId] ? M.vote.youVoted(name(m.votes[myId])) : M.vote.youAbstained}
            </p>
          )}
          {duty === 'vote' && (
            <>
              <p className="muted small">{picked ? M.table.youChose(name(picked)) : M.table.pick}</p>
              <div className="mfAct__row">
                <button type="button" className="btn btn--primary" disabled={!picked} onClick={() => vote(picked)}>
                  {voted ? M.vote.change : M.table.confirm}
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => vote(null)}>{M.vote.abstain}</button>
              </div>
            </>
          )}
        </>
      )}
      <p className="mfAct__wait">{M.vote.waiting(waiting)}</p>
    </section>
  );
}

/** Who the night took, and who cannot vote today. */
function DawnNews({ m, name }: { m: MafiaState; name: (id: string | null) => string }) {
  const t = useT();
  const M = t.maf;
  return (
    <div className="mfNews">
      <p className="overline">{M.dawn.title}</p>
      {m.lastDeaths.length === 0 ? (
        <p>{M.dawn.quiet}</p>
      ) : m.lastDeaths.map((d) => (
        <p key={d.id}>
          {M.dawn.died(name(d.id))}
          {d.role && <> {M.dawn.roleWas(M.roles[d.role].name)}</>}
        </p>
      ))}
      {m.silencedToday.map((id) => <p key={id} className="mfAct__bad">{M.day.silenced(name(id))}</p>)}
    </div>
  );
}

/* ------------------------------ your role ------------------------------ */

function RoleReveal({
  role, teammates, name,
}: { role: MafiaRole; teammates: { id: string; role: MafiaRole }[]; name: (id: string) => string }) {
  const t = useT();
  const M = t.maf;
  return (
    <motion.div
      className="mfRole"
      data-team={ROLE_TEAM[role]}
      initial={{ rotateY: 90, opacity: 0 }}
      animate={{ rotateY: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
    >
      <img className="mfRole__art" src={mafRoleArt(role)} alt="" width={160} height={160} />
      <p className="overline">{M.reveal.yourRole}</p>
      <h2 className="mfRole__name">{M.roles[role].name}</h2>
      <p className="mfRole__brief">{M.roles[role].brief}</p>
      {teammates.length > 0 && (
        <div className="mfRole__team">
          <p className="overline">{M.reveal.teammatesTitle}</p>
          <ul>
            {teammates.map((x) => <li key={x.id}>{name(x.id)} · {M.roles[x.role].name}</li>)}
          </ul>
        </div>
      )}
    </motion.div>
  );
}

/** The side panel's reminder of who you are, and what you have learned. */
function RoleNote({ m, priv }: { m: MafiaState; priv: MafiaPrivate }) {
  const t = useT();
  const M = t.maf;
  const name = (id: string): string => m.players[id]?.name ?? '';
  return (
    <section className="mfNote" data-team={ROLE_TEAM[priv.role]}>
      <img src={mafRoleArt(priv.role)} alt="" width={56} height={56} />
      <div className="mfNote__body">
        <p className="overline">{M.reveal.yourRole}</p>
        <p className="mfNote__name">{M.roles[priv.role].name}</p>
        {priv.role === 'sniper' && (
          <p className="muted small">{priv.sniperShotsLeft > 0 ? M.table.bulletLeft : M.table.bulletSpent}</p>
        )}
        {priv.teammates.length > 1 && (
          <p className="muted small">
            {M.reveal.teammatesTitle}: {priv.teammates.map((x) => name(x.id)).join(', ')}
          </p>
        )}
        {priv.role === 'detective' && priv.checks.length > 0 && (
          <>
            <p className="overline mfNote__sub">{M.table.checksTitle}</p>
            <ul className="mfNote__checks">
              {priv.checks.map((c) => (
                <li key={`${c.round}:${c.target}`} data-guilty={c.guilty || undefined}>
                  <span className="num">{M.night.title(c.round)}</span>{' '}
                  {M.result.checked(name(c.target), c.guilty ? M.result.guilty : M.result.innocent)}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

/* ------------------------------- the end ------------------------------- */

function myTeamWon(m: MafiaState, myId: string): boolean {
  const role = m.finalRoles?.[myId];
  if (!role || !m.winner) return false;
  if (m.winner === 'jester') return m.winnerId === myId;
  return ROLE_TEAM[role] === m.winner;
}

function MafiaGameOver({
  m, myId, onLeave, onRematch,
}: { m: MafiaState; myId: string; onLeave: () => void; onRematch?: () => void }) {
  const t = useT();
  const M = t.maf;
  const name = (id: string | null): string => (id && m.players[id]?.name) || t.defaults.someone;
  const headline = m.winner === 'mafia' ? M.over.mafiaWins
    : m.winner === 'village' ? M.over.villageWins
      : m.winner === 'jester' ? M.over.jesterWins(name(m.winnerId))
        : M.over.abandoned;
  const seated = Boolean(m.players[myId]);
  const verdict = !seated || !m.finalRoles ? M.end.spectated : myTeamWon(m, myId) ? M.end.youWon : M.end.youLost;

  return (
    <Modal open onClose={() => {}} title={M.over.title} dismissable={false}>
      <div className="mfOver">
        <motion.p
          className="mfOver__headline"
          data-winner={m.winner ?? undefined}
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 240, damping: 18 }}
        >
          {headline}
        </motion.p>
        <p className="muted">{verdict}</p>
        {m.finalRoles && (
          <>
            <p className="overline">{M.end.rolesTitle}</p>
            <ul className="mfOver__roles">
              {m.seats.map((id) => {
                const r = m.finalRoles![id];
                return (
                  <li key={id} data-team={ROLE_TEAM[r]} data-dead={!m.players[id].alive || undefined}>
                    <img src={mafRoleArt(r)} alt="" width={36} height={36} />
                    <span className="truncate">{m.players[id].name}{id === myId && ` ${M.table.self}`}</span>
                    <span className="spacer" />
                    <span className="mfOver__role">{M.roles[r].name}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {onRematch ? (
          <button type="button" className="btn btn--primary btn--block" onClick={onRematch}>{t.table.rematch.again}</button>
        ) : (
          <p className="muted small">{t.table.rematch.waiting}</p>
        )}
        <button type="button" className={`btn btn--block ${onRematch ? 'btn--ghost' : 'btn--primary'}`} onClick={onLeave}>
          {t.gameOver.home}
        </button>
      </div>
    </Modal>
  );
}

function MafiaHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const H = t.maf.help;
  return (
    <Modal open={open} onClose={onClose} title={H.title}>
      <ul className="mfHelp">
        {H.lines.map((l) => <li key={l}>{l}</li>)}
      </ul>
    </Modal>
  );
}
