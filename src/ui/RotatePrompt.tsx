import { useState } from 'react';
import { useT } from '../i18n';

/* ------------------------------------------------------------------ *
 * Asking a phone held upright to turn sideways.
 *
 * A board, a player list and an action bar do not fit down a 390px
 * column without the board shrinking to a stamp, and the table is laid
 * out for landscape instead. The overlay is shown and hidden purely by a
 * media query, so it follows the phone as it turns with no listener to
 * fall out of step: rotate to landscape and it is simply gone.
 *
 * Where the browser can turn the screen itself (Android Chrome, inside
 * fullscreen) there is a button that does it. iOS cannot, so there it is
 * the instruction alone. Either way a player can wave it off and keep
 * playing upright - the portrait layout still works, it is just cramped.
 * ------------------------------------------------------------------ */

const DISMISS_KEY = 'mply.rotate.dismissed';

function readDismissed(): boolean {
  try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
}

type LockableOrientation = ScreenOrientation & { lock?: (o: 'landscape') => Promise<void> };

function canLock(): boolean {
  const o = (typeof screen !== 'undefined' ? screen.orientation : undefined) as LockableOrientation | undefined;
  return typeof o?.lock === 'function' && typeof document.documentElement.requestFullscreen === 'function';
}

export function RotatePrompt() {
  const t = useT();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [lockable, setLockable] = useState(canLock);

  if (dismissed) return null;

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode */ }
    setDismissed(true);
  };

  const rotateForMe = async () => {
    try {
      // An orientation lock is only honoured in fullscreen, so ask for that
      // first. Both have to come from this tap.
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      await (screen.orientation as LockableOrientation).lock?.('landscape');
    } catch {
      // Refused: the instruction still stands, the button just stops lying.
      setLockable(false);
    }
  };

  return (
    <div className="rotate" role="dialog" aria-modal="true" aria-labelledby="rotate-title">
      <div className="rotate__card">
        <svg className="rotate__phone" viewBox="0 0 120 120" aria-hidden="true">
          {/* Anticlockwise, over the top: the way a phone turns -90deg. */}
          <path className="rotate__arrow" d="M94 38 A42 42 0 0 0 26 38" />
          <path className="rotate__arrow" d="M24 32 L24 42 L34 39" />
          <g className="rotate__device">
            <rect x="40" y="26" width="40" height="72" rx="7" />
            <rect className="rotate__screen" x="45" y="34" width="30" height="54" rx="2" />
            <circle className="rotate__button" cx="60" cy="93" r="2.2" />
          </g>
        </svg>
        <h2 id="rotate-title" className="rotate__title">{t.rotate.title}</h2>
        <p className="rotate__body">{t.rotate.body}</p>
        <div className="rotate__actions">
          {lockable && (
            <button type="button" className="btn btn--primary btn--block" onClick={rotateForMe}>
              {t.rotate.lock}
            </button>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={dismiss}>
            {t.rotate.anyway}
          </button>
        </div>
      </div>
    </div>
  );
}
