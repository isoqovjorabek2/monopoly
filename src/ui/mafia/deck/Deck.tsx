import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import './deck.css';
import { useT } from '../../../i18n';
import type { MafiaPrivate, MafiaState, NightKind } from '../../../mafia/types';
import { useStore } from '../../../store/store';
import { buzz } from '../../haptics';
import { playSFX, TRACKS } from '../audio';
import { roleDef, type ViewPlayer } from '../model';
import { RoleCard } from '../RoleCard';
import { GraveCard, SuspectCard, type Note, type Stamp } from './SuspectCard';

/* ------------------------------------------------------------------ *
 * Omertà played as a case file. The living are dealt face up; the dead
 * are turned over and laid aside. Your move is two taps: pick a card
 * and a stamp ghosts onto it, tap it again (or Confirm) and the stamp
 * slams down. A vote is one tap, and every ballot shows as the voter's
 * face on the card they chose. What you have learnt stays on the cards:
 * the detective's findings, the family's knives, your private reads.
 * ------------------------------------------------------------------ */

type Move = NightKind | 'snipe';

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

/** Each move's ink. */
const INK: Record<Move | 'vote', { icon: string; color: string }> = {
  kill: { icon: '🔪', color: '#e0503c' },
  silence: { icon: '🤫', color: '#b48ae0' },
  protect: { icon: '💊', color: '#34c9a2' },
  investigate: { icon: '🔍', color: '#5aa9ef' },
  shoot: { icon: '🔫', color: '#e0503c' },
  guard: { icon: '🛡️', color: '#62b8da' },
  snipe: { icon: '🎯', color: '#ecd08a' },
  vote: { icon: '🗳️', color: '#e0503c' },
};

