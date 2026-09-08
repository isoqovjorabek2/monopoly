import { useEffect, useRef, useState } from 'react';
import { FX_FRAMES, fxStrip, type FxName } from '../art/art';

/* ------------------------------------------------------------------ *
 * One-shot table effects.
 *
 * Each effect is sixteen frames of a generated clip in a single strip;
 * CSS steps() walks it once and the element unmounts. No <video>, no
 * decoder, no alpha channel - the strips were rendered on black and are
 * composited with `screen`, so the black falls away over the dark table.
 *
 * Everything here is decoration: it sits behind pointer events, honours
 * prefers-reduced-motion by not playing at all, and never blocks a turn.
 * ------------------------------------------------------------------ */

const DURATION_MS = 1400;

function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export interface FxRequest {
  /** Distinct per firing, so the same effect twice in a row replays. */
  key: number;
  name: FxName;
}

export function FxLayer({ request }: { request: FxRequest | null }) {
  const [live, setLive] = useState<FxRequest | null>(null);

  useEffect(() => {
    if (!request || reducedMotion()) return;
    setLive(request);
    const t = window.setTimeout(() => setLive(null), DURATION_MS);
    return () => window.clearTimeout(t);
  }, [request]);

  if (!live) return null;

  return (
    <div className="fx" aria-hidden="true">
      <span
        key={live.key}
        className="fx__strip"
        data-fx={live.name}
        style={{
          backgroundImage: `url("${fxStrip(live.name)}")`,
          // The strip is FX_FRAMES cells wide, so the element shows one
          // cell and the keyframes walk it a whole strip's width.
          backgroundSize: `${FX_FRAMES * 100}% 100%`,
          animationDuration: `${DURATION_MS}ms`,
        }}
      />
    </div>
  );
}

/**
 * Fires an effect when `trigger` changes to a new truthy value. Returns a
 * request whose key changes on every firing so repeats always replay.
 */
export function useFx(): [FxRequest | null, (name: FxName) => void] {
  const [request, setRequest] = useState<FxRequest | null>(null);
  const seq = useRef(0);
  const fire = (name: FxName) => {
    seq.current += 1;
    setRequest({ key: seq.current, name });
  };
  return [request, fire];
}
