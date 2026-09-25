import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useT } from '../i18n';
import type { TipId } from './coachTips';

export { monopolyTips, mafiaTips, type TipId } from './coachTips';

/* ------------------------------------------------------------------ *
 * First-game tips. Each one appears the first time its moment comes -
 * the first purchase, the first full set, the first night - says what
 * the choice is, and never comes back once dismissed. One at a time, at
 * the top of the table where no turn control lives. A player who wants
 * none of it turns them all off in one tap.
 *
 * What triggers a tip is a pure read of the state everyone already has;
 * what was seen lives in this browser only.
 * ------------------------------------------------------------------ */

const SEEN_KEY = 'mply.tipsSeen';
const OFF_KEY = 'mply.tipsOff';

function readSeen(): Set<string> {
  try {
    if (localStorage.getItem(OFF_KEY) === '1') return new Set(['*']);
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function Coach({ tips }: { tips: TipId[] }) {
  const t = useT();
  const C = t.coach;
  const [seen, setSeen] = useState(readSeen);
  const tip = seen.has('*') ? null : tips.find((id) => !seen.has(id)) ?? null;

  const dismiss = useCallback((id: TipId) => {
    setSeen((prev) => {
      const next = new Set(prev).add(id);
      try { localStorage.setItem(SEEN_KEY, JSON.stringify([...next].filter((x) => x !== '*'))); } catch { /* private mode */ }
      return next;
    });
  }, []);
  const off = useCallback(() => {
    try { localStorage.setItem(OFF_KEY, '1'); } catch { /* private mode */ }
    setSeen(new Set(['*']));
  }, []);

  return (
    <AnimatePresence>
      {tip && (
        <motion.aside
          key={tip}
          className="coach"
          role="status"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }}
        >
          <span className="coach__icon" aria-hidden>💡</span>
          <p className="coach__text">{C.tips[tip]}</p>
          <span className="coach__actions">
            <button type="button" className="btn btn--primary btn--sm" onClick={() => dismiss(tip)}>{C.gotIt}</button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={off}>{C.off}</button>
          </span>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
