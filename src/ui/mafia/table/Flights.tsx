import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { ActionFace, Ballot, PLAY_LOOK, type PlayKind } from './Cards';

/* ------------------------------------------------------------------ *
 * Things in the air. A card, a ballot or a knife leaves one element's
 * box and lands on another's, along an arc, above everything else on
 * the page. Positions are viewport boxes taken when the throw starts.
 * ------------------------------------------------------------------ */

export interface Box { x: number; y: number; w: number; h: number }

export interface Flight {
  id: number;
  what: 'card' | 'ballot' | 'knife';
  play?: PlayKind;
  label?: string;
  color?: string;
  from: Box;
  to: Box;
  onLand?: () => void;
}

export const boxOf = (el: Element | null | undefined): Box | null => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

/** A box of the given size, centred on another box (shifted by dy). */
export const centredIn = (b: Box, w: number, h: number, dy = 0): Box =>
  ({ x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2 + dy, w, h });

function Flyer({ f, onDone }: { f: Flight; onDone: (id: number) => void }) {
  const small = f.what !== 'card';
  const w = small ? 16 : f.from.w;
  const h = small ? 22 : f.from.h;
  const sx = f.from.x + f.from.w / 2 - w / 2;
  const sy = f.from.y + f.from.h / 2 - h / 2;
  const tx = f.to.x + f.to.w / 2 - w / 2;
  const ty = f.to.y + f.to.h / 2 - h / 2;
  const dist = Math.hypot(tx - sx, ty - sy);
  const lift = Math.min(140, 40 + dist * 0.25);
  const endScale = small ? 1 : f.to.w / f.from.w;
  const spin = small ? (tx > sx ? 540 : -540) : (tx > sx ? 14 : -14);
  const glow = f.play ? PLAY_LOOK[f.play].glow : 'rgba(0,0,0,0)';

  return (
    <motion.div
      className="tw:fixed tw:left-0 tw:top-0"
      style={{ width: w, height: h, filter: small ? undefined : `drop-shadow(0 0 16px ${glow})`, willChange: 'transform' }}
      initial={{ x: sx, y: sy, scale: 1, rotate: 0 }}
      animate={{
        x: [sx, (sx + tx) / 2, tx],
        y: [sy, Math.min(sy, ty) - lift, ty],
        scale: small ? [0.6, 1.3, 1] : [1, 1.22, endScale],
        rotate: [0, spin, small ? spin * 2 : 0],
      }}
      transition={{ duration: small ? 0.6 : 0.5, times: [0, 0.45, 1], ease: [0.3, 0.1, 0.25, 1] }}
      onAnimationComplete={() => { f.onLand?.(); onDone(f.id); }}
    >
      {f.what === 'card' && f.play && <ActionFace kind={f.play} label={f.label ?? ''} />}
      {f.what === 'ballot' && <Ballot color={f.color ?? '#f39c12'} />}
      {f.what === 'knife' && <span style={{ fontSize: 18, lineHeight: 1, display: 'block' }}>🔪</span>}
    </motion.div>
  );
}

/** Everything in flight, drawn over the whole page. */
export function FlightLayer({ flights, onDone }: { flights: Flight[]; onDone: (id: number) => void }) {
  if (flights.length === 0) return null;
  return createPortal(
    <div className="om" style={{ position: 'fixed', inset: 0, zIndex: 45, pointerEvents: 'none', background: 'transparent' }}>
      {flights.map((f) => <Flyer key={f.id} f={f} onDone={onDone} />)}
    </div>,
    document.body,
  );
}
