import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useT } from '../i18n';
import { plusWinners } from '../net/plus';
import { MOMENT_MS, type PlusMomentKind } from '../net/plusMoments';
import type { PlusReaction } from '../net/reactions';
import { useStore } from '../store/store';

/* ------------------------------------------------------------------ *
 * What Party Hall Plus looks like at the table, in every game.
 *
 * Showpiece: a Plus reaction. Where an ordinary one floats up a lane,
 * each of these eight takes the whole table for three seconds with a
 * move of its own - a crown comes down, a rocket crosses, roses fall.
 *
 * PlusMoments: a brass ribbon when a Plus player's turn comes round, and
 * a fountain of coins or light at the moments that are theirs - a
 * purchase, rent coming in, the way out of the Grind, a night survived.
 *
 * PlusVictory: gold confetti when a Plus player wins.
 *
 * All of it is glyphs and CSS shapes: nothing to download, nothing to
 * 404. Like ui/Fx.tsx it is decoration - behind pointer events, never in
 * the way of a turn - and with prefers-reduced-motion a showpiece is the
 * emoji and the name fading in and out, and the confetti does not fall.
 * ------------------------------------------------------------------ */

/** Seeded from the reaction's id, so every tab draws the same scatter and
 *  a re-render never reshuffles it. */
function scatter(id: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return () => {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    return h / 4294967296;
  };
}

const GOLD = ['var(--brass-100)', 'var(--brass-300)', 'var(--brass-400)', 'var(--brass-500)'];
const SHOW_S = 3.2;

function NamePlate({ name, delay = 0.25 }: { name: string; delay?: number }) {
  return (
    <motion.span
      className="pfx__name"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: [0, 1, 1, 0], y: 0 }}
      transition={{ duration: SHOW_S - delay, delay, times: [0, 0.12, 0.8, 1] }}
    >
      <span aria-hidden>✦</span> {name}
    </motion.span>
  );
}

/** The emoji itself, centre stage, with the sender's name under it. */
function Hero({ emoji, name, children, ...move }: {
  emoji: string; name: string; children?: React.ReactNode;
} & React.ComponentProps<typeof motion.div>) {
  return (
    <div className="pfx__stage">
      {children}
      <motion.div className="pfx__hero" aria-hidden {...move}>{emoji}</motion.div>
      <NamePlate name={name} />
    </div>
  );
}

const fade = { opacity: [0, 1, 1, 0] };
const fadeT = { duration: SHOW_S, times: [0, 0.1, 0.8, 1] };

function Crown({ name }: { name: string }) {
  return (
    <Hero
      emoji="👑"
      name={name}
      initial={{ y: '-60vh', opacity: 0, rotate: -18 }}
      animate={{ y: ['-60vh', '0vh', '-3vh', '0vh', '0vh'], opacity: [0, 1, 1, 1, 0], rotate: [-18, 4, -2, 0, 0] }}
      transition={{ duration: SHOW_S, times: [0, 0.28, 0.38, 0.46, 1], ease: 'easeOut' }}
    >
      <motion.span
        className="pfx__rays"
        initial={{ opacity: 0, scale: 0.4, rotate: 0 }}
        animate={{ opacity: [0, 0, 0.9, 0.9, 0], scale: [0.4, 0.4, 1, 1.1, 1.2], rotate: 90 }}
        transition={{ duration: SHOW_S, times: [0, 0.26, 0.4, 0.8, 1], ease: 'linear' }}
      />
    </Hero>
  );
}

function Diamonds({ id, name }: { id: string; name: string }) {
  const gems = useMemo(() => {
    const r = scatter(id);
    return Array.from({ length: 18 }, (_, i) => ({
      i, left: 4 + r() * 92, size: 22 + r() * 30, delay: r() * 1.1, spin: (r() - 0.5) * 240, dur: 1.5 + r() * 0.8,
    }));
  }, [id]);
  return (
    <>
      {gems.map((g) => (
        <motion.span
          key={g.i}
          className="pfx__bit pfx__bit--gem"
          style={{ left: `${g.left}%`, top: 0, fontSize: g.size }}
          initial={{ y: '-10vh', opacity: 0, rotate: 0 }}
          animate={{ y: '110vh', opacity: [0, 1, 1, 0.9], rotate: g.spin }}
          transition={{ duration: g.dur, delay: g.delay, ease: 'easeIn' }}
        >
          💎
        </motion.span>
      ))}
      <Hero emoji="💎" name={name} initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: [0.3, 1.2, 1, 1], ...fade }} transition={fadeT} />
    </>
  );
}

