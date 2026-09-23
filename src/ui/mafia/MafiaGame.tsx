import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Home, MessageCircle, SkipForward, Volume2, VolumeX } from 'lucide-react';
import './omerta.css';
import { useT } from '../../i18n';
import type { Dict } from '../../i18n/en';
import type { MFLogLine } from '../../mafia/describe';
import { clockKey, clockSeconds } from '../../mafia/rules';
import type { MafiaAction, MafiaDeath, MafiaState } from '../../mafia/types';
import type { ChatMessage } from '../../net/protocol';
import { useStore } from '../../store/store';
import { TakeSeatPanel } from '../Account';
import { useBreakBefore } from '../Ads';
import { useAlertsSwitch, useTableAlert } from '../alerts';
import { useCountdown } from '../bits';
import { useWakeLock } from '../wakeLock';
import { isAudioEnabled, onAudioChange, playAmbient, playSFX, setAudioEnabled, stopAmbient, TRACKS } from './audio';
import { ChatPanel, type ChatItem } from './ChatPanel';
import { PhaseTimer, SurvivorCounter } from './Hud';
import { roleDef, teammateNames, viewPlayers } from './model';
import { Deck } from './deck/Deck';
import { ElimScreen, GameOverScreen, RoleReveal } from './Overlays';

type Dispatch = (a: MafiaAction) => void;

const PHASE_BG: Record<string, string> = {
  night: 'radial-gradient(ellipse at center, rgba(60,20,90,0.25) 0%, rgba(10,10,15,0.97) 60%), radial-gradient(ellipse at bottom, rgba(192,57,43,0.08) 0%, transparent 50%)',
  day: 'radial-gradient(ellipse at top, rgba(180,100,10,0.15) 0%, rgba(10,10,15,0.97) 60%)',
  vote: 'radial-gradient(ellipse at center, rgba(192,57,43,0.15) 0%, rgba(10,10,15,0.97) 60%)',
  game_over: 'radial-gradient(ellipse at center, rgba(192,57,43,0.2) 0%, rgba(0,0,0,0.99) 60%)',
};

const mono = "'JetBrains Mono', monospace";
const cinzel = "'Cinzel', serif";

/** The table's news as the app's narrator tells it, one pill per line. */
function narration(m: MafiaState, line: MFLogLine, t: Dict): { avatar: string; content: string }[] {
  const M = t.maf;
  const name = (id: string | null | undefined): string => (id && m.players[id]?.name) || t.defaults.someone;
  const shown = (role: MafiaDeath['role']) => (role ? ` ${M.dawn.roleWas(M.roles[role].name)}` : '');
  const e = line.event;
  switch (e.type) {
    case 'DAWN': {
      const out: { avatar: string; content: string }[] = [];
      for (const d of e.deaths) {
        if (d.cause === 'bodyguard') out.push({ avatar: '🛡️', content: M.dawn.guarded(name(d.id), name(d.saved)) + shown(d.role) });
        else if (d.cause === 'detective') out.push({ avatar: '🔍', content: M.dawn.shot(name(d.id)) + shown(d.role) });
        else out.push({ avatar: '🔪', content: M.dawn.died(name(d.id)) + shown(d.role) });
      }
      for (const id of e.saved) out.push({ avatar: '💊', content: M.dawn.saved(name(id)) });
      for (const id of e.silenced) out.push({ avatar: '🤫', content: M.day.silenced(name(id)) });
      return out.length > 0 ? out : [{ avatar: '🌙', content: M.dawn.quiet }];
    }
    case 'LYNCHED':
      return [{ avatar: '⚖️', content: M.vote.lynched(name(e.playerId)) + shown(e.role) }];
    case 'NO_LYNCH':
      return [{ avatar: '⚖️', content: e.tie ? M.vote.tie : M.vote.noVotes }];
    case 'SNIPED':
      return [{ avatar: '🎯', content: `💥 ${M.dawn.sniped(name(e.playerId))}${shown(e.role)}` }];
    case 'SEAT_TAKEN':
      return [{ avatar: '🎭', content: t.account.log.seatTaken(e.name, e.previous) }];
    default:
      return [];
  }
}

