import { useEffect, useMemo, useRef } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import type { GameState } from '../../game/types';
import { BASE_H, HALF, type Edge } from './layout';

/* ------------------------------------------------------------------ *
 * The people at the table.
 *
 * The board knew who was playing; the table did not. Every seat was drawn
 * on the felt as a token and nowhere else, so a game of six read as six
 * counters rather than six players sitting around something. These are the
 * name plates that would be in front of each of them: their colour, their
 * name, what they are holding, laid on the wood at their own edge.
 *
 * Drawn, not downloaded - a canvas per plate, the same way every tile face
 * in this scene is made. Nothing new is fetched to render a person.
 * ------------------------------------------------------------------ */

/** Which edge a seat sits at. Seat n is a quarter turn past seat n-1, so
 *  this is the same walk round the table that `seatYaw` does for the
 *  camera - the plate and the viewpoint have to agree or you would be
 *  looking at somebody else's plate from your own chair. */
const EDGES: Edge[] = ['bottom', 'right', 'top', 'left'];

export function seatEdge(index: number): Edge {
  return EDGES[index % 4];
}

/** Canvas rotation that makes a plate read from its own edge, matching the
 *  convention `makeTileFace` uses for tile text. */
function edgeSpin(edge: Edge): number {
  return edge === 'top' ? Math.PI
    : edge === 'left' ? Math.PI / 2
      : edge === 'right' ? -Math.PI / 2 : 0;
}

let plateDprCap = 2;

/** Matches the tile faces: half the texture on the tier that renders at 1.4x. */
export function setPlateQuality(quality: 'high' | 'low'): void {
  plateDprCap = quality === 'high' ? 2 : 1;
}

const PLATE_W = 2.3;
const PLATE_H = 0.7;
const PX = 190;

/** Distance from the board centre to a plate's centre. */
export const PLATE_DIST = HALF + 0.52;
/** How far the plates reach outward, and how wide they run along an edge.
 *  The camera needs both: framing only the board cropped the near plate. */
export const PLATE_REACH = PLATE_DIST + PLATE_H / 2;
export const PLATE_SPAN = (PLATE_W + 0.35) / 2 + PLATE_W / 2;