function Rocket({ name }: { name: string }) {
  return (
    <>
      <motion.div
        className="pfx__rocket"
        aria-hidden
        initial={{ x: '-15vw', y: '105vh' }}
        animate={{ x: '110vw', y: '-25vh' }}
        transition={{ duration: 1.7, delay: 0.15, ease: [0.5, 0, 0.9, 0.6] }}
      >
        <span className="pfx__tail" />
        🚀
      </motion.div>
      <div className="pfx__stage"><NamePlate name={name} delay={0.5} /></div>
    </>
  );
}

function Trophy({ id, name }: { id: string; name: string }) {
  const bits = useMemo(() => {
    const r = scatter(id);
    return Array.from({ length: 28 }, (_, i) => {
      const a = r() * Math.PI * 2;
      const d = 120 + r() * 220;
      return { i, dx: Math.cos(a) * d, dy: Math.sin(a) * d - 80, spin: (r() - 0.5) * 720, color: GOLD[i % GOLD.length], w: 6 + r() * 6 };
    });
  }, [id]);
  return (
    <Hero
      emoji="🏆"
      name={name}
      initial={{ y: '40vh', scale: 0.5, opacity: 0 }}
      animate={{ y: ['40vh', '0vh', '0vh', '0vh'], scale: [0.5, 1.25, 1, 1], ...fade }}
      transition={{ duration: SHOW_S, times: [0, 0.22, 0.34, 1], ease: 'easeOut' }}
    >
      {bits.map((b) => (
        <motion.span
          key={b.i}
          className="pfx__confetti"
          style={{ background: b.color, width: b.w, height: b.w * 1.8 }}
          initial={{ x: 0, y: 0, opacity: 0, rotate: 0 }}
          animate={{ x: [0, b.dx, b.dx * 1.15], y: [0, b.dy, b.dy + 260], opacity: [0, 1, 0], rotate: b.spin }}
          transition={{ duration: 2.2, delay: 0.6, times: [0, 0.35, 1], ease: 'easeOut' }}
        />
      ))}
    </Hero>
  );
}

function Lightning({ name }: { name: string }) {
  return (
    <>
      <motion.span
        className="pfx__flash"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.75, 0.05, 0.5, 0] }}
        transition={{ duration: 0.7, times: [0, 0.08, 0.3, 0.4, 1] }}
      />
      <Hero
        emoji="⚡"
        name={name}
        initial={{ scale: 3, opacity: 0, y: '-30vh' }}
        animate={{
          scale: [3, 1, 1.1, 1, 1], y: ['-30vh', '0vh', '0vh', '0vh', '0vh'],
          x: [0, 0, -10, 8, 0], opacity: [0, 1, 1, 1, 0],
        }}
        transition={{ duration: SHOW_S, times: [0, 0.08, 0.14, 0.2, 1], ease: 'easeOut' }}
      />
    </>
  );
}

function Fireworks({ id, name }: { id: string; name: string }) {
  const bursts = useMemo(() => {
    const r = scatter(id);
    return Array.from({ length: 4 }, (_, b) => ({
      b, left: 14 + r() * 72, top: 14 + r() * 42, hue: Math.floor(r() * 360), delay: b * 0.45 + r() * 0.15,
      sparks: Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2;
        const d = 70 + r() * 70;
        return { i, dx: Math.cos(a) * d, dy: Math.sin(a) * d };
      }),
    }));
  }, [id]);
  return (
    <>
      {bursts.map((b) => (
        <span key={b.b} className="pfx__burst" style={{ left: `${b.left}%`, top: `${b.top}%`, color: `hsl(${b.hue} 95% 68%)` }}>
          {b.sparks.map((s) => (
            <motion.span
              key={s.i}
              className="pfx__spark"
              initial={{ x: 0, y: 0, opacity: 0, scale: 1 }}
              animate={{ x: [0, s.dx, s.dx * 1.08], y: [0, s.dy, s.dy + 46], opacity: [0, 1, 0], scale: [1, 1, 0.3] }}
              transition={{ duration: 1.3, delay: b.delay, times: [0, 0.45, 1], ease: 'easeOut' }}
            />
          ))}
        </span>
      ))}
      <div className="pfx__stage pfx__stage--low"><NamePlate name={name} /></div>
    </>
  );
}

