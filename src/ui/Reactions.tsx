import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useT } from '../i18n';
import { PLUS_REACTIONS, REACTIONS, canReact, isPlusReaction, seatHasPlus, type ReactionShown } from '../net/reactions';
import { useStore } from '../store/store';
import { PlusBadge, PlusSheet } from './Plus';
import { PlusMoments, PlusVictory, Showpiece } from './PlusFx';

/* ------------------------------------------------------------------ *
 * The reaction button and the emoji that float up from it. One small
 * round button in a corner of the table opens a row of eight faces; a
 * tap sends one and closes the row. Everyone's reactions rise over the
 * table with the sender's name under them, and are gone in two seconds.
 *
 * Under the eight sits a second row for Party Hall Plus: showpieces that
 * play across the whole table (PlusFx.tsx). Everyone sees the row; for a
 * player without Plus a tap opens the Plus sheet instead of sending. A
 * Plus player's ordinary reactions also rise gilded.
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
  const [offer, setOffer] = useState(false);
  const allowed = canReact(room, seat);
  const plus = seatHasPlus(room, seat);
  const quietFx = useStore((s) => s.quietFx);
  const toggleQuietFx = useStore((s) => s.toggleQuietFx);

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
      <FloatingReactions shown={shown} seat={seat} quiet={quietFx} />
      <PlusMoments />
      <PlusVictory />
      <PlusSheet open={offer} onClose={() => setOffer(false)} />
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
                <span className="react__plus"><PlusBadge small /></span>
                {PLUS_REACTIONS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    role="menuitem"
                    className="react__pick react__pick--plus"
                    data-locked={!plus || undefined}
                    title={plus ? undefined : R.locked(e)}
                    aria-label={plus ? R.send(e) : R.locked(e)}
                    onClick={() => { if (plus) send(e); else setOffer(true); setOpen(false); }}
                  >
                    {e}
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={quietFx}
                  className="react__calm"
                  title={R.calmHint}
                  onClick={toggleQuietFx}
                >
                  <span className="tmenu__switch" aria-hidden />
                  {R.calm}
                </button>
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

function FloatingReactions({ shown, seat, quiet }: { shown: ReactionShown[]; seat: string | null; quiet: boolean }) {
  const room = useStore((s) => s.room);
  const reduce = useReducedMotion();
  const nameOf = (id: string): string => room?.seats.find((s) => s.playerId === id)?.name ?? '';
  // With quieter effects on, somebody else's showpiece floats up the lane
  // like any other reaction; your own still plays in full.
  const staged = (r: ReactionShown): boolean => isPlusReaction(r.emoji) && !(quiet && r.from !== seat);
  const showpieces = shown.filter(staged);

  return (
    <div className="reactFloat" aria-live="polite">
      <AnimatePresence>
        {shown.filter((r) => !staged(r)).map((r) => (
          <motion.div
            key={r.id}
            className="reactFloat__item"
            data-plus={seatHasPlus(room, r.from) || undefined}
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
      {showpieces.map((r) => isPlusReaction(r.emoji) && (
        <div key={r.id}>
          <Showpiece id={r.id} emoji={r.emoji} name={nameOf(r.from)} />
          <span className="sr-only">{`${nameOf(r.from)} ${r.emoji}`}</span>
        </div>
      ))}
    </div>
  );
}
