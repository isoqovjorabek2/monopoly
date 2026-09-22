import { useRef, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useT } from '../../../i18n';
import { RoleCard, RoleCardBack } from '../RoleCard';
import type { RoleDef } from '../model';
import { ActionFace, CardBack, PLAY_LOOK, type PlayKind } from './Cards';

/* ------------------------------------------------------------------ *
 * The hand: your role, face down until you lift a corner, and the
 * cards you may play this phase. Tap one to arm it, or drag it straight
 * onto a player. The line above says what a tap will do now.
 * ------------------------------------------------------------------ */

export const HAND_W = 62;
export const HAND_H = 88;

export type HandState = 'ready' | 'armed' | 'away' | 'used';
export interface HandCard { kind: PlayKind; label: string; state: HandState }

interface Props {
  cards: HandCard[];
  role: RoleDef | null;
  peek: boolean;
  onPeek: () => void;
  /** A face-down card in place of an empty hand: you sleep tonight. */
  sleeping: boolean;
  hint: string;
  hintKey: string;
  actions?: ReactNode;
  onArm: (kind: PlayKind) => void;
  onDrop: (kind: PlayKind, x: number, y: number) => void;
  register: (kind: PlayKind, el: HTMLElement | null) => void;
}

export function Hand({ cards, role, peek, onPeek, sleeping, hint, hintKey, actions, onArm, onDrop, register }: Props) {
  const t = useT();
  const C = t.maf.ui.cards;
  const dragged = useRef(false);
  const n = cards.length;

  return (
    <div className="tw:relative tw:flex tw:flex-col tw:items-center tw:gap-2 tw:pt-2 tw:pb-3 tw:px-2"
      style={{
        background: 'radial-gradient(ellipse 60% 100% at 50% 100%, rgba(200,155,74,0.10), transparent 70%), linear-gradient(180deg, transparent, rgba(8,8,12,0.85) 35%)',
      }}>
      <div className="tw:min-h-[40px] tw:flex tw:items-center tw:justify-center tw:w-full">
        <AnimatePresence mode="wait">
          {actions ? (
            <motion.div key="actions" className="tw:flex tw:items-center tw:gap-2"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              {actions}
            </motion.div>
          ) : (
            <motion.p key={hintKey} className="tw:text-center tw:text-sm tw:px-3"
              style={{ color: '#c9c3b3', fontFamily: "'Crimson Text', serif", fontStyle: 'italic' }}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              {hint}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div className="tw:flex tw:items-end tw:justify-center tw:gap-4">
        {role && (
          <button type="button" onClick={onPeek}
            aria-label={peek ? C.hide : C.peek} aria-pressed={peek}
            className="tw:relative tw:flex-shrink-0"
            style={{ width: 60, height: 96, perspective: 600 }}>
            <motion.div className="tw:relative tw:w-full tw:h-full" style={{ transformStyle: 'preserve-3d' }}
              animate={{ rotateY: peek ? 180 : 0, y: peek ? -10 : 0, scale: peek ? 1.12 : 1 }}
              whileHover={{ y: -6 }}
              transition={{ type: 'spring', stiffness: 220, damping: 20 }}>
              <div className="tw:absolute tw:inset-0" style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
                <RoleCardBack size="xs" />
              </div>
              <div className="tw:absolute tw:inset-0" style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                <RoleCard role={role} size="xs" />
              </div>
            </motion.div>
            <span className="tw:absolute tw:-bottom-3 tw:inset-x-0 tw:text-center tw:uppercase tw:whitespace-nowrap"
              style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 7, letterSpacing: '0.15em', color: peek ? role.color : '#8888aa' }}>
              {peek ? role.name : C.peek}
            </span>
          </button>
        )}

        {(n > 0 || sleeping) && <span className="tw:w-px tw:self-stretch tw:my-2" style={{ background: 'linear-gradient(180deg, transparent, rgba(200,155,74,0.35), transparent)' }} />}

        {sleeping && (
          <motion.div style={{ width: HAND_W, height: HAND_H }}
            animate={{ rotate: [-2, 2, -2], y: [0, -3, 0] }} transition={{ duration: 4, repeat: Infinity }}>
            <CardBack label={C.sleep} />
          </motion.div>
        )}

        <div className="tw:flex tw:items-end" style={{ gap: 10 }}>
          {cards.map((c, i) => {
            const fan = (i - (n - 1) / 2);
            const look = PLAY_LOOK[c.kind];
            const live = c.state === 'ready' || c.state === 'armed';
            return (
              <motion.button
                key={c.kind}
                ref={(el) => register(c.kind, el)}
                type="button"
                aria-label={c.label}
                aria-pressed={c.state === 'armed'}
                disabled={!live}
                className="tw:relative tw:flex-shrink-0 tw:touch-none"
                style={{ width: HAND_W, height: HAND_H, zIndex: c.state === 'armed' ? 5 : 1, cursor: live ? 'grab' : 'default' }}
                initial={{ opacity: 0, y: 60, rotate: 0 }}
                animate={{
                  opacity: c.state === 'away' ? 0 : c.state === 'used' ? 0.3 : 1,
                  y: c.state === 'armed' ? -22 : Math.abs(fan) * 4,
                  rotate: c.state === 'armed' ? 0 : fan * 6,
                  scale: c.state === 'armed' ? 1.1 : 1,
                  filter: c.state === 'used' ? 'grayscale(1)' : 'grayscale(0)',
                }}
                transition={{ type: 'spring', stiffness: 300, damping: 22, delay: c.state === 'ready' ? i * 0.03 : 0 }}
                whileHover={live ? { y: -16, scale: 1.08, rotate: 0 } : undefined}
                whileDrag={{ scale: 1.15, rotate: 0, zIndex: 80, cursor: 'grabbing' }}
                drag={live}
                dragSnapToOrigin
                dragElastic={0.9}
                onDragStart={() => { dragged.current = true; }}
                onDragEnd={(_, info) => {
                  onDrop(c.kind, info.point.x - window.scrollX, info.point.y - window.scrollY);
                  setTimeout(() => { dragged.current = false; }, 0);
                }}
                onClick={() => { if (!dragged.current && live) onArm(c.kind); }}
              >
                {c.state === 'armed' && (
                  <motion.span className="tw:absolute tw:pointer-events-none tw:rounded-xl"
                    style={{ inset: -6, boxShadow: `0 0 26px ${look.glow}`, border: `1px solid ${look.color}` }}
                    animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.2, repeat: Infinity }} />
                )}
                <ActionFace kind={c.kind} label={c.label} />
              </motion.button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
