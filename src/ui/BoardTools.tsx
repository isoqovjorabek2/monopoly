import { useCallback, useEffect, useState } from 'react';

/* ------------------------------------------------------------------ *
 * Making the board bigger.
 *
 * The board is sized off the shorter viewport axis so it is always
 * square and always fully visible, which is right and which also means
 * that on a wide screen it leaves the player looking at a small board
 * with a lot of empty felt around it. Two controls fix that without
 * taking the layout apart:
 *
 *   zoom  - grows the board past the height the rails leave for it, and
 *           lets the stage scroll. Remembered, because it is a property
 *           of the player's eyesight and monitor, not of the game.
 *   focus - folds the rails away so the board has the whole window, and
 *           asks for real fullscreen on top of that.
 *
 * They are deliberately separate: fullscreen is a browser mode that can
 * be refused (iOS Safari has no Element.requestFullscreen), so the
 * layout half has to stand on its own when the request fails.
 * ------------------------------------------------------------------ */

export const ZOOM_STEPS: readonly number[] = [0.82, 0.92, 1, 1.12, 1.28, 1.5];
const DEFAULT_ZOOM = 1;

export function readBoardZoom(): number {
  try {
    const saved = Number(localStorage.getItem('mply.zoom'));
    return ZOOM_STEPS.includes(saved) ? saved : DEFAULT_ZOOM;
  } catch {
    return DEFAULT_ZOOM;
  }
}

export function writeBoardZoom(zoom: number): void {
  try { localStorage.setItem('mply.zoom', String(zoom)); } catch { /* private mode */ }
}

/**
 * Focus mode, kept in sync with the browser's own fullscreen state.
 *
 * The two can diverge in one direction only the browser controls: Escape
 * and the F11 key leave fullscreen without telling us, and a layout still
 * folded away at that point would strand the player with no rails and no
 * obvious way back. So the browser's event is the source of truth whenever
 * fullscreen actually engaged.
 */
export function useFocusMode(): { focused: boolean; toggle: () => void } {
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const sync = () => { if (!document.fullscreenElement) setFocused(false); };
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggle = useCallback(() => {
    setFocused((was) => {
      const next = !was;
      // Fire and forget: a refused request still leaves the layout folded,
      // which is most of the benefit and all of the reversibility.
      if (next) void document.documentElement.requestFullscreen?.().catch(() => {});
      else if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
      return next;
    });
  }, []);

  return { focused, toggle };
}

export function BoardTools({
  zoom, focused, onZoom, onToggleFocus,
}: {
  zoom: number;
  focused: boolean;
  onZoom: (delta: number) => void;
  onToggleFocus: () => void;
}) {
  const i = ZOOM_STEPS.indexOf(zoom);
  const pct = Math.round(zoom * 100);

  return (
    <div className="boardTools" role="group" aria-label="Board view">
      <button
        type="button"
        className="boardTools__btn"
        onClick={() => onZoom(-1)}
        disabled={i <= 0}
        aria-label="Smaller board"
        title="Smaller board"
      >
        &minus;
      </button>
      <span className="boardTools__value num" aria-live="polite">{pct}%</span>
      <button
        type="button"
        className="boardTools__btn"
        onClick={() => onZoom(1)}
        disabled={i >= ZOOM_STEPS.length - 1}
        aria-label="Bigger board"
        title="Bigger board"
      >
        +
      </button>
      <span className="boardTools__sep" aria-hidden />
      <button
        type="button"
        className="boardTools__btn boardTools__btn--wide"
        onClick={onToggleFocus}
        aria-pressed={focused}
        title={focused ? 'Leave full screen (F)' : 'Play full screen (F)'}
      >
        {focused ? 'Exit full screen' : 'Full screen'}
        <kbd className="kbd">F</kbd>
      </button>
    </div>
  );
}