function Roses({ id, name }: { id: string; name: string }) {
  const petals = useMemo(() => {
    const r = scatter(id);
    return Array.from({ length: 16 }, (_, i) => ({
      i, left: 3 + r() * 94, size: 20 + r() * 20, delay: r() * 0.9, sway: 20 + r() * 40, spin: (r() - 0.5) * 160,
      dur: 2.2 + r() * 0.7, petal: i % 3 !== 0,
    }));
  }, [id]);
  return (
    <>
      {petals.map((p) => (
        <motion.span
          key={p.i}
          className={`pfx__bit${p.petal ? ' pfx__petal' : ''}`}
          style={{ left: `${p.left}%`, top: 0, fontSize: p.size, width: p.petal ? p.size * 0.6 : undefined, height: p.petal ? p.size * 0.8 : undefined }}
          initial={{ y: '-10vh', x: 0, opacity: 0, rotate: 0 }}
          animate={{ y: '108vh', x: [0, p.sway, -p.sway, p.sway * 0.5], opacity: [0, 1, 1, 0.8], rotate: p.spin }}
          transition={{ duration: p.dur, delay: p.delay, ease: 'linear' }}
        >
          {p.petal ? null : '🌹'}
        </motion.span>
      ))}
      <Hero emoji="🌹" name={name} initial={{ scale: 0.4, opacity: 0, rotate: -20 }} animate={{ scale: [0.4, 1.1, 1, 1], rotate: [-20, 6, 0, 0], ...fade }} transition={fadeT} />
    </>
  );
}

function Cheers({ id, name }: { id: string; name: string }) {
  const bubbles = useMemo(() => {
    const r = scatter(id);
    return Array.from({ length: 20 }, (_, i) => ({
      i, left: 30 + r() * 40, size: 6 + r() * 14, delay: 0.5 + r() * 1.2, drift: (r() - 0.5) * 120, dur: 1.2 + r() * 0.8,
    }));
  }, [id]);
  return (
    <>
      {bubbles.map((b) => (
        <motion.span
          key={b.i}
          className="pfx__bubble"
          style={{ left: `${b.left}%`, width: b.size, height: b.size }}
          initial={{ y: 0, x: 0, opacity: 0 }}
          animate={{ y: '-55vh', x: b.drift, opacity: [0, 0.9, 0] }}
          transition={{ duration: b.dur, delay: b.delay, ease: 'easeOut' }}
        />
      ))}
      <Hero
        emoji="🥂"
        name={name}
        initial={{ scale: 0.4, opacity: 0, rotate: -24 }}
        animate={{ scale: [0.4, 1.15, 1.25, 1, 1], rotate: [-24, -14, 10, 0, 0], opacity: [0, 1, 1, 1, 0] }}
        transition={{ duration: SHOW_S, times: [0, 0.14, 0.22, 0.32, 1], ease: 'easeOut' }}
      />
    </>
  );
}

export function Showpiece({ id, emoji, name }: { id: string; emoji: PlusReaction; name: string }) {
  const reduce = useReducedMotion();
  if (reduce) {
    return (
      <div className="pfx">
        <Hero emoji={emoji} name={name} initial={{ opacity: 0 }} animate={fade} transition={fadeT} />
      </div>
    );
  }
  return (
    <div className="pfx">
      {emoji === '👑' && <Crown name={name} />}
      {emoji === '💎' && <Diamonds id={id} name={name} />}
      {emoji === '🚀' && <Rocket name={name} />}
      {emoji === '🏆' && <Trophy id={id} name={name} />}
      {emoji === '⚡' && <Lightning name={name} />}
      {emoji === '🎆' && <Fireworks id={id} name={name} />}
      {emoji === '🌹' && <Roses id={id} name={name} />}
      {emoji === '🥂' && <Cheers id={id} name={name} />}
    </div>
  );
}

/* ---- moments (net/plusMoments.ts) --------------------------------- */

/** A brass ribbon across the top when a Plus player's turn comes round. */
function TurnRibbon({ text, reduce }: { text: string; reduce: boolean }) {
  return (
    <motion.div
      className="pmo__ribbon"
      initial={reduce ? { opacity: 0 } : { opacity: 0, x: '-40vw', skewX: -14 }}
      animate={reduce
        ? { opacity: [0, 1, 1, 0] }
        : { opacity: [0, 1, 1, 0], x: ['-40vw', '0vw', '0vw', '30vw'], skewX: [-14, 0, 0, 10] }}
      transition={{ duration: MOMENT_MS.turn / 1000, times: [0, 0.16, 0.78, 1], ease: 'easeOut' }}
    >
      <span className="pmo__shine" aria-hidden />
      <span aria-hidden>✦</span> {text} <span aria-hidden>✦</span>
    </motion.div>
  );
}

const BURST: Record<Exclude<PlusMomentKind, 'turn'>, { bit: string; hero: string | null; count: number }> = {
  coins: { bit: '🪙', hero: null, count: 12 },
  escape: { bit: '✨', hero: '🕊️', count: 18 },
  saved: { bit: '✨', hero: '🛡️', count: 14 },
};

/** A fountain from the foot of the table: coins for money made or well
 *  spent, light for the bigger moments, with a glyph of their own. */
