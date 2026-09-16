import { useEffect } from 'react';

/* ------------------------------------------------------------------ *
 * Keeping the screen awake at the table.
 *
 * A turn-based game is mostly waiting: you watch an opponent think, and
 * the phone's screen timer - set for reading text, not for board games -
 * dims and sleeps mid-hand. While a table is on screen, we ask the
 * browser to keep it lit.
 *
 * The lock is a capability, not a right: the browser can refuse (battery
 * saver, a platform with no wake locks), and the game plays on either
 * way, so every failure here is silent. The OS releases the lock whenever
 * the tab hides, so it is re-requested on every return to the tab.
 * ------------------------------------------------------------------ */

interface WakeLockSentinelLike {
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
}

export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const api = (navigator as { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock;
    if (!api) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let wanted = true;

    const acquire = async () => {
      if (!wanted || sentinel || document.visibilityState !== 'visible') return;
      try {
        sentinel = await api.request('screen');
        sentinel.addEventListener('release', () => { sentinel = null; });
      } catch { /* refused - the game plays on regardless */ }
    };
    const onVisible = () => { void acquire(); };

    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      wanted = false;
      document.removeEventListener('visibilitychange', onVisible);
      if (sentinel) void sentinel.release().catch(() => {});
    };
  }, [active]);
}
