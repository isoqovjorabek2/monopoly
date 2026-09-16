import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, LinearFilter, SRGBColorSpace, type Group, type Mesh } from 'three';
import type { SkinId } from '../../game/types';

/* The engine decides the roll before anything moves. These dice only play
 * the throw and land showing the value they were given - the animation is
 * never allowed to produce a result. */

/** How a finish (Party Hall Plus) prints the dice: the stock, the pips, and
 *  what the surface does with light. Neon pips glow in the roller's colour. */
const LOOK: Record<SkinId, {
  face: [string, string]; pip: [string, string]; roughness: number; metalness: number; opacity?: number; glow?: boolean;
}> = {
  classic: { face: ['#fdfaf2', '#e4dcc8'], pip: ['#5a5044', '#14100a'], roughness: 0.35, metalness: 0.05 },
  mirror: { face: ['#f6f8fa', '#a4adb5'], pip: ['#3a3f44', '#0c0e10'], roughness: 0.08, metalness: 0.85 },
  glass: { face: ['#eaf6ff', '#b8d5ea'], pip: ['#ffffff', '#cfe3f1'], roughness: 0.05, metalness: 0, opacity: 0.72 },
  neon: { face: ['#11181b', '#06090b'], pip: ['#ffffff', '#ffffff'], roughness: 0.4, metalness: 0.2, glow: true },
  gilded: { face: ['#f6dc8e', '#b8872f'], pip: ['#5a3d0c', '#1c1204'], roughness: 0.2, metalness: 0.85 },
};

function pipTexture(value: number, finish: SkinId, glowColor: string): CanvasTexture {
  const look = LOOK[finish];
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const c = canvas.getContext('2d')!;

  const g = c.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, look.face[0]);
  g.addColorStop(1, look.face[1]);
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);

  const spots: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]],
    2: [[0.27, 0.27], [0.73, 0.73]],
    3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
    4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
    5: [[0.26, 0.26], [0.74, 0.26], [0.5, 0.5], [0.26, 0.74], [0.74, 0.74]],
    6: [[0.28, 0.24], [0.28, 0.5], [0.28, 0.76], [0.72, 0.24], [0.72, 0.5], [0.72, 0.76]],
  };

  for (const [x, y] of spots[value] ?? []) {
    const r = S * 0.085;
    if (look.glow) {
      c.shadowColor = glowColor;
      c.shadowBlur = S * 0.09;
      c.fillStyle = glowColor;
    } else {
      const rg = c.createRadialGradient(x * S - r * 0.3, y * S - r * 0.3, r * 0.1, x * S, y * S, r);
      rg.addColorStop(0, look.pip[0]);
      rg.addColorStop(1, look.pip[1]);
      c.fillStyle = rg;
    }
    c.beginPath();
    c.arc(x * S, y * S, r, 0, Math.PI * 2);
    c.fill();
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Rotation that brings a given value to face up (+Y).
 * Faces are laid out [+X, -X, +Y, -Y, +Z, -Z] = [4, 3, 2, 5, 1, 6], so:
 *   +Y is already up          -> 2 needs no rotation
 *   Rz(+90) maps +X to +Y     -> 4
 *   Rz(-90) maps -X to +Y     -> 3
 *   Rx(-90) maps +Z to +Y     -> 1
 *   Rx(+90) maps -Z to +Y     -> 6
 *   Rx(180) maps -Y to +Y     -> 5
 */
const FACE_UP: Record<number, [number, number, number]> = {
  1: [-Math.PI / 2, 0, 0],
  2: [0, 0, 0],
  3: [0, 0, -Math.PI / 2],
  4: [0, 0, Math.PI / 2],
  5: [Math.PI, 0, 0],
  6: [Math.PI / 2, 0, 0],
};

function Die({
  value, offset, seed, rolling, finish, glowColor,
}: { value: number; offset: number; seed: number; rolling: boolean; finish: SkinId; glowColor: string }) {
  const mesh = useRef<Mesh>(null);
  const t = useRef(1);
  const from = useRef<[number, number, number]>([0, 0, 0]);
  const look = LOOK[finish];

  // BoxGeometry material order is +X -X +Y -Y +Z -Z. Opposite faces of a die
  // always sum to seven.
  const textures = useMemo(
    () => [4, 3, 2, 5, 1, 6].map((v) => pipTexture(v, finish, glowColor)),
    [finish, glowColor],
  );
  useEffect(() => () => textures.forEach((x) => x.dispose()), [textures]);

  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    if (rolling) {
      from.current = [m.rotation.x, m.rotation.y, m.rotation.z];
      t.current = 0;
      return;
    }
    // Not rolling: snap to the value. Without this a die keeps whatever
    // rotation it happened to have - so a player joining mid-turn, or any
    // state restored without a roll animation, would see a face the engine
    // never rolled. The dice must always report the truth.
    const [x, y, z] = FACE_UP[value] ?? [0, 0, 0];
    m.rotation.set(x, y, z);
    m.position.y = 0.34;
    t.current = 1;
  }, [rolling, value]);

  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m) return;
    if (t.current >= 1) return;

    t.current = Math.min(1, t.current + dt * 1.5);
    const e = 1 - (1 - t.current) ** 3;

    const [tx, ty, tz] = FACE_UP[value] ?? [0, 0, 0];
    const spins = 3 + (seed % 3);
    m.rotation.x = from.current[0] + (tx + Math.PI * 2 * spins - from.current[0]) * e;
    m.rotation.y = from.current[1] + (ty + Math.PI * 2 * (spins + 1) - from.current[1]) * e;
    m.rotation.z = from.current[2] + (tz + Math.PI * 2 * spins - from.current[2]) * e;

    // Toss arc: up and back down onto the felt.
    m.position.y = 0.34 + Math.sin(Math.PI * t.current) * 1.5;
  });

  return (
    <mesh ref={mesh} position={[offset, 0.34, 0]} castShadow>
      <boxGeometry args={[0.52, 0.52, 0.52]} />
      {textures.map((tex, i) => (
        <meshStandardMaterial
          key={i}
          attach={`material-${i}`}
          map={tex}
          roughness={look.roughness}
          metalness={look.metalness}
          transparent={look.opacity !== undefined}
          opacity={look.opacity ?? 1}
          emissive={look.glow ? '#ffffff' : '#000000'}
          emissiveMap={look.glow ? tex : undefined}
          emissiveIntensity={look.glow ? 0.9 : 0}
          toneMapped={!look.glow}
        />
      ))}
    </mesh>
  );
}

export function Dice3D({
  dice, rolling, finish = 'classic', color = '#39ffb0',
}: { dice: [number, number] | null; rolling: boolean; finish?: SkinId; color?: string }) {
  const group = useRef<Group>(null);
  if (!dice) return null;
  return (
    <group ref={group}>
      <Die value={dice[0]} offset={-0.45} seed={dice[0]} rolling={rolling} finish={finish} glowColor={color} />
      <Die value={dice[1]} offset={0.45} seed={dice[1] + 1} rolling={rolling} finish={finish} glowColor={color} />
    </group>
  );
}
