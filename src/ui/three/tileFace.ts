import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';
import { GROUP_COLOR } from '../../game/board';
import type { Space } from '../../game/types';
import type { Edge } from './layout';

/* Tile faces are drawn into a canvas and used as a texture rather than
 * rendered with 3D text. One texture per tile keeps the scene at 40 draw
 * calls, the type stays as crisp as the device pixel ratio allows, and the
 * board reuses the typography already established in CSS. */

const PX = 168;               // pixels per world unit of the short edge
const FELT_TOP = '#17402c';
const FELT_BOTTOM = '#0e2a1c';
const INK = '#f2ede0';
const GOLD = '#e0be76';

/** Draw a rounded-rect path (Safari lacks roundRect on older versions). */
function rounded(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/* --------------------------- space glyphs --------------------------- *
 * Drawn with canvas primitives so the 3D board keeps the same iconography
 * as the 2D one without shipping a second set of assets.
 * -------------------------------------------------------------------- */

type Glyph = (c: CanvasRenderingContext2D, s: number) => void;

const GLYPHS: Record<string, Glyph> = {
  chance: (c, s) => {
    c.font = `700 ${s}px Oswald, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('?', 0, 0);
  },
  chest: (c, s) => {
    const w = s * 0.9, h = s * 0.62;
    c.fillRect(-w / 2, -h / 2, w, h);
    c.globalAlpha = 0.45;
    c.fillRect(-w / 2, -h / 2, w, h * 0.34);
    c.globalAlpha = 1;
    c.clearRect(-s * 0.09, -h / 2, s * 0.18, h);
    c.fillRect(-s * 0.09, -h / 2, s * 0.18, h * 0.3);
  },
  railroad: (c, s) => {
    c.fillRect(-s * 0.5, s * 0.28, s, s * 0.12);
    c.fillRect(-s * 0.36, -s * 0.4, s * 0.72, s * 0.6);
    c.globalAlpha = 0.45;
    c.fillRect(-s * 0.26, -s * 0.3, s * 0.52, s * 0.24);
    c.globalAlpha = 1;
    c.beginPath();
    c.arc(-s * 0.2, s * 0.16, s * 0.1, 0, Math.PI * 2);
    c.arc(s * 0.2, s * 0.16, s * 0.1, 0, Math.PI * 2);
    c.fill();
  },
  electric: (c, s) => {
    c.beginPath();
    c.moveTo(s * 0.16, -s * 0.5);
    c.lineTo(-s * 0.28, s * 0.06);
    c.lineTo(-s * 0.02, s * 0.06);
    c.lineTo(-s * 0.16, s * 0.5);
    c.lineTo(s * 0.3, -s * 0.1);
    c.lineTo(s * 0.02, -s * 0.1);
    c.closePath();
    c.fill();
  },
  water: (c, s) => {
    c.beginPath();
    c.moveTo(0, -s * 0.48);
    c.bezierCurveTo(s * 0.42, -s * 0.02, s * 0.32, s * 0.46, 0, s * 0.46);
    c.bezierCurveTo(-s * 0.32, s * 0.46, -s * 0.42, -s * 0.02, 0, -s * 0.48);
    c.fill();
  },
  tax: (c, s) => {
    c.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      const b = a + Math.PI / 5;
      c.lineTo(Math.cos(a) * s * 0.5, Math.sin(a) * s * 0.5);
      c.lineTo(Math.cos(b) * s * 0.22, Math.sin(b) * s * 0.22);
    }
    c.closePath();
    c.fill();
  },
  luxury: (c, s) => {
    c.beginPath();
    c.moveTo(-s * 0.34, -s * 0.2);
    c.lineTo(s * 0.34, -s * 0.2);
    c.lineTo(0, s * 0.44);
    c.closePath();
    c.fill();
    c.globalAlpha = 0.5;
    c.fillRect(-s * 0.4, -s * 0.34, s * 0.8, s * 0.14);
    c.globalAlpha = 1;
  },
  jail: (c, s) => {
    for (const x of [-0.34, -0.12, 0.12, 0.34]) c.fillRect(x * s - s * 0.04, -s * 0.44, s * 0.08, s * 0.88);
    c.fillRect(-s * 0.44, -s * 0.46, s * 0.88, s * 0.08);
    c.fillRect(-s * 0.44, s * 0.38, s * 0.88, s * 0.08);
  },
  parking: (c, s) => {
    c.font = `600 ${s * 1.1}px Oswald, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('P', 0, 0);
  },
  gotojail: (c, s) => {
    c.fillRect(-s * 0.42, -s * 0.44, s * 0.1, s * 0.88);
    c.beginPath();
    c.moveTo(-s * 0.3, -s * 0.4);
    c.lineTo(s * 0.44, -s * 0.4);
    c.lineTo(s * 0.28, -s * 0.16);
    c.lineTo(s * 0.44, s * 0.08);
    c.lineTo(-s * 0.3, s * 0.08);
    c.closePath();
    c.fill();
  },
  go: (c, s) => {
    c.beginPath();
    c.moveTo(-s * 0.44, -s * 0.14);
    c.lineTo(s * 0.06, -s * 0.14);
    c.lineTo(s * 0.06, -s * 0.4);
    c.lineTo(s * 0.46, 0);
    c.lineTo(s * 0.06, s * 0.4);
    c.lineTo(s * 0.06, s * 0.14);
    c.lineTo(-s * 0.44, s * 0.14);
    c.closePath();
    c.fill();
  },
};

const KIND_GLYPH: Record<string, string> = {
  go: 'go', chance: 'chance', chest: 'chest', jail: 'jail',
  freeparking: 'parking', gotojail: 'gotojail', railroad: 'railroad',
};
const ID_GLYPH: Record<number, string> = { 4: 'tax', 12: 'electric', 28: 'water', 38: 'luxury' };

/** Fit a line of text to a width by stepping the size down. */
function fitText(c: CanvasRenderingContext2D, text: string, max: number, start: number): number {
  let size = start;
  do {
    c.font = `400 ${size}px Oswald, "Arial Narrow", sans-serif`;
    if (c.measureText(text).width <= max) return size;
    size -= 1;
  } while (size > 7);
  return size;
}

/**
 * Build the top-face texture for one space.
 * `sx`/`sz` are the tile's world footprint; the drawing is pre-rotated for
 * the edge it sits on, so the mesh needs no UV trickery.
 */
export function makeTileFace(space: Space, sx: number, sz: number, edge: Edge): CanvasTexture {
  const dpr = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sx * PX * dpr);
  canvas.height = Math.round(sz * PX * dpr);
  const c = canvas.getContext('2d')!;
  c.scale(dpr, dpr);

  const W = sx * PX;
  const H = sz * PX;

  // Work in a space where the tile is always "upright": short edge across,
  // long edge down, colour band at the top.
  const upright = edge === 'bottom' || edge === 'top';
  const w = upright ? W : H;
  const h = upright ? H : W;

  c.save();
  c.translate(W / 2, H / 2);
  c.rotate(edge === 'top' ? Math.PI : edge === 'left' ? Math.PI / 2 : edge === 'right' ? -Math.PI / 2 : 0);
  c.translate(-w / 2, -h / 2);

  // Felt
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, FELT_TOP);
  g.addColorStop(1, FELT_BOTTOM);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);

  // Weave
  c.globalAlpha = 0.05;
  c.fillStyle = '#ffffff';
  for (let y = 0; y < h; y += 3) c.fillRect(0, y, w, 1);
  c.globalAlpha = 1;

  const isCorner = space.id % 10 === 0;
  const bandH = Math.round(h * 0.22);

  if (space.group) {
    c.fillStyle = GROUP_COLOR[space.group];
    c.fillRect(0, 0, w, bandH);
    const gloss = c.createLinearGradient(0, 0, 0, bandH);
    gloss.addColorStop(0, 'rgba(255,255,255,0.38)');
    gloss.addColorStop(0.5, 'rgba(255,255,255,0.04)');
    gloss.addColorStop(1, 'rgba(0,0,0,0.22)');
    c.fillStyle = gloss;
    c.fillRect(0, 0, w, bandH);
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fillRect(0, bandH - 1.5, w, 1.5);
  }

  const top = space.group ? bandH : 0;
  const bodyH = h - top;
  c.translate(0, top);

  // Glyph
  const glyphKey = ID_GLYPH[space.id] ?? KIND_GLYPH[space.kind];
  let textTop = bodyH * (isCorner ? 0.5 : 0.3);
  if (glyphKey && GLYPHS[glyphKey]) {
    const size = Math.min(w * 0.42, bodyH * 0.3);
    c.save();
    c.translate(w / 2, bodyH * (isCorner ? 0.3 : 0.24));
    c.fillStyle = GOLD;
    GLYPHS[glyphKey](c, size);
    c.restore();
    textTop = bodyH * (isCorner ? 0.62 : 0.52);
  }

  // Name, wrapped at spaces and fitted so nothing ever breaks mid-word.
  c.fillStyle = INK;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const maxW = w * 0.88;
  const words = space.short.toUpperCase().split(' ');
  // Start high and let fitText step down: short names should not be pinned
  // to the size that a 13-character name happens to need.
  const size = Math.min(...words.map((word) => fitText(c, word, maxW, isCorner ? 30 : 24)));
  c.font = `400 ${size}px Oswald, "Arial Narrow", sans-serif`;

  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (c.measureText(next).width <= maxW) line = next;
    else { if (line) lines.push(line); line = word; }
  }
  if (line) lines.push(line);

  c.shadowColor = 'rgba(0,0,0,0.6)';
  c.shadowOffsetY = 1;
  lines.forEach((l, i) => {
    c.fillText(l, w / 2, textTop + i * size * 1.12);
  });
  c.shadowColor = 'transparent';

  // Price
  if (space.price != null || space.taxAmount != null) {
    c.fillStyle = GOLD;
    c.font = `500 ${size * 0.78}px "Roboto Mono", monospace`;
    const label = space.taxAmount != null ? `PAY ${space.taxAmount}` : `${space.price}`;
    c.fillText(label, w / 2, bodyH * 0.86);
  }

  // Inner keyline, so each plaque reads as a separate inlay.
  c.translate(0, -top);
  c.strokeStyle = 'rgba(255,255,255,0.10)';
  c.lineWidth = 1;
  rounded(c, 1.5, 1.5, w - 3, h - 3, 3);
  c.stroke();

  c.restore();

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  // Mipmaps matter here: the far row of tiles is only ~40px on screen, and
  // unfiltered text at that scale aliases into unreadable noise.
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = 16;
  return tex;
}