/**
 * The Omertà table, as the Mafia app lays it out: the phase and the clock
 * across the top, the town and what to do in the middle, the chat down
 * the side (a drawer on a phone). Everything a player may know comes from
 * the public state plus their own private slice.
 */
export default function MafiaGame() {
  const t = useT();
  const U = t.maf.ui;
  const room = useStore((s) => s.room);
  const me = useStore((s) => s.me);
  const role = useStore((s) => s.role);
  const priv = useStore((s) => s.mafPrivate);
  const mafLog = useStore((s) => s.mafLog);
  const chat = useStore((s) => s.chat);
  const netError = useStore((s) => s.netError);
  const dispatch = useStore((s) => s.dispatch) as Dispatch;
  const sendChat = useStore((s) => s.sendChat);
  const skip = useStore((s) => s.mafSkip);
  const leave = useStore((s) => s.leave);
  const leaveAfterBreak = useBreakBefore(leave);

  useWakeLock(true);

  const m = room?.mf ?? null;
  const myId = me.playerId;
  const mine = m?.players[myId] ?? null;
  const isHost = Boolean(room && room.hostId === myId);
  const phase = m?.phase ?? 'night';

  const [audioOn, setAudioOn] = useState(isAudioEnabled);
  useEffect(() => onAudioChange(setAudioOn), []);
  const [showMobileChat, setShowMobileChat] = useState(false);
  const left = useCountdown(m ? clockSeconds(m) : 0, m ? clockKey(m) : '');

  /* Stars for the night sky, placed once. */
  const [stars] = useState(() => Array.from({ length: 35 }, () => ({
    left: Math.random() * 100, top: Math.random() * 65, large: Math.random() > 0.8,
    opacityMax: Math.random() * 0.7 + 0.3, duration: Math.random() * 3 + 1.5, delay: Math.random() * 4,
  })));

  /* The score follows the phase; a chime marks each change. */
  useEffect(() => {
    const track = phase === 'night' ? TRACKS.night : phase === 'day' ? TRACKS.day : phase === 'vote' ? TRACKS.voting : null;
    if (audioOn && track) playAmbient(track); else stopAmbient();
  }, [phase, audioOn]);
  const prevPhase = useRef<string | null>(null);
  useEffect(() => {
    if (prevPhase.current !== null && prevPhase.current !== phase) playSFX(TRACKS.notif, 0.4);
    prevPhase.current = phase;
  }, [phase]);
  useEffect(() => () => stopAmbient(), []);

  /* The card is dealt once per game, when the role arrives. */
  const [revealing, setRevealing] = useState(false);
  const hadRole = useRef(false);
  useEffect(() => {
    if (priv && !hadRole.current && m?.round === 1 && m.phase === 'night') setRevealing(true);
    hadRole.current = Boolean(priv);
  }, [priv, m?.round, m?.phase]);

  /* A death takes the whole screen for a moment, one at a time. */
  const [elims, setElims] = useState<MafiaDeath[]>([]);
  const aliveBefore = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!m) return;
    const alive = new Set(m.seats.filter((id) => m.players[id].alive));
    const before = aliveBefore.current;
    aliveBefore.current = alive;
    if (!before) return;
    const fresh = m.lastDeaths.filter((d) => before.has(d.id) && !alive.has(d.id));
    if (fresh.length > 0) setElims((q) => [...q, ...fresh]);
  }, [m]);
  const elim = elims[0] ?? null;
  const nextElim = useCallback(() => setElims((q) => q.slice(1)), []);

  /* This seat's private notes: investigation results, a gag. */
  const [notes, setNotes] = useState<ChatItem[]>([]);
  const [nightResult, setNightResult] = useState<string | null>(null);
  const seenChecks = useRef(0);
  const checks = priv?.checks;
  useEffect(() => {
    const list = checks ?? [];
    if (list.length <= seenChecks.current) { seenChecks.current = list.length; return; }
    const fresh = list.slice(seenChecks.current);
    seenChecks.current = list.length;
    for (const c of fresh) {
      const who = useStore.getState().room?.mf?.players[c.target]?.name ?? '';
      const text = U.result.investigated(who, t.maf.roles[c.seen].name, c.guilty ? U.faction.mafia : U.faction.town);
      setNightResult(text);
      setNotes((n) => [...n, { id: `chk-${c.round}-${c.target}`, at: Date.now(), type: 'system', isWhisper: true, playerId: '', username: '', avatar: '🔍', content: text }]);
    }
  }, [checks, t, U]);
  useEffect(() => {
    if (!nightResult) return;
    const id = setTimeout(() => setNightResult(null), 5000);
    return () => clearTimeout(id);
  }, [nightResult]);
  const gagged = Boolean(m && m.phase === 'day' && m.silencedToday.includes(myId));
  const round = m?.round ?? 0;
  useEffect(() => {
    if (!gagged) return;
    setNotes((n) => [...n, { id: `gag-${round}`, at: Date.now(), type: 'system', isWhisper: true, playerId: '', username: '', avatar: '🤫', content: t.maf.day.silencedYou }]);
  }, [gagged, round, t]);

  /* The tab title flashes when the table is waiting on this player. */
  const alerts = useAlertsSwitch();
  const need = useMemo(() => {
    if (!m || !mine?.alive) return null;
    const mineToDo = (m.phase === 'night' && Boolean(priv) && priv!.kinds.length > 0 && !priv!.move)
      || (m.phase === 'vote' && !(myId in m.votes));
    return mineToDo ? { key: `maf|${m.phase}|${m.round}`, message: t.table.alerts.needed } : null;
  }, [m, mine, myId, priv, t]);
  useTableAlert(need, alerts.on);

  const players = useMemo(() => (m && room ? viewPlayers(m, room, myId, priv) : []), [m, room, myId, priv]);
  const teammates = useMemo(() => (m ? teammateNames(m, priv, myId) : []), [m, priv, myId]);

  const items = useMemo<ChatItem[]>(() => {
    if (!m) return [];
    const said: ChatItem[] = chat.map((c: ChatMessage) => ({
      id: c.id,
      at: c.at,
      type: c.channel === 'family' ? 'mafia' : c.channel === 'last' ? 'last_words' : 'player',
      playerId: c.from,
      username: c.name,
      avatar: c.name,
      content: c.text,
      isWhisper: c.channel === 'whisper',
      whisperTargetName: c.toName,
    }));
    const news: ChatItem[] = mafLog.flatMap((l) => narration(m, l, t).map((n, i) => ({
      id: `log-${l.id}-${i}`, at: l.at, type: 'system' as const, playerId: '', username: '', avatar: n.avatar, content: n.content,
    })));
    return [...said, ...news, ...notes].sort((a, b) => a.at - b.at);
  }, [chat, mafLog, notes, m, t]);

  if (!room || !m) return null;

  const isDead = Boolean(mine && !mine.alive);
  const isFamily = Boolean(priv && priv.teammates.length > 0);
  const myRole = priv ? roleDef(t, priv.role) : null;
  const canSkip = isHost && m.phase !== 'game_over';

  const family = new Set((priv?.teammates ?? []).map((x) => x.id));
  const vote = (target: string | null) => dispatch({ type: 'VOTE', playerId: myId, target });

  const chatPanel = (
    <ChatPanel
      items={items}
      players={players}
      myPlayerId={myId}
      phase={m.phase}
      isDead={isDead}
      lastWordsUsed={m.lastWords.includes(myId)}
      isSilenced={gagged}
      isFamily={isFamily}
      onSend={sendChat}
    />
  );

  const iconBtn = 'tw:w-11 tw:h-11 tw:rounded-lg tw:flex tw:items-center tw:justify-center tw:relative';
  const iconStyle = { background: 'rgba(26,26,46,0.6)', border: '1px solid rgba(255,215,0,0.1)', color: '#e8e8f0' };

  return (
    <div className="om tw:min-h-screen tw:overflow-hidden">
      <motion.div key={m.phase} className="tw:fixed tw:inset-0 tw:pointer-events-none" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ duration: 1.5 }} style={{ background: PHASE_BG[m.phase] ?? PHASE_BG.night }} />
      {m.phase === 'night' && (
        <div className="tw:fixed tw:inset-0 tw:pointer-events-none tw:overflow-hidden">
          {stars.map((s, i) => (
            <motion.div key={i} className="tw:absolute tw:rounded-full"
              style={{ left: `${s.left}%`, top: `${s.top}%`, width: s.large ? 2 : 1, height: s.large ? 2 : 1, background: '#fff' }}
              animate={{ opacity: [0.1, s.opacityMax, 0.1] }} transition={{ duration: s.duration, repeat: Infinity, delay: s.delay }} />
          ))}
        </div>
      )}

      <div className="tw:relative tw:z-10 tw:flex tw:flex-col" style={{ height: '100dvh' }}>
        <div className="tw:flex tw:items-center tw:justify-between tw:gap-2 tw:px-4 tw:py-3 tw:border-b tw:flex-shrink-0"
          style={{
            background: 'rgba(10,10,15,0.85)', backdropFilter: 'blur(20px)', borderColor: 'rgba(255,215,0,0.07)',
            // Clear the notch and the rounded corners on a phone.
            paddingTop: 'calc(0.75rem + env(safe-area-inset-top))',
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
          }}>
          <PhaseTimer phase={m.phase} timeLeft={left} round={m.round} />
          <SurvivorCounter m={m} />
          <div className="tw:flex tw:items-center tw:gap-2">
            {myRole && !isDead && (
              <div className="tw:hidden tw:sm:flex tw:items-center tw:gap-2 tw:px-3 tw:py-1.5 tw:rounded-lg tw:text-xs"
                style={{ background: `${myRole.color}15`, border: `1px solid ${myRole.color}33` }}>
                <span>{myRole.icon}</span>
                <span style={{ color: myRole.color, fontFamily: cinzel }}>{myRole.name}</span>
              </div>
            )}
            {isDead && (
              <div className="tw:px-3 tw:py-1.5 tw:rounded-lg tw:text-xs tw:text-[#e74c3c]"
                style={{ background: 'rgba(192,57,43,0.15)', border: '1px solid rgba(192,57,43,0.3)' }}>💀 {U.dead}</div>
            )}
            {!mine && (
              <div className="tw:px-3 tw:py-1.5 tw:rounded-lg tw:text-xs tw:text-[#8e44ad]"
                style={{ background: 'rgba(142,68,173,0.15)', border: '1px solid rgba(142,68,173,0.3)' }}>👁️ {U.spectating}</div>
            )}
            <motion.button type="button" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => setShowMobileChat((v) => !v)}
              className={`tw:md:hidden ${iconBtn}`} aria-label={U.chatToggle}
              style={{ ...iconStyle, background: showMobileChat ? 'rgba(192,57,43,0.3)' : iconStyle.background }}>
              <MessageCircle size={16} />
              {items.length > 0 && !showMobileChat && (
                <span className="tw:absolute tw:-top-1 tw:-right-1 tw:w-4 tw:h-4 tw:rounded-full tw:bg-[#e74c3c] tw:text-white tw:flex tw:items-center tw:justify-center"
                  style={{ fontSize: 9, fontFamily: mono }}>
                  {Math.min(items.length, 9)}
                </span>
              )}
            </motion.button>
            {canSkip && (
              <motion.button type="button" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={skip}
                title={U.skip} aria-label={U.skip} className={iconBtn}
                style={{ background: 'rgba(243,156,18,0.15)', border: '1px solid rgba(243,156,18,0.4)' }}>
                <SkipForward size={16} className="tw:text-[#f39c12]" />
              </motion.button>
            )}
            <motion.button type="button" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => setAudioEnabled(!audioOn)}
              aria-label={U.music} aria-pressed={audioOn} className={iconBtn} style={iconStyle}>
              {audioOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </motion.button>
            <motion.button type="button" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={leave}
              aria-label={U.home} title={U.home} className={iconBtn} style={iconStyle}>
              <Home size={16} />
            </motion.button>
          </div>
        </div>

        <div className="tw:sm:hidden tw:flex tw:items-center tw:justify-between tw:px-4 tw:py-1.5 tw:border-b tw:flex-shrink-0"
          style={{ background: 'rgba(10,10,15,0.75)', borderColor: 'rgba(255,215,0,0.05)' }}>
          {myRole && !isDead ? (
            <div className="tw:flex tw:items-center tw:gap-1.5 tw:px-2 tw:py-1 tw:rounded-lg tw:text-xs"
              style={{ background: `${myRole.color}15`, border: `1px solid ${myRole.color}33` }}>
              <span>{myRole.icon}</span>
              <span style={{ color: myRole.color, fontFamily: cinzel }}>{myRole.name}</span>
            </div>
          ) : <span />}
          <SurvivorCounter m={m} compact />
        </div>

        {netError && (
          <div className="tw:px-4 tw:py-2 tw:text-xs tw:text-center" role="alert"
            style={{ background: 'rgba(192,57,43,0.2)', color: '#f0b8b8', fontFamily: mono }}>
            {netError}
          </div>
        )}

        <div className="tw:flex tw:flex-1 tw:min-h-0 tw:overflow-hidden">
          <div className="tw:flex-1 tw:flex tw:flex-col tw:p-4 tw:gap-4 tw:overflow-y-auto tw:overflow-x-hidden tw:min-w-0">
            <AnimatePresence>
              {nightResult && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                  className="tw:p-3 tw:rounded-lg tw:text-sm tw:text-center"
                  style={{ background: 'rgba(52,152,219,0.15)', border: '1px solid rgba(52,152,219,0.4)', color: '#3498db', fontFamily: mono }}>
                  🔍 {nightResult}
                </motion.div>
              )}
            </AnimatePresence>

            <Deck
              m={m}
              myId={myId}
              priv={priv}
              players={players}
              teammates={teammates}
              left={left}
              total={clockSeconds(m)}
              onNightMove={(k, target) => {
                dispatch({ type: 'NIGHT_MOVE', playerId: myId, kind: k, target });
                if (k === 'shoot') setNightResult(U.result.shot(m.players[target]?.name ?? ''));
              }}
              onSnipe={(target) => {
                dispatch({ type: 'SNIPE', playerId: myId, target });
                setNightResult(U.result.sniped(m.players[target]?.name ?? ''));
              }}
              onVote={vote}
            />

            <AnimatePresence mode="wait">
              {!mine && m.phase !== 'game_over' && (
                <motion.div key="watch" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><TakeSeatPanel /></motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="tw:hidden tw:md:flex tw:flex-col tw:w-80 tw:border-l tw:flex-shrink-0"
            style={{ borderColor: 'rgba(255,215,0,0.06)', background: 'rgba(10,10,15,0.6)', backdropFilter: 'blur(10px)' }}>
            {chatPanel}
          </div>
        </div>

        <AnimatePresence>
          {showMobileChat && (
            <motion.div key="mobile-chat" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 340, damping: 32 }}
              className="tw:md:hidden tw:fixed tw:inset-x-0 tw:bottom-0 tw:z-40 tw:flex tw:flex-col tw:rounded-t-2xl"
              style={{ height: 'calc(100dvh * 0.65)', paddingBottom: 'env(safe-area-inset-bottom)', background: 'rgba(10,10,15,0.97)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,215,0,0.12)', borderBottom: 'none' }}>
              <div className="tw:flex tw:items-center tw:justify-center tw:px-4 tw:pt-3 tw:pb-1 tw:flex-shrink-0">
                <div className="tw:w-10 tw:h-1 tw:rounded-full tw:bg-[rgba(255,255,255,0.15)]" />
              </div>
              <div className="tw:flex-1 tw:min-h-0">{chatPanel}</div>
            </motion.div>
          )}
        </AnimatePresence>
        {showMobileChat && <div className="tw:md:hidden tw:fixed tw:inset-0 tw:z-30" onClick={() => setShowMobileChat(false)} />}
      </div>

      <AnimatePresence>
        {revealing && myRole && priv && (
          <RoleReveal
            key="role"
            role={myRole}
            teammates={players.filter((p) => family.has(p.id) && p.id !== myId)}
            onClose={() => setRevealing(false)}
          />
        )}
        {!revealing && elim && <ElimScreen key={`elim-${elim.id}`} m={m} death={elim} onClose={nextElim} />}
        {m.phase === 'game_over' && !elim && (
          <GameOverScreen key="over" m={m} myId={myId}
            onRematch={role !== 'guest' ? useStore.getState().rematch : undefined}
            onLeave={leaveAfterBreak} />
        )}
      </AnimatePresence>
    </div>
  );
}
