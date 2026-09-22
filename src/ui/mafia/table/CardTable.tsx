import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { useT } from '../../../i18n';
import type { MafiaPrivate, MafiaState, NightKind } from '../../../mafia/types';
import { useStore } from '../../../store/store';
import { buzz } from '../../haptics';
import { playSFX, TRACKS } from '../audio';
import { roleDef, type ViewPlayer } from '../model';
import { ActionFace, PLAY_LOOK, type PlayKind } from './Cards';
import { boxOf, centredIn, FlightLayer, type Box, type Flight } from './Flights';
import { Hand, HAND_H, HAND_W, type HandCard } from './Hand';
import { SeatCard, type SeatMode } from './SeatCard';

/* ------------------------------------------------------------------ *
 * The table, played with cards. Players sit round an oval of felt as
 * standing cards, you at the near edge. What you may do this phase is
 * in your hand: tap a card to arm it and the players it can land on
 * light up; tap one (or drag the card onto them) and the card flies
 * over and hangs there; tap again - or Play - and it slams down.
 * Ballots fly the same way, everyone's, so a vote is seen to happen.
 * ------------------------------------------------------------------ */

interface Props {
  m: MafiaState;
  myId: string;
  priv: MafiaPrivate | null;
  players: ViewPlayer[];
  teammates: string[];
  left: number | null;
  total: number;
  onNightMove: (kind: NightKind, target: string) => void;
  onSnipe: (target: string) => void;
  onVote: (target: string | null) => void;
}

interface Aim { kind: PlayKind; target: string }

const PHASE_LOOK: Record<string, { icon: string; color: string }> = {
  night: { icon: '🌙', color: '#8e44ad' },
  day: { icon: '☀️', color: '#f39c12' },
  vote: { icon: '⚖️', color: '#e74c3c' },
  game_over: { icon: '🏆', color: '#e9c97a' },
  lobby: { icon: '🎲', color: '#c89b4a' },
};

