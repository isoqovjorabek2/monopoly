import { cellOf } from '../Board';

/* Board layout in world units. These are the same numbers the CSS grid
 * uses (corner tracks of 1.62fr, nine tracks of 1fr), so the 2D and 3D
 * boards are literally the same board seen two ways. */

export const CORNER = 1.62;
export const UNIT = 1;
export const TOTAL = CORNER * 2 + 9;   // 12.24
export const HALF = TOTAL / 2;

export const TILE_H = 0.14;            // plaque thickness
export const BASE_H = 0.55;            // the block the plaques sit on

/** Centre of grid track k (1-indexed), in units from the board's near edge. */
function trackCentre(k: number): number {
  if (k === 1) return CORNER / 2;
  if (k === 11) return CORNER + 9 + CORNER / 2;
  return CORNER + (k - 2) + 0.5;
}

export type Edge = 'bottom' | 'left' | 'top' | 'right';

export interface TileLayout {
  x: number;
  z: number;
  sx: number;
  sz: number;
  edge: Edge;
  corner: boolean;
}

/** World placement and footprint for a space id. */
export function tileLayout(id: number): TileLayout {
  const { col, row } = cellOf(id);
  const sx = col === 1 || col === 11 ? CORNER : UNIT;
  const sz = row === 1 || row === 11 ? CORNER : UNIT;

  // Row 11 is nearest the camera, so it reads as the bottom edge - matching
  // the 2D board exactly, which is what keeps cellOf() reusable.
  const edge: Edge = row === 11 ? 'bottom'
    : row === 1 ? 'top'
      : col === 1 ? 'left' : 'right';

  return {
    x: trackCentre(col) - HALF,
    z: trackCentre(row) - HALF,
    sx,
    sz,
    edge,
    corner: id % 10 === 0,
  };
}

/** Where a player's piece stands on a space, fanned so pieces never overlap. */
export function tokenPosition(id: number, index: number): [number, number, number] {
  const { x, z } = tileLayout(id);
  const dx = ((index % 3) - 1) * 0.3;
  const dz = (Math.floor(index / 3) - 0.5) * 0.3;
  return [x + dx, BASE_H / 2 + TILE_H, z + dz];
}

/** Where buildings sit on an improved property: along the inner edge. */
export function buildingPositions(id: number, count: number): [number, number, number][] {
  const { x, z, edge } = tileLayout(id);
  const inward = 0.56;
  const spread = 0.19;
  const out: [number, number, number][] = [];
  const y = BASE_H / 2 + TILE_H;

  for (let i = 0; i < count; i++) {
    const offset = (i - (count - 1) / 2) * spread;
    switch (edge) {
      case 'bottom': out.push([x + offset, y, z - inward]); break;
      case 'top': out.push([x + offset, y, z + inward]); break;
      case 'left': out.push([x + inward, y, z + offset]); break;
      case 'right': out.push([x - inward, y, z + offset]); break;
    }
  }
  return out;
}

/** Y-rotation that turns a tile's face toward the middle of the board. */
export function faceRotation(edge: Edge): number {
  switch (edge) {
    case 'bottom': return 0;
    case 'left': return Math.PI / 2;
    case 'top': return Math.PI;
    case 'right': return -Math.PI / 2;
  }
}