function makePlate(
  name: string, cash: string, color: string, edge: Edge,
  active: boolean, out: boolean, outLabel: string,
): CanvasTexture {
  const dpr = Math.min(plateDprCap, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  const upright = edge === 'bottom' || edge === 'top';
  const W = PLATE_W * PX;
  const H = PLATE_H * PX;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round((upright ? W : H) * dpr);
  canvas.height = Math.round((upright ? H : W) * dpr);
  const c = canvas.getContext('2d')!;
  c.scale(dpr, dpr);

  // Work upright, then let the rotation put it the right way up for its edge.
  c.save();
  c.translate((upright ? W : H) / 2, (upright ? H : W) / 2);
  c.rotate(edgeSpin(edge));
  c.translate(-W / 2, -H / 2);

  const r = 14;
  c.beginPath();
  c.moveTo(r, 0);
  c.arcTo(W, 0, W, H, r);
  c.arcTo(W, H, 0, H, r);
  c.arcTo(0, H, 0, 0, r);
  c.arcTo(0, 0, W, 0, r);
  c.closePath();

  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, out ? '#161613' : '#1b2119');
  g.addColorStop(1, out ? '#0d0d0b' : '#0e1410');
  c.fillStyle = g;
  c.fill();

  c.globalAlpha = out ? 0.35 : 1;

  // The player's colour, as a bar down the leading edge.
  c.fillStyle = color;
  c.fillRect(0, 0, 12, H);

  c.fillStyle = out ? '#6f6a60' : '#efe9dd';
  c.font = `600 ${H * 0.34}px Oswald, "Arial Narrow", sans-serif`;
  c.textBaseline = 'middle';
  const label = out ? `${name} — ${outLabel}` : name;
  c.fillText(label, 30, H * 0.36, W - 46);

  c.fillStyle = out ? '#5c584f' : '#c8912f';
  c.font = `500 ${H * 0.3}px "Roboto Mono", monospace`;
  c.fillText(cash, 30, H * 0.72, W - 46);

  c.globalAlpha = 1;

  // Whose turn it is, said on the table rather than only in the rail.
  if (active && !out) {
    c.strokeStyle = '#e8b448';
    c.lineWidth = 3;
    c.stroke();
  }
  c.restore();

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function Plate({
  x, z, edge, texture,
}: { x: number; z: number; edge: Edge; texture: CanvasTexture }) {
  const upright = edge === 'bottom' || edge === 'top';
  return (
    <mesh
      position={[x, -BASE_H / 2 + 0.004, z]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
    >
      <planeGeometry args={upright ? [PLATE_W, PLATE_H] : [PLATE_H, PLATE_W]} />
      {/* Unlit on purpose: a plate that dims with the room stops being
          readable, and this is the one thing on the table that is text. */}
      <meshBasicMaterial map={texture} transparent toneMapped={false} />
    </mesh>
  );
}

export function SeatPlates({ state, outLabel }: {
  state: GameState;
  /** "out", in the reader's language. A prop rather than a hook: this
   *  renders inside the Canvas, under a different React renderer. */
  outLabel: string;
}) {
  /* Textures are cached per player and rebuilt only when what is printed on
   * them changes.
   *
   * The first version keyed a useMemo on `state.players`, which the reducer
   * replaces on every action - so all six plates were redrawn into fresh
   * canvases and re-uploaded to the GPU on every roll, every rent payment,
   * every card. None of that was visible; all of it was paid for, and paid
   * for hardest on a phone. Now a plate is redrawn when its own name, money,
   * colour, turn or fortunes change, and not otherwise. */
  const cache = useRef(new Map<string, { sig: string; texture: CanvasTexture }>());
  /* Nothing is freed while rendering. React runs a render function more than
   * once under StrictMode and may throw a pass away entirely, and a texture
   * disposed by a pass that never commits is a texture the committed scene
   * is still drawing with - a plate that goes black for no reason anyone
   * could reproduce. Replaced textures wait here and are freed after the
   * commit that stopped using them. */
  const retired = useRef<CanvasTexture[]>([]);

  const plates = useMemo(() => {
    const perEdge = new Map<Edge, number>();
    for (let i = 0; i < state.seats.length; i++) {
      const e = seatEdge(i);
      perEdge.set(e, (perEdge.get(e) ?? 0) + 1);
    }
    const used = new Map<Edge, number>();
    const dist = PLATE_DIST;
    const live = new Set<string>();

    const out = state.seats.map((id, i) => {
      const p = state.players[id];
      const edge = seatEdge(i);
      const total = perEdge.get(edge) ?? 1;
      const nth = used.get(edge) ?? 0;
      used.set(edge, nth + 1);
      const spread = total > 1 ? (nth - (total - 1) / 2) * (PLATE_W + 0.35) : 0;

      const active = state.seats[state.seatIndex] === id;
      const cash = `$${p.cash.toLocaleString('en-US')}`;
      const sig = `${p.name}|${cash}|${p.color}|${edge}|${active ? 1 : 0}|${p.bankrupt ? 1 : 0}|${outLabel}`;

      live.add(id);
      let entry = cache.current.get(id);
      if (!entry || entry.sig !== sig) {
        if (entry) retired.current.push(entry.texture);
        entry = { sig, texture: makePlate(p.name, cash, p.color, edge, active, p.bankrupt, outLabel) };
        cache.current.set(id, entry);
      }

      const pos: Record<Edge, [number, number]> = {
        bottom: [spread, dist],
        top: [spread, -dist],
        right: [dist, spread],
        left: [-dist, spread],
      };
      const [x, z] = pos[edge];
      return { key: id, x, z, edge, texture: entry.texture };
    });

    // A player who left takes their texture with them - after the commit.
    for (const [id, entry] of cache.current) {
      if (!live.has(id)) { retired.current.push(entry.texture); cache.current.delete(id); }
    }
    return out;
  }, [state.seats, state.players, state.seatIndex, outLabel]);

  // Free what the last commit stopped using.
  useEffect(() => {
    if (retired.current.length === 0) return;
    for (const t of retired.current) t.dispose();
    retired.current = [];
  });

  // And everything, on the way out.
  useEffect(() => () => {
    for (const entry of cache.current.values()) entry.texture.dispose();
    cache.current.clear();
  }, []);

  return (
    <group>
      {plates.map((p) => (
        <Plate key={p.key} x={p.x} z={p.z} edge={p.edge} texture={p.texture} />
      ))}
    </group>
  );
}