/** A voter's colour, the same on every screen. */
const inkOf = (id: string): string => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 75% 58%)`;
};

let flightSeq = 1;

export function CardTable({ m, myId, priv, players, teammates, left, total, onNightMove, onSnipe, onVote }: Props) {
  const t = useT();
  const U = t.maf.ui;
  const C = U.cards;
  const hapticsOn = useStore((s) => s.hapticsOn);
  const reduce = useReducedMotion();

  const mine = m.players[myId] ?? null;
  const alive = Boolean(mine?.alive);
  const phase = m.phase;
  const phaseKey = `${phase}:${m.round}`;

  /* ── measuring the felt ─────────────────────────────────────── */
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  const narrow = width < 560;
  const height = Math.round(narrow ? width * 1.18 : width * 0.66);

  const n = players.length;
  const seatW = useMemo(() => {
    const a = width / 2, b = height / 2;
    const perimeter = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
    return Math.round(Math.max(40, Math.min(narrow ? 64 : 78, (perimeter / Math.max(n, 1)) * 0.5)));
  }, [width, height, n, narrow]);
  const seatH = Math.round(seatW * 1.38);

  // You sit at the near edge; the rest follow round from you.
  const seats = useMemo(() => {
    const at = players.findIndex((p) => p.id === myId);
    const ordered = at >= 0 ? [...players.slice(at), ...players.slice(0, at)] : players;
    const rx = width / 2 - seatW / 2 - 10;
    const ry = height / 2 - seatH / 2 - 14;
    return ordered.map((player, i) => {
      const a = (i / Math.max(n, 1)) * 2 * Math.PI;
      return { player, x: width / 2 + rx * Math.sin(a), y: height / 2 + ry * Math.cos(a) };
    });
  }, [players, myId, width, height, seatW, seatH, n]);
  const seatAt = useMemo(() => new Map(seats.map((s) => [s.player.id, s])), [seats]);

  /* ── the elements cards fly between ─────────────────────────── */
  const seatEls = useRef(new Map<string, HTMLElement>());
  const handEls = useRef(new Map<PlayKind, HTMLElement>());
  const registerHand = useCallback((k: PlayKind, el: HTMLElement | null) => {
    if (el) handEls.current.set(k, el); else handEls.current.delete(k);
  }, []);
  const seatBox = (id: string): Box | null => boxOf(seatEls.current.get(id));
  const handBox = (k: PlayKind): Box | null => boxOf(handEls.current.get(k));
  /** Where a played card hangs over a seat: a little above its middle. */
  const pinBox = (id: string): Box | null => {
    const b = seatBox(id);
    return b ? centredIn(b, HAND_W * 0.8, HAND_H * 0.8, -b.h * 0.28) : null;
  };

  const [flights, setFlights] = useState<Flight[]>([]);
  const land = useCallback((id: number) => setFlights((fs) => fs.filter((f) => f.id !== id)), []);
  const fly = useCallback((f: Omit<Flight, 'id'>) => {
    if (reduce) { f.onLand?.(); return; }
    setFlights((fs) => [...fs, { ...f, id: flightSeq++ }]);
  }, [reduce]);

  /* ── what is in your hand ───────────────────────────────────── */
  const [armed, setArmed] = useState<PlayKind | null>(null);
  const [aim, setAim] = useState<Aim | null>(null);
  const [airborne, setAirborne] = useState<PlayKind | null>(null);
  const [sent, setSent] = useState<Aim | null>(null);
  const [pulse, setPulse] = useState<{ seat: string; key: number; color: string } | null>(null);
  const [peek, setPeek] = useState(false);
  useEffect(() => { setArmed(null); setAim(null); setAirborne(null); setSent(null); }, [phaseKey]);
  useEffect(() => {
    if (!pulse) return;
    const id = setTimeout(() => setPulse(null), 800);
    return () => clearTimeout(id);
  }, [pulse]);

  const family = useMemo(() => new Set((priv?.teammates ?? []).map((x) => x.id)), [priv]);
  const nightKinds: NightKind[] = phase === 'night' && alive && priv ? priv.kinds : [];
  const nightDone = phase === 'night' && Boolean(priv?.move || sent);
  const isSniper = priv?.role === 'sniper';

  const plays: PlayKind[] = useMemo(() => {
    if (!alive) return [];
    if (phase === 'night') return nightKinds;
    if (phase === 'day' && isSniper) return ['snipe'];
    if (phase === 'vote') return ['vote'];
    return [];
  }, [alive, phase, nightKinds, isSniper]);

  const usable = (k: PlayKind): boolean => {
    if (k === 'snipe') return Boolean(priv?.shotLeft) && !sent;
    if (k === 'vote') return true;
    return !nightDone;
  };

  const targetsFor = useCallback((k: PlayKind | null): Set<string> => {
    if (!k) return new Set();
    const ids = m.seats.filter((id) => m.players[id].alive);
    if (k === 'protect') return new Set(ids.filter((id) => id !== priv?.noProtect));
    if (k === 'kill') return new Set(ids.filter((id) => id !== myId && !family.has(id)));
    return new Set(ids.filter((id) => id !== myId));
  }, [m, myId, priv, family]);

  const liveKinds = plays.filter(usable);
  // With a single card to play, a tap on a player plays it: no need to arm.
  const implied: PlayKind | null = armed ?? (liveKinds.length === 1 ? liveKinds[0] : null);
  const targets = targetsFor(aim ? aim.kind : implied);

  const feel = (pattern: number | number[]) => buzz(hapticsOn, pattern);
  const click = (v = 0.45) => playSFX(TRACKS.click, v);
  const labelOf = (k: PlayKind): string => C.names[k];

  /* ── playing ────────────────────────────────────────────────── */
  const commit = (a: Aim) => {
    const color = PLAY_LOOK[a.kind].color;
    setPulse({ seat: a.target, key: Date.now(), color });
    feel([18, 40, 30]);
    click(0.6);
    setAim(null);
    setArmed(null);
    if (a.kind === 'snipe') { setSent(a); onSnipe(a.target); } else if (a.kind !== 'vote') { setSent(a); onNightMove(a.kind, a.target); }
  };

  const throwVote = (target: string) => {
    const from = handBox('vote');
    const to = seatBox(target);
    const previous = m.votes[myId];
    click(0.4);
    feel(12);
    const cast = () => { onVote(target); setPulse({ seat: target, key: Date.now(), color: PLAY_LOOK.vote.color }); };
    if (previous && previous !== target) {
      const pf = seatBox(previous);
      if (pf && to) { fly({ what: 'ballot', color: inkOf(myId), from: pf, to, onLand: cast }); return; }
    }
    if (from && to) fly({ what: 'ballot', color: inkOf(myId), from, to, onLand: cast });
    else cast();
  };

  const takeBackVote = (target: string) => {
    const from = seatBox(target);
    const to = handBox('vote');
    click(0.3);
    feel(8);
    onVote(null);
    if (from && to) fly({ what: 'ballot', color: inkOf(myId), from, to });
  };

  /** Send a card from the hand (or from where it hangs) to hang over a player. */
  const aimAt = (k: PlayKind, target: string, from: Box | null) => {
    const to = pinBox(target);
    click(0.35);
    feel(10);
    setArmed(k);
    if (from && to) {
      setAirborne(k);
      setAim(null);
      fly({ what: 'card', play: k, label: labelOf(k), from, to, onLand: () => { setAim({ kind: k, target }); setAirborne(null); } });
    } else {
      setAim({ kind: k, target });
    }
  };

  const onSeat = (id: string) => {
    if (phase === 'vote') {
      if (!alive) return;
      if (m.votes[myId] === id) { takeBackVote(id); return; }
      if (targets.has(id)) throwVote(id);
      return;
    }
    if (airborne) return;
    if (aim) {
      if (aim.target === id) { commit(aim); return; }
      if (targetsFor(aim.kind).has(id)) aimAt(aim.kind, id, pinBox(aim.target));
      return;
    }
    if (implied && usable(implied) && targets.has(id)) aimAt(implied, id, handBox(implied));
  };

  const onArm = (k: PlayKind) => {
    if (!usable(k)) return;
    if (aim) {
      // Tapping the card you already aimed takes it back to the hand.
      const from = pinBox(aim.target);
      const to = handBox(aim.kind);
      const back = aim.kind;
      setAim(null);
      if (from && to) { setAirborne(back); fly({ what: 'card', play: back, label: labelOf(back), from, to, onLand: () => setAirborne(null) }); }
      if (back === k) { setArmed(null); return; }
    }
    click(0.3);
    feel(8);
    setArmed((cur) => (cur === k ? null : k));
  };

  const cancel = () => {
    if (!aim) { setArmed(null); return; }
    const from = pinBox(aim.target);
    const to = handBox(aim.kind);
    const back = aim.kind;
    setAim(null);
    click(0.25);
    if (from && to) { setAirborne(back); fly({ what: 'card', play: back, label: labelOf(back), from, to, onLand: () => setAirborne(null) }); }
  };

  const onDrop = (k: PlayKind, x: number, y: number) => {
    const hit = document.elementsFromPoint(x, y)
      .map((el) => (el as HTMLElement).closest?.('[data-seat]') as HTMLElement | null)
      .find(Boolean);
    const id = hit?.dataset.seat;
    if (!id || !usable(k) || !targetsFor(k).has(id)) return;
    if (k === 'vote') {
      if (m.votes[myId] === id) return;
      click(0.4); feel(12);
      onVote(id);
      setPulse({ seat: id, key: Date.now(), color: PLAY_LOOK.vote.color });
      return;
    }
    click(0.35); feel(10);
    setArmed(k);
    setAim({ kind: k, target: id });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ── everyone else's ballots and knives, seen in flight ─────── */
  const prevVotes = useRef<Record<string, string>>(m.votes);
  useEffect(() => {
    const before = prevVotes.current;
    prevVotes.current = m.votes;
    if (phase !== 'vote') return;
    for (const [voter, target] of Object.entries(m.votes)) {
      if (voter === myId || before[voter] === target) continue;
      const from = seatBox(voter);
      const to = seatBox(target);
      if (from && to) fly({ what: 'ballot', color: inkOf(voter), from, to });
    }
  }, [m.votes]);
  const prevPicks = useRef<Record<string, string>>(priv?.familyPicks ?? {});
  useEffect(() => {
    const picks = priv?.familyPicks ?? {};
    const before = prevPicks.current;
    prevPicks.current = picks;
    if (phase !== 'night') return;
    for (const [who, target] of Object.entries(picks)) {
      if (who === myId || before[who] === target) continue;
      const from = seatBox(who);
      const to = seatBox(target);
      if (from && to) fly({ what: 'knife', from, to });
    }
  }, [priv?.familyPicks]);

  /* ── tallies ────────────────────────────────────────────────── */
  const ballotsOn = useMemo(() => {
    const out = new Map<string, string[]>();
    if (phase !== 'vote') return out;
    for (const [voter, target] of Object.entries(m.votes)) out.set(target, [...(out.get(target) ?? []), inkOf(voter)]);
    return out;
  }, [m.votes, phase]);
  const most = Math.max(0, ...[...ballotsOn.values()].map((b) => b.length));
  const knivesOn = useMemo(() => {
    const out = new Map<string, number>();
    if (phase !== 'night') return out;
    for (const target of Object.values(priv?.familyPicks ?? {})) out.set(target, (out.get(target) ?? 0) + 1);
    return out;
  }, [priv?.familyPicks, phase]);

  /* ── what the table says to you ─────────────────────────────── */
  const played: Aim | null = phase === 'night' ? (priv?.move ?? sent) : phase === 'day' ? sent : null;
  const bossName = priv?.boss ? m.players[priv.boss]?.name ?? '' : '';
  const advisory = Boolean(priv && family.size > 0 && priv.boss !== myId);
  const myRole = priv ? roleDef(t, priv.role) : null;

  let hint = '';
  if (!mine) hint = C.watching;
  else if (!alive) hint = C.dead;
  else if (phase === 'night') {
    if (nightKinds.length === 0) hint = C.sleeping;
    else if (played) hint = C.played(labelOf(played.kind), m.players[played.target]?.name ?? '');
    else if (armed || liveKinds.length === 1) {
      const k = (armed ?? liveKinds[0]) as NightKind;
      hint = k === 'kill' && advisory ? `${U.night.suggest(bossName)} · ${C.aim}` : `${U.night.choose[k]} · ${C.aim}`;
    } else hint = C.pick;
  } else if (phase === 'day') {
    if (isSniper && priv?.shotLeft && !sent) hint = armed ? `${U.sniper.note} · ${C.aim}` : C.snipeHint;
    else if (played) hint = C.played(labelOf(played.kind), m.players[played.target]?.name ?? '');
    else hint = C.dayHint;
  } else if (phase === 'vote') {
    const mv = m.votes[myId];
    hint = mv ? C.voted(m.players[mv]?.name ?? '') : C.voteHint;
  }

  const handCards: HandCard[] = plays.map((k) => ({
    kind: k,
    label: labelOf(k),
    state: airborne === k || aim?.kind === k ? 'away'
      : !usable(k) ? 'used'
        : armed === k ? 'armed' : 'ready',
  }));
  // A spent sniper still holds the empty shell.
  if (alive && phase === 'day' && isSniper && handCards.length === 0) handCards.push({ kind: 'snipe', label: labelOf('snipe'), state: 'used' });

  const actions = aim ? (
    <>
      <motion.button type="button" onClick={cancel} whileTap={{ scale: 0.94 }}
        className="tw:flex tw:items-center tw:gap-1.5 tw:px-3 tw:py-2 tw:rounded-lg tw:text-xs tw:uppercase"
        style={{ minHeight: 40, fontFamily: "'Cinzel', serif", fontWeight: 700, letterSpacing: '0.08em', color: '#c9c3b3', background: 'rgba(26,26,46,0.8)', border: '1px solid rgba(255,255,255,0.12)' }}>
        <X size={14} /> {C.back}
      </motion.button>
      <motion.button type="button" onClick={() => commit(aim)} whileTap={{ scale: 0.94 }}
        animate={{ boxShadow: [`0 0 0px ${PLAY_LOOK[aim.kind].glow}`, `0 0 22px ${PLAY_LOOK[aim.kind].glow}`, `0 0 0px ${PLAY_LOOK[aim.kind].glow}`] }}
        transition={{ duration: 1.4, repeat: Infinity }}
        className="tw:flex tw:items-center tw:gap-1.5 tw:px-4 tw:py-2 tw:rounded-lg tw:text-sm tw:uppercase tw:max-w-[60vw]"
        style={{ minHeight: 40, fontFamily: "'Cinzel', serif", fontWeight: 800, letterSpacing: '0.06em', color: '#fff', background: `linear-gradient(135deg, ${PLAY_LOOK[aim.kind].color}, #3a0d0a)`, border: `1px solid ${PLAY_LOOK[aim.kind].color}` }}>
        <Check size={15} />
        <span className="tw:truncate">{C.aimed(aim.kind === 'kill' && advisory ? C.suggest : labelOf(aim.kind), m.players[aim.target]?.name ?? '')}</span>
      </motion.button>
    </>
  ) : undefined;

  /* ── the centre of the felt ─────────────────────────────────── */
  const look = PHASE_LOOK[phase] ?? PHASE_LOOK.night;
  const R = narrow ? 34 : 42;
  const circ = 2 * Math.PI * R;
  const frac = left !== null && total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
  const urgent = left !== null && left <= 10;
  const votesIn = Object.keys(m.votes).length;
  const aliveN = m.seats.filter((id) => m.players[id].alive).length;

  const pinned = aim ?? (played && seatAt.has(played.target) ? played : null);
  const pinnedAt = pinned ? seatAt.get(pinned.target) : null;

  return (
    <div className="tw:flex tw:flex-col tw:w-full tw:flex-1">
      <div ref={boxRef} className="tw:relative tw:w-full tw:mx-auto" style={{ maxWidth: 820, height }}>
        {/* The felt. */}
        <div className="tw:absolute tw:pointer-events-none" style={{
          left: seatW * 0.55, right: seatW * 0.55, top: seatH * 0.5, bottom: seatH * 0.5, borderRadius: '50%',
          background: phase === 'night'
            ? 'radial-gradient(ellipse at 50% 45%, #1d2a3a 0%, #0f1822 55%, #070b10 100%)'
            : 'radial-gradient(ellipse at 50% 45%, #1f5a3c 0%, #123a27 55%, #0a1f16 100%)',
          boxShadow: 'inset 0 0 60px rgba(0,0,0,0.75), inset 0 0 0 10px #2a1a10, inset 0 0 0 12px rgba(200,155,74,0.45), 0 30px 60px -20px rgba(0,0,0,0.9)',
          transition: 'background 1.2s',
        }} />
        <div className="tw:absolute tw:pointer-events-none" style={{
          left: seatW * 0.55 + 26, right: seatW * 0.55 + 26, top: seatH * 0.5 + 26, bottom: seatH * 0.5 + 26, borderRadius: '50%',
          border: '1px dashed rgba(233,201,122,0.16)',
        }} />

        {/* Centre: the phase, the clock, the count. */}
        <div className="tw:absolute tw:left-1/2 tw:top-1/2 tw:-translate-x-1/2 tw:-translate-y-1/2 tw:flex tw:flex-col tw:items-center tw:pointer-events-none" style={{ zIndex: 2 }}>
          <div className="tw:relative" style={{ width: R * 2 + 12, height: R * 2 + 12 }}>
            <svg width={R * 2 + 12} height={R * 2 + 12} className="tw:absolute tw:inset-0" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx={R + 6} cy={R + 6} r={R} fill="rgba(0,0,0,0.35)" stroke="rgba(255,255,255,0.07)" strokeWidth={4} />
              <motion.circle cx={R + 6} cy={R + 6} r={R} fill="none" strokeWidth={4} strokeLinecap="round"
                stroke={urgent ? '#e74c3c' : look.color}
                strokeDasharray={circ}
                initial={false}
                animate={{ strokeDashoffset: circ * (1 - frac) }}
                transition={{ duration: 1, ease: 'linear' }}
                style={{ filter: `drop-shadow(0 0 6px ${urgent ? '#e74c3c' : look.color})` }} />
            </svg>
            <div className="tw:absolute tw:inset-0 tw:flex tw:flex-col tw:items-center tw:justify-center">
              <AnimatePresence mode="wait">
                <motion.span key={phase} style={{ fontSize: narrow ? 24 : 30, lineHeight: 1 }}
                  initial={{ scale: 0.4, rotate: -30, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 16 }}>
                  {look.icon}
                </motion.span>
              </AnimatePresence>
              {left !== null && (
                <motion.span key={urgent ? 'u' : 'n'} animate={urgent ? { scale: [1, 1.15, 1] } : {}} transition={{ duration: 1, repeat: Infinity }}
                  style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: narrow ? 12 : 14, fontWeight: 700, color: urgent ? '#e74c3c' : '#e8e8f0', marginTop: 2 }}>
                  {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
                </motion.span>
              )}
            </div>
          </div>
          <span className="tw:uppercase tw:mt-1.5" style={{ fontFamily: "'Cinzel', serif", fontSize: narrow ? 11 : 13, fontWeight: 800, letterSpacing: '0.2em', color: look.color, textShadow: `0 0 14px ${look.color}66` }}>
            {U.phaseShort[phase]}
          </span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: '#9a9ab0', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
            {phase === 'vote' ? U.vote.cast(votesIn, aliveN) : U.round(m.round)}
          </span>
        </div>

        {seats.map(({ player, x, y }, i) => {
          const isMe = player.id === myId;
          const isAlly = !isMe && teammates.includes(player.username);
          const aimKind = aim ? aim.kind : implied;
          const hot = (aim || implied) && targets.has(player.id) && (phase === 'vote' ? alive : !airborne);
          const mode: SeatMode = hot ? 'target' : (armed || aim) && !airborne && player.status === 'alive' ? 'blocked' : 'idle';
          return (
            <SeatCard
              key={player.id}
              ref={(el) => { if (el) seatEls.current.set(player.id, el); else seatEls.current.delete(player.id); }}
              player={player}
              w={seatW}
              h={seatH}
              x={x}
              y={y}
              index={i}
              isMe={isMe}
              isAlly={isAlly}
              mode={mode}
              aimColor={aimKind ? PLAY_LOOK[aimKind].color : '#c89b4a'}
              ballots={ballotsOn.get(player.id) ?? []}
              leading={phase === 'vote' && most > 0 && (ballotsOn.get(player.id)?.length ?? 0) === most}
              knives={knivesOn.get(player.id) ?? 0}
              myBallot={phase === 'vote' && m.votes[myId] === player.id}
              pulse={pulse && pulse.seat === player.id ? { key: pulse.key, color: pulse.color } : null}
              onTap={onSeat}
            />
          );
        })}

        {/* The card hanging over its target, waiting for the word - or played. */}
        <AnimatePresence>
          {pinned && pinnedAt && !airborne && (
            <motion.button
              key={`${pinned.kind}-${pinned.target}-${aim ? 'aim' : 'done'}`}
              type="button"
              disabled={!aim}
              onClick={() => aim && commit(aim)}
              aria-label={aim ? C.aimed(labelOf(aim.kind), m.players[aim.target]?.name ?? '') : C.played(labelOf(pinned.kind), m.players[pinned.target]?.name ?? '')}
              className="tw:absolute tw:left-0 tw:top-0"
              style={{ width: HAND_W * 0.8, height: HAND_H * 0.8, zIndex: 30, cursor: aim ? 'pointer' : 'default' }}
              initial={aim ? { x: pinnedAt.x - HAND_W * 0.4, y: pinnedAt.y - HAND_H * 0.4 - seatH * 0.28, scale: 1, opacity: 1 } : { x: pinnedAt.x - HAND_W * 0.4, y: pinnedAt.y - HAND_H * 0.4 - seatH * 0.28, scale: 1.5, opacity: 0 }}
              animate={aim
                ? { x: pinnedAt.x - HAND_W * 0.4, y: [pinnedAt.y - HAND_H * 0.4 - seatH * 0.28, pinnedAt.y - HAND_H * 0.4 - seatH * 0.28 - 6, pinnedAt.y - HAND_H * 0.4 - seatH * 0.28], rotate: [-4, 4, -4], scale: 1, opacity: 1 }
                : { x: pinnedAt.x - HAND_W * 0.3, y: pinnedAt.y - HAND_H * 0.3 - seatH * 0.32, rotate: -12, scale: 0.72, opacity: 0.95 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={aim ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : { type: 'spring', stiffness: 500, damping: 18 }}
            >
              <ActionFace kind={pinned.kind} label={labelOf(pinned.kind)} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {mine && phase !== 'game_over' && (
        <div className="tw:sticky tw:bottom-0 tw:z-20 tw:mt-auto tw:pt-1">
          <Hand
            cards={handCards}
            role={myRole}
            peek={peek}
            onPeek={() => { setPeek((v) => !v); click(0.25); }}
            sleeping={alive && phase === 'night' && nightKinds.length === 0}
            hint={hint}
            hintKey={`${phaseKey}|${hint}`}
            actions={actions}
            onArm={onArm}
            onDrop={onDrop}
            register={registerHand}
          />
        </div>
      )}

      <FlightLayer flights={flights} onDone={land} />
    </div>
  );
}
