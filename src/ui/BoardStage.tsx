import { Suspense, lazy, useEffect, useState } from 'react';
import type { GameState } from '../game/types';
import { Board } from './Board';

/* The 3D board is code-split: three.js is roughly the size of the rest of
 * the app, and a player who stays in 2D should never download it. */
const Board3D = lazy(() => import('./three/Board3D'));

export type RenderMode = '3d' | '2d';

/** Cheap capability probe. A context that fails to create means 3D is not
 *  an option at all, whatever the preference says. */
function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      canvas.getContext('webgl2') ?? canvas.getContext('webgl'),
    );
  } catch {
    return false;
  }
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

  // A new game in a new session starts flat again while the chunk loads.
  useEffect(() => { if (mode === '2d') setReady(false); }, [mode]);

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
      <div className="stage3d__under" aria-hidden={ready}>{flat}</div>
      <Suspense fallback={null}>
        <div className="stage3d__canvas">
          <Board3D
            state={state}
            animPos={animPos}
            rolling={rolling}
            highlight={highlight}
            onInspect={onInspect}
            quality={tier}
            onReady={() => setReady(true)}
          />
        </div>
      </Suspense>
    </div>
  );
}