function Fountain({ id, kind, text, reduce }: {
  id: string; kind: Exclude<PlusMomentKind, 'turn'>; text: string; reduce: boolean;
}) {
  const look = BURST[kind];
  const s = MOMENT_MS[kind] / 1000;
  const { left, bits } = useMemo(() => {
    const r = scatter(id);
    return {
      left: 22 + r() * 56,
      bits: Array.from({ length: look.count }, (_, i) => ({
        i, dx: (r() - 0.5) * 260, up: 150 + r() * 190, spin: (r() - 0.5) * 540, delay: r() * 0.25, size: 20 + r() * 14,
      })),
    };
  }, [id, look.count]);

  return (
    <div className="pmo__fountain" style={{ left: `${left}%` }}>
      {!reduce && bits.map((b) => (
        <motion.span
          key={b.i}
          className="pmo__bit"
          style={{ fontSize: b.size }}
          aria-hidden
          initial={{ x: 0, y: 0, opacity: 0, rotate: 0 }}
          animate={{ x: [0, b.dx * 0.6, b.dx], y: [0, -b.up, -b.up * 0.25], opacity: [0, 1, 0], rotate: b.spin }}
          transition={{ duration: Math.min(1.5, s - 0.3), delay: b.delay, times: [0, 0.45, 1], ease: 'easeOut' }}
        >
          {look.bit}
        </motion.span>
      ))}
      {look.hero && (
        <motion.span
          className="pmo__hero"
          aria-hidden
          initial={{ opacity: 0, scale: 0.4, y: 0 }}
          animate={reduce ? { opacity: [0, 1, 1, 0] } : { opacity: [0, 1, 1, 0], scale: [0.4, 1.2, 1, 1], y: [0, -70, -80, -110] }}
          transition={{ duration: s, times: [0, 0.2, 0.75, 1], ease: 'easeOut' }}
        >
          {look.hero}
        </motion.span>
      )}
      <motion.span
        className="pfx__name"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: [0, 1, 1, 0], y: 0 }}
        transition={{ duration: s, times: [0, 0.15, 0.75, 1] }}
      >
        <span aria-hidden>✦</span> {text}
      </motion.span>
    </div>
  );
}

/** Every Plus flourish playing right now, in whichever game is on. */
export function PlusMoments() {
  const t = useT();
  const R = t.reactions;
  const moments = useStore((s) => s.moments);
  const seats = useStore((s) => s.room?.seats);
  const reduce = Boolean(useReducedMotion());
  if (moments.length === 0) return null;
  const nameOf = (id: string): string => seats?.find((s) => s.playerId === id)?.name ?? '';

  return (
    <div className="pmo" aria-hidden>
      {moments.map((m) => {
        const name = nameOf(m.playerId);
        if (m.kind === 'turn') return <TurnRibbon key={m.id} text={R.plusTurn(name)} reduce={reduce} />;
        const text = m.kind === 'escape' ? R.plusEscape(name) : m.kind === 'saved' ? R.plusSaved(name) : name;
        return <Fountain key={m.id} id={m.id} kind={m.kind} text={text} reduce={reduce} />;
      })}
    </div>
  );
}

const VICTORY_MS = 5200;

/** Gold confetti over the table when a Plus player wins. Only for a win
 *  this tab watched happen: a finished game reopened stays still. */
export function PlusVictory() {
  const winners = useStore((s) => plusWinners(s.room).join(','));
  const reduce = useReducedMotion();
  const seen = useRef(winners);
  const [run, setRun] = useState<string | null>(null);

  useEffect(() => {
    if (winners === seen.current) return undefined;
    seen.current = winners;
    if (!winners) return undefined;
    setRun(winners);
    const t = window.setTimeout(() => setRun(null), VICTORY_MS);
    return () => window.clearTimeout(t);
  }, [winners]);

  const bits = useMemo(() => {
    const r = scatter(run ?? '');
    return Array.from({ length: 70 }, (_, i) => ({
      i, left: r() * 100, w: 6 + r() * 7, delay: r() * 1.8, dur: 2.2 + r() * 1.4, sway: (r() - 0.5) * 160,
      spin: (r() - 0.5) * 900, color: GOLD[i % GOLD.length], crown: i % 14 === 0,
    }));
  }, [run]);

  if (!run || reduce) return null;
  return (
    <div className="pfx pfx--victory" aria-hidden>
      {bits.map((b) => (
        <motion.span
          key={b.i}
          className={b.crown ? 'pfx__bit' : 'pfx__confetti pfx__confetti--fall'}
          style={b.crown
            ? { left: `${b.left}%`, top: 0, fontSize: 26 }
            : { left: `${b.left}%`, background: b.color, width: b.w, height: b.w * 1.8 }}
          initial={{ y: '-8vh', x: 0, opacity: 0, rotate: 0 }}
          animate={{ y: '108vh', x: b.sway, opacity: [0, 1, 1, 0.7], rotate: b.spin }}
          transition={{ duration: b.dur, delay: b.delay, ease: 'easeIn' }}
        >
          {b.crown ? '👑' : null}
        </motion.span>
      ))}
    </div>
  );
}