/** A voter's colour, the same on every screen. */
const inkOf = (id: string): string => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 70% 60%)`;
};

const GAP_X = 12;
const GAP_Y = 28;
const MIN_W = 96;
const MAX_W = 196;
const RATIO = 7 / 5;
/** What the page keeps above and below the spread: bars, brief, dock. */
const CHROME_H = 360;
const FALLEN_H = 120;

/**
 * How wide to deal the cards: as big as the room allows, in even rows -
 * seven cards as one row of seven or as 4 + 3, never 6 + 1.
 */
function useDeal(ref: React.RefObject<HTMLDivElement>, n: number, fallen: boolean): number | null {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ w: el.getBoundingClientRect().width, h: window.innerHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    measure();
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [ref]);
  if (!box.w || n === 0) return null;
  const room = Math.max(200, box.h - CHROME_H - (fallen ? FALLEN_H : 0));
  const most = Math.max(1, Math.min(n, Math.floor((box.w + GAP_X) / (MIN_W + GAP_X))));
  let best = 0;
  for (let rows = Math.ceil(n / most); rows <= n; rows++) {
    const cols = Math.ceil(n / rows);
    const w = Math.min(MAX_W, (box.w - GAP_X * (cols - 1)) / cols);
    const fits = rows * w * RATIO + (rows - 1) * GAP_Y <= room;
    if (fits && w > best) best = w;
    if (!fits && rows > Math.ceil(n / most)) break;
  }
  // Nothing fits the height: deal as wide as the width allows and scroll.
  if (!best) best = Math.min(MAX_W, (box.w - GAP_X * (most - 1)) / most);
  return Math.floor(Math.max(MIN_W, best));
}

const PHASE_ICON: Record<string, string> = { night: '🌙', day: '☀️', vote: '⚖️', game_over: '🏆', lobby: '🎲' };

export function Deck({ m, myId, priv, players, teammates, left, total, onNightMove, onSnipe, onVote }: Props) {
  const t = useT();
  const U = t.maf.ui;
  const C = U.cards;
  const D = U.deck;
  const hapticsOn = useStore((s) => s.hapticsOn);

  const phase = m.phase;
  const phaseKey = `${phase}:${m.round}`;
  const mine = m.players[myId] ?? null;
  const alive = Boolean(mine?.alive);
  const family = useMemo(() => new Set((priv?.teammates ?? []).map((x) => x.id)), [priv]);
  const isSniper = priv?.role === 'sniper';

  const spreadRef = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<Move | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [sent, setSent] = useState<{ kind: Move; target: string } | null>(null);
  const [slam, setSlam] = useState(0);
  useEffect(() => { setKind(null); setChosen(null); setSent(null); }, [phaseKey]);

  // Your reads on the others, kept for this game only.
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const gameKey = m.settings.seed;
  useEffect(() => { setNotes({}); }, [gameKey]);
  const cycleNote = (id: string) => {
    playSFX(TRACKS.click, 0.25);
    setNotes((n) => {
      const next = { ...n };
      if (!n[id]) next[id] = 'suspect'; else if (n[id] === 'suspect') next[id] = 'trust'; else delete next[id];
      return next;
    });
  };

  /* ── what you may do now ────────────────────────────────────── */
  const moves: Move[] = useMemo(() => {
    if (!alive || !priv) return [];
    if (phase === 'night') return priv.kinds;
    if (phase === 'day' && isSniper && priv.shotLeft) return ['snipe'];
    return [];
  }, [alive, priv, phase, isSniper]);
  const played = phase === 'night' ? (priv?.move ?? sent) : phase === 'day' ? sent : null;
  const active: Move | null = played ? null : (kind && moves.includes(kind) ? kind : moves[0] ?? null);

  const targetsFor = useCallback((k: Move | 'vote' | null): Set<string> => {
    if (!k) return new Set();
    const ids = m.seats.filter((id) => m.players[id].alive);
    if (k === 'protect') return new Set(ids.filter((id) => id !== priv?.noProtect));
    if (k === 'kill') return new Set(ids.filter((id) => id !== myId && !family.has(id)));
    return new Set(ids.filter((id) => id !== myId));
  }, [m, myId, priv, family]);

  const voting = phase === 'vote' && alive;
  const targets = targetsFor(voting ? 'vote' : active);
  const advisory = Boolean(priv && family.size > 0 && priv.boss !== myId);
  const bossName = priv?.boss ? m.players[priv.boss]?.name ?? '' : '';
  const nameOf = (id: string | null | undefined) => (id && m.players[id]?.name) || '';
  const moveName = (k: Move) => (k === 'kill' && advisory ? C.suggest : C.names[k]);

  const feel = (p: number | number[]) => buzz(hapticsOn, p);

  const commit = (k: Move, target: string) => {
    playSFX(TRACKS.click, 0.6);
    feel([18, 40, 30]);
    setSent({ kind: k, target });
    setSlam((s) => s + 1);
    setChosen(null);
    if (k === 'snipe') onSnipe(target); else onNightMove(k, target);
  };

  const onTap = (id: string) => {
    if (voting) {
      if (!targets.has(id)) return;
      playSFX(TRACKS.click, 0.45);
      feel(12);
      onVote(m.votes[myId] === id ? null : id);
      return;
    }
    if (!active || !targets.has(id)) return;
    if (chosen === id) { commit(active, id); return; }
    playSFX(TRACKS.click, 0.3);
    feel(8);
    setChosen(id);
  };

  const pickKind = (k: Move) => {
    playSFX(TRACKS.click, 0.3);
    setKind(k);
    if (chosen && !targetsFor(k).has(chosen)) setChosen(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setChosen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ── what lies on each card ─────────────────────────────────── */
  const ballots = useMemo(() => {
    const out = new Map<string, { id: string; name: string; color: string }[]>();
    if (phase !== 'vote') return out;
    for (const [voter, target] of Object.entries(m.votes)) {
      out.set(target, [...(out.get(target) ?? []), { id: voter, name: m.players[voter]?.name ?? '', color: inkOf(voter) }]);
    }
    return out;
  }, [m.votes, m.players, phase]);
  const most = Math.max(0, ...[...ballots.values()].map((b) => b.length));
  const leaders = [...ballots.entries()].filter(([, b]) => b.length === most && most > 0).map(([id]) => id);

  const knives = useMemo(() => {
    const out = new Map<string, string[]>();
    if (phase !== 'night') return out;
    for (const [who, target] of Object.entries(priv?.familyPicks ?? {})) {
      if (who === myId) continue;
      out.set(target, [...(out.get(target) ?? []), m.players[who]?.name ?? '']);
    }
    return out;
  }, [priv?.familyPicks, phase, myId, m.players]);

  const checks = useMemo(() => {
    const out = new Map<string, { faction: string; guilty: boolean }>();
    for (const c of priv?.checks ?? []) out.set(c.target, { faction: c.guilty ? U.faction.mafia : U.faction.town, guilty: c.guilty });
    return out;
  }, [priv?.checks, U]);

  const stampFor = (id: string): Stamp | null => {
    if (voting || phase === 'vote') {
      return m.votes[myId] === id ? { label: D.yourVote, color: INK.vote.color, pending: false, key: `v-${id}` } : null;
    }
    if (played && played.target === id) {
      return { label: `${INK[played.kind].icon} ${moveName(played.kind)}`, color: INK[played.kind].color, pending: false, key: `s-${slam}-${id}` };
    }
    if (active && chosen === id) {
      return { label: `${INK[active].icon} ${moveName(active)}`, color: INK[active].color, pending: true, key: 'pending' };
    }
    return null;
  };

  /* ── the words ──────────────────────────────────────────────── */
  let hint = '';
  let aside = '';
  if (!mine) hint = C.watching;
  else if (!alive) hint = C.dead;
  else if (phase === 'night') {
    if (moves.length === 0) hint = C.sleeping;
    else if (played) hint = C.played(moveName(played.kind), nameOf(played.target));
    else if (active) {
      hint = active === 'kill' && advisory ? U.night.suggest(bossName) : U.night.choose[active as NightKind];
      if (active === 'investigate') aside = U.night.investigateNote;
      else if (active === 'shoot') aside = U.night.shootNote;
      else if (active === 'kill' && advisory) aside = U.night.bossNote(bossName);
      if (chosen) aside = D.tapAgain;
    }
  } else if (phase === 'day') {
    if (played) hint = C.played(moveName(played.kind), nameOf(played.target));
    else if (active === 'snipe') { hint = C.snipeHint; aside = chosen ? D.tapAgain : U.sniper.note; }
    else { hint = C.dayHint; aside = D.noteHint; }
  } else if (phase === 'vote') {
    const mv = m.votes[myId];
    hint = mv ? D.voted(nameOf(mv)) : D.voteHint;
  }

  const brief = phase === 'vote'
    ? U.vote.cast(Object.keys(m.votes).length, m.seats.filter((id) => m.players[id].alive).length)
    : phase === 'night' || phase === 'day' ? U.banner[phase][1] : '';
  const frac = left !== null && total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
  const urgent = left !== null && left <= 10;
  const accent = active ? INK[active].color : undefined;
  const myRole = priv ? roleDef(t, priv.role) : null;

  const living = players.filter((p) => p.status === 'alive');
  const fallen = players.filter((p) => p.status === 'dead');
  // You first, then round the table from you.
  const at = living.findIndex((p) => p.id === myId);
  const dealt = at > 0 ? [living[at], ...living.slice(at + 1), ...living.slice(0, at)] : living;
  const seatNo = (id: string) => m.seats.indexOf(id) + 1;
  const cardW = useDeal(spreadRef, dealt.length, fallen.length > 0);
  const pickable = (id: string) => (voting || Boolean(active)) && targets.has(id);
  const anyPick = voting || Boolean(active);

  return (
    <div className="dk" data-phase={phase} style={accent ? ({ '--dk-accent': accent } as CSSProperties) : undefined}>
      <header className="dk-brief">
        <AnimatePresence mode="wait">
          <motion.h2 key={phase} className="dk-brief__title"
            initial={{ opacity: 0, y: 10, letterSpacing: '0.4em' }} animate={{ opacity: 1, y: 0, letterSpacing: '0.14em' }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
            {PHASE_ICON[phase]} {U.phaseShort[phase]}
          </motion.h2>
        </AnimatePresence>
        {brief && <p className="dk-brief__hint">{brief}</p>}
        {left !== null && (
          <div className="dk-clock" data-urgent={urgent} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={left} aria-label={U.phase[phase]}>
            <span className="dk-clock__fill" style={{ transform: `scaleX(${frac})` }} />
          </div>
        )}
      </header>

      <LayoutGroup>
        <div ref={spreadRef} className="dk-spread" style={cardW ? ({ '--dk-card-w': `${cardW}px` } as CSSProperties) : undefined}>
          <AnimatePresence>
            {dealt.map((p, i) => {
              const isMe = p.id === myId;
              const isAlly = !isMe && teammates.includes(p.username);
              const known = p.roleId && (isMe || isAlly) ? roleDef(t, p.roleId) : null;
              return (
                <SuspectCard
                  key={p.id}
                  player={p}
                  seatNo={seatNo(p.id)}
                  index={i}
                  role={known}
                  isMe={isMe}
                  isAlly={isAlly}
                  tappable={pickable(p.id)}
                  selected={chosen === p.id}
                  dim={anyPick && !pickable(p.id) && !isMe}
                  stamp={stampFor(p.id)}
                  voters={ballots.get(p.id) ?? []}
                  leading={leaders.includes(p.id)}
                  knives={knives.get(p.id) ?? []}
                  check={checks.get(p.id) ?? null}
                  note={notes[p.id] ?? null}
                  onNote={isMe || !mine ? null : () => cycleNote(p.id)}
                  onTap={() => onTap(p.id)}
                />
              );
            })}
          </AnimatePresence>
        </div>

        {fallen.length > 0 && (
          <section className="dk-fallen" aria-label={D.fallen}>
            <h3 className="dk-fallen__title">{D.fallen}</h3>
            <div className="dk-fallen__row">
              {fallen.map((p) => (
                <GraveCard key={p.id} player={p} role={p.roleId ? roleDef(t, p.roleId) : null} />
              ))}
            </div>
          </section>
        )}
      </LayoutGroup>

      {mine && phase !== 'game_over' && (
        <div className="dk-dock" aria-live="polite">
          {myRole && (
            <div className="dk-dock__role" title={myRole.name}>
              <RoleCard role={myRole} size="xs" />
            </div>
          )}
          <div className="dk-dock__main">
            {moves.length > 1 && !played && (
              <div className="dk-tabs" role="group">
                {moves.map((k) => (
                  <button key={k} type="button" className="dk-tab" aria-pressed={active === k}
                    style={{ '--dk-tab-c': INK[k].color } as CSSProperties} onClick={() => pickKind(k)}>
                    <span aria-hidden>{INK[k].icon}</span> {moveName(k)}
                  </button>
                ))}
              </div>
            )}
            <AnimatePresence mode="wait">
              <motion.p key={`${phaseKey}|${hint}`} className="dk-dock__hint"
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
                {hint}
                {aside && <small>{aside}</small>}
              </motion.p>
            </AnimatePresence>
          </div>
          <AnimatePresence>
            {active && chosen && (
              <motion.div key="act" className="dk-dock__actions"
                initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }}
                transition={{ type: 'spring', stiffness: 420, damping: 30 }}>
                <button type="button" className="dk-btn dk-btn--ghost" onClick={() => setChosen(null)} aria-label={D.cancel}>
                  <X size={16} />
                </button>
                <button type="button" className="dk-btn dk-btn--go" onClick={() => commit(active, chosen)}>
                  <Check size={16} />
                  <span>{C.aimed(moveName(active), nameOf(chosen))}</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
