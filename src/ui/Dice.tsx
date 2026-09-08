import { useEffect, useRef, useState } from 'react';

/* CSS 3D dice. The result is decided by the engine before the animation
 * starts - this component only reads it. Anything else desyncs. */

const FACE_ROTATION: Record<number, [number, number]> = {
  1: [0, 0],
  2: [-90, 0],
  3: [0, 90],
  4: [0, -90],
  5: [90, 0],
  6: [180, 0],
};

/** Which of the nine grid cells carry pips, per face value. */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function Face({ value, className }: { value: number; className: string }) {
  const on = new Set(PIPS[value]);
  return (
    <div className={className}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className="pip" style={{ visibility: on.has(i) ? 'visible' : 'hidden' }} />
      ))}
    </div>
  );
}

function Die({ value, spinKey, extraSpin }: { value: number; spinKey: number; extraSpin: number }) {
  const [x, y] = FACE_ROTATION[value] ?? [0, 0];
  // Extra whole turns make the tumble read as a throw rather than a flip.
  const rx = x + 360 * (2 + extraSpin);
  const ry = y + 360 * (2 + extraSpin);
  return (
    <div className="die" style={{ transform: `rotateX(${rx}deg) rotateY(${ry}deg)` }} key={spinKey}>
      <Face value={1} className="die__face die__face--1" />
      <Face value={2} className="die__face die__face--2" />
      <Face value={3} className="die__face die__face--3" />
      <Face value={4} className="die__face die__face--4" />
      <Face value={5} className="die__face die__face--5" />
      <Face value={6} className="die__face die__face--6" />
    </div>
  );
}

export function Dice({ dice, rolling }: { dice: [number, number] | null; rolling: boolean }) {
  const [spin, setSpin] = useState(0);
  const last = useRef<string>('');

  useEffect(() => {
    const key = dice ? dice.join(',') : 'none';
    if (key !== last.current) {
      last.current = key;
      setSpin((s) => s + 1);
    }
  }, [dice]);

  const [a, b] = dice ?? [1, 1];

  return (
    <div
      className="diceTray"
      data-rolling={rolling || undefined}
      role="status"
      aria-live="polite"
      aria-label={dice ? `Rolled ${a} and ${b}` : 'Dice ready'}
      style={{ opacity: dice ? 1 : 0.35 }}
    >
      <Die value={a} spinKey={spin} extraSpin={0} />
      <Die value={b} spinKey={spin} extraSpin={1} />
    </div>
  );
}
