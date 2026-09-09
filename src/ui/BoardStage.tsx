import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import type { GameState } from '../game/types';
import { Board } from './Board';
import { ErrorBoundary } from './ErrorBoundary';

/* The 3D board is code-split: three.js is roughly the size of the rest of
 * the app, and a player who stays in 2D should never download it. */
const Board3D = lazy(() => import('./three/Board3D'));

export type RenderMode = '3d' | '2d';

/**
 * Capability probe, run at most once.
 *
 * It was neither cheap nor idempotent. Every call built a real WebGL
 * context and dropped it on the floor, and a browser keeps only a handful
 * of live contexts per page - Chrome allows about sixteen - before it
 * starts killing the oldest to make room. The oldest is the board's. Since
 * this ran from an effect whose dependency changed on every render of the
 * game screen, a game accumulated roughly one leaked context per turn and
 * the board was evicted from under the player somewhere in the middle of
 * it: three losses in and it fell back to the flat board for good.
 *
 * The answer cannot change during a session, so it is computed once, and
 * the probe hands its context straight back rather than waiting for GC.
 */
let webglProbe: boolean | null = null;

function webglAvailable(): boolean {
  if (webglProbe !== null) return webglProbe;
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as
      WebGLRenderingContext | null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    webglProbe = Boolean(gl);
  } catch {
    webglProbe = false;
  }
  return webglProbe;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Coarse device tier, used to drop shadows and DPR rather than to refuse. */
function quality(): 'high' | 'low' {
  try {
    const cores = navigator.hardwareConcurrency ?? 4;
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
    const small = window.matchMedia('(max-width: 780px)').matches;
    return cores <= 4 || mem <= 4 || small ? 'low' : 'high';
  } catch {
    return 'low';
  }
}

export function readRenderMode(): RenderMode {
  try {
    const saved = localStorage.getItem('mply.render');
    if (saved === '2d' || saved === '3d') return saved;
  } catch { /* private mode */ }
  // Motion-heavy by default, but never against an explicit accessibility
  // preference, and never where it simply cannot run.
  return prefersReducedMotion() || !webglAvailable() ? '2d' : '3d';
}

export function writeRenderMode(mode: RenderMode): void {
  try { localStorage.setItem('mply.render', mode); } catch { /* private mode */ }
}

export function BoardStage({
  mode, state, animPos, rolling, highlight, onInspect, onFallback,
}: {
  mode: RenderMode;
  state: GameState;
  animPos: Record<string, number>;
  rolling: boolean;
  highlight: number | null;
  onInspect: (id: number) => void;
  onFallback: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [tier] = useState(quality);

  // Bumping this remounts the Canvas, which is the only reliable way back
  // from a lost context: the renderer, its programs and every texture on
  // the GPU went with it, so the scene is rebuilt rather than resumed.
  const [attempt, setAttempt] = useState(0);
  const [alive, setAlive] = useState(true);
  const under = useRef<HTMLDivElement>(null);
  const losses = useRef(0);
  const retryTimer = useRef<number | null>(null);
  const healthyTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (retryTimer.current != null) window.clearTimeout(retryTimer.current);
    if (healthyTimer.current != null) window.clearTimeout(healthyTimer.current);
  }, []);

  /** A scene that comes back and then draws cleanly for half a minute had a
   *  hiccup, not a pattern. Counting losses for the whole session instead
   *  demotes a player two hours in over three unrelated stumbles they never
   *  even saw, because each one recovered. */
  const onSceneReady = useCallback(() => {
    setReady(true);
    if (healthyTimer.current != null) window.clearTimeout(healthyTimer.current);
    healthyTimer.current = window.setTimeout(() => { losses.current = 0; }, 30000);
  }, []);

  const onContextLost = useCallback(() => {
    // Unmount the canvas in the same tick. three keeps its animation loop
    // running against the dead context otherwise, and the next frame throws
    // somewhere deep in the renderer - which took the whole game down before
    // this was here. Hiding it also matters on its own: a lost canvas paints
    // solid white over the flat board waiting underneath.
    setAlive(false);
    setReady(false);
    losses.current += 1;
    if (healthyTimer.current != null) {
      window.clearTimeout(healthyTimer.current);
      healthyTimer.current = null;
    }

    // Twice is a hiccup worth riding out. A third means this machine cannot
    // hold a context for this scene, and retrying just flashes the board.
    if (losses.current > 2) {
      console.warn('[board] three lost GPU contexts; falling back to the flat board');
      setFailed(true);
      onFallback();
      return;
    }

    if (retryTimer.current != null) window.clearTimeout(retryTimer.current);
    retryTimer.current = window.setTimeout(() => {
      setAttempt((n) => n + 1);
      setAlive(true);
    }, 700);
  }, [onFallback]);

  /** Any throw out of the 3D tree costs the board, never the game. */
  const on3DError = useCallback((error: Error) => {
    console.warn('[board] the 3D scene threw; falling back to the flat board', error);
    setFailed(true);
    onFallback();
  }, [onFallback]);

  // A new game in a new session starts flat again while the chunk loads.
  useEffect(() => { if (mode === '2d') setReady(false); }, [mode]);

  /* The flat board stays mounted underneath the canvas as the stand-in, and
   * aria-hidden alone leaves its forty tiles in the tab order: tabbing
   * through a 3D game walked an invisible board. Set as an attribute rather
   * than a prop because React 18's types predate `inert`. */
  useEffect(() => {
    const el = under.current;
    if (!el) return;
    if (ready) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }, [ready]);

  /**
   * A fallback is not a verdict. Asking for the 3D board again from the
   * header is an explicit second opinion, and it used to do nothing at all:
   * `failed` outlived the mode it set, so the toggle stayed dead for the
   * rest of the session and the only way back was a reload.
   */
  useEffect(() => {
    if (mode !== '3d') return;
    setFailed(false);
    losses.current = 0;
    setAlive(true);
  }, [mode]);

  useEffect(() => {
    if (mode === '3d' && !webglAvailable()) { setFailed(true); onFallback(); }
  }, [mode, onFallback]);

  const flat = (
    <Board
      state={state}
      animPos={animPos}
      rolling={rolling}
      onInspect={onInspect}
      highlight={highlight}
    />
  );

  if (mode === '2d' || failed) return flat;

  return (
    <div className="stage3d" data-ready={ready || undefined}>
      {/* The flat board stands in until the 3D chunk and its textures are
          ready, then cross-fades out. */}
      <div className="stage3d__under" ref={under} aria-hidden={ready}>{flat}</div>
      <ErrorBoundary fallback={() => null} onError={on3DError}>
        <Suspense fallback={null}>
          <div className="stage3d__canvas">
            {alive && (
              <Board3D
                key={attempt}
                state={state}
                animPos={animPos}
                rolling={rolling}
                highlight={highlight}
                onInspect={onInspect}
                quality={tier}
                onReady={onSceneReady}
                onContextLost={onContextLost}
              />
            )}
          </div>
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
