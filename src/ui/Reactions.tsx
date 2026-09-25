import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useT } from '../i18n';
import { REACTIONS, canReact, type ReactionShown } from '../net/reactions';
import { useStore } from '../store/store';

/* ------------------------------------------------------------------ *
 * The reaction button and the emoji that float up from it. One small
 * round button in a corner of the table opens a row of eight faces; a
 * tap sends one and closes the row. Everyone's reactions rise over the
 * table with the sender's name under them, and are gone in two seconds.
 *
 * `game` places the button clear of each table's own furniture (the
 * phone dock, Omertà's chat button) - see .react[data-game] in app.css.
 * ------------------------------------------------------------------ */

/** Where across the screen a reaction rises: steady per reaction, and
 *  spread so a burst of them does not stack into one column. */
function lane(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return 12 + (h % 76);
}

export function Reactions({ game, seat }: { game: 'monopoly' | 'cashflow' | 'mafia'; seat: string | null }) {
  const t = useT();
  const R = t.reactions;
  const room = useStore((s) => s.room);
  const shown = useStore((s) => s.reactions);
  const send = useStore((s) => s.sendReaction);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const allowed = canReact(room, seat);

  // A tap anywhere else, or Escape, puts the row away.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc); };
  }, [open]);
  useEffect(() => { if (!allowed) setOpen(false); }, [allowed]);

  return (
    <>
      <FloatingReactions shown={shown} />
      {seat && (
        <div className="react" data-game={game} ref={ref}>
          <AnimatePresence>
            {open && (
              <motion.div
                className="react__row"
                role="menu"
                aria-label={R.aria}
                initial={{ opacity: 0, y: 6, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.14 }}
              >
                {REACTIONS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    role="menuitem"
                    className="react__pick"
                    aria-label={R.send(e)}
                    onClick={() => { send(e); setOpen(false); }}
                  >
                    {e}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          <button
            type="button"
            className="react__open"
            aria-expanded={open}
            aria-haspopup="menu"
            disabled={!allowed}
            title={allowed ? R.title : R.quiet}
            aria-label={allowed ? R.title : R.quiet}
            onClick={() => setOpen((v) => !v)}
          >
            <span aria-hidden>😊</span>
          </button>
        </div>
      )}
    </>
  );
}

function FloatingReactions({ shown }: { shown: ReactionShown[] }) {
  const room = useStore((s) => s.room);
  const reduce = useReducedMotion();
  const nameOf = (id: string): string => room?.seats.find((s) => s.playerId === id)?.name ?? '';

  return (
    <div className="reactFloat" aria-live="polite">
      <AnimatePresence>
        {shown.map((r) => (
          <motion.div
            key={r.id}
            className="reactFloat__item"
            style={{ left: `${lane(r.id)}%` }}
            initial={{ opacity: 0, y: 0, scale: 0.6 }}
            animate={reduce
              ? { opacity: [0, 1, 1, 0] }
              : { opacity: [0, 1, 1, 0], y: -220, scale: [0.6, 1.15, 1, 1] }}
            transition={{ duration: 2.4, ease: 'easeOut', times: [0, 0.12, 0.75, 1] }}
          >
            <span className="reactFloat__emoji" aria-hidden>{r.emoji}</span>
            <span className="reactFloat__name">{nameOf(r.from)}</span>
            <span className="sr-only">{`${nameOf(r.from)} ${r.emoji}`}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
