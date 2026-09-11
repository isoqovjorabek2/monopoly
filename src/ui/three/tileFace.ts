import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';
import { GROUP_COLOR } from '../../game/board';
import { CORNER_EMBLEM, cornerArt, groupArt, type GroupMotif } from '../../art/art';
import type { Space } from '../../game/types';
import type { Edge } from './layout';

/* Tile faces are drawn into a canvas and used as a texture rather than
 * rendered with 3D text. One texture per tile keeps the scene at 40 draw
 * calls, the type stays as crisp as the device pixel ratio allows, and the
 * board reuses the typography already established in CSS. */

/* Pixels per world unit of the short edge.
 *
 * Left at 168 deliberately. The far row being unreadable looks like a
 * resolution problem and is not one: a tile renders to roughly 40-90 screen
 * pixels, against 168-336 texels of texture, so the face is already
 * oversampled several times over and the GPU is picking a mip level well
 * below the one drawn. Raising this costs texture memory on every device
 * and changes nothing anyone can see. What was actually wrong is that the
 * type was too light and too small to survive that downsampling. */
const PX = 168;               // pixels per world unit of the short edge

/* How many device pixels a face is drawn at, per world pixel.
 *
 * Forty faces at a 2x cap is about 23MB of texture memory once mipmaps are
 * counted; at 1x it is under 6MB. The low tier renders the whole board at
 * around 1.4x and a tile covers roughly fifty screen pixels there, so a
 * 336px face was being minified to a seventh of its size - paying for detail
 * no phone can show, on exactly the devices least able to spare the memory.
 * Set once from the renderer's own quality tier. */
let faceDprCap = 2;

export function setFaceQuality(quality: 'high' | 'low'): void {
  faceDprCap = quality === 'high' ? 2 : 1;
}
const FELT_TOP = '#17402c';
const FELT_BOTTOM = '#0e2a1c';
const INK = '#f2ede0';
const GOLD = '#e0be76';

/* ------------------------- generated art ---------------------------- *
 * The set motifs and corner emblems are raster, and a face is drawn into
 * its canvas synchronously the moment the tile mounts. So the faces are
 * drawn once without them, the images load in the background, and the
 * caller is told to draw again.
 *
 * That ordering is the point: a face that waits on a network image is a
 * board that does not appear, and a 404 has to cost the ornament and
 * nothing else. Same contract as useArtTexture, reached a different way
 * because this side is a canvas rather than a three loader.
 * -------------------------------------------------------------------- */

const images = new Map<string, HTMLImageElement>();
const listeners = new Set<() => void>();
let pending = 0;

function art(url: string): HTMLImageElement | null {
  const known = images.get(url);
  if (known) return known.naturalWidth > 0 ? known : null;

  const img = new Image();
  images.set(url, img);
  pending += 1;
  const done = () => {
    pending -= 1;
    // One notification for the whole set, not one per file: each costs a
    // rebuild of all forty canvas textures.
    if (pending === 0) listeners.forEach((f) => f());
  };
  img.onload = done;
  img.onerror = done;
  img.src = url;
  return null;
}

/** Subscribe to "the generated art has landed, draw the faces again". */
export function onFaceArtReady(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function motifFor(space: Space): GroupMotif | null {
  if (space.group) return space.group;
  if (space.kind === 'railroad') return 'railroad';
  if (space.kind === 'utility') return 'utility';
  return null;
}

/** Draw generated art the way the rest of the board composites it: it is
 *  engraved on black, so adding it leaves the felt underneath untouched
 *  and only the metal lights up. No alpha channel anywhere. */
function engrave(
  c: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cx: number, cy: number, size: number, alpha: number,
) {
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.globalAlpha = alpha;
  c.drawImage(img, cx - size / 2, cy - size / 2, size, size);
  c.restore();
}

/**
 * The colour band as an emissive map: its colour on black, nothing else.
 *
 * A printed board's colour bands are ink, and ink in a dimly lit room goes
 * dark. These are inlay - they hold their colour in shadow, which is what
 * lets you read the sets from across the table at an angle where the
 * lights are not helping. Everything black in this map emits nothing, so
 * one texture lights exactly the strip that should be lit.
 *
 * Deliberately tiny: it is one flat rectangle, not type, so it costs a few
 * hundred bytes of GPU memory per tile rather than a few hundred KB.
 */
export function makeTileEmissive(
  space: Space, sx: number, sz: number, edge: Edge,
): CanvasTexture | null {
  if (!space.group) return null;

  const canvas = document.createElement('canvas');
  const W = Math.max(8, Math.round(sx * 24));
  const H = Math.max(8, Math.round(sz * 24));
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#000000';
  c.fillRect(0, 0, W, H);

  // Same upright space and rotation the face uses, so the strip lands on
  // the same pixels the band was painted on.
  const upright = edge === 'bottom' || edge === 'top';
  const w = upright ? W : H;
  const h = upright ? H : W;
  c.save();
  c.translate(W / 2, H / 2);
  c.rotate(edge === 'top' ? Math.PI : edge === 'left' ? Math.PI / 2 : edge === 'right' ? -Math.PI / 2 : 0);
  c.translate(-w / 2, -h / 2);
  c.fillStyle = GROUP_COLOR[space.group];
  c.fillRect(0, 0, w, Math.round(h * 0.22));
  c.restore();

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

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
 * the edge it sits on, so the mesh needs no UV trickery. `text` is what is
 * printed on it, already in the reader's language - the face is a canvas,
 * so it is drawn again when that changes.
 */
export function makeTileFace(
  space: Space, sx: number, sz: number, edge: Edge,
  text: { name: string; tax: string | null },
): CanvasTexture {
  const dpr = Math.min(faceDprCap, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
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
    // A lighter hand than before: a 38% white highlight over the whole top
    // half of the band is most of why the colours read washed out in 3D
    // next to the same colours on the flat board.
    const gloss = c.createLinearGradient(0, 0, 0, bandH);
    gloss.addColorStop(0, 'rgba(255,255,255,0.20)');
    gloss.addColorStop(0.45, 'rgba(255,255,255,0.02)');
    gloss.addColorStop(1, 'rgba(0,0,0,0.26)');
    c.fillStyle = gloss;
    c.fillRect(0, 0, w, bandH);
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fillRect(0, bandH - 1.5, w, 1.5);
  }

  const top = space.group ? bandH : 0;
  const bodyH = h - top;
  c.translate(0, top);

  /* The set's ornament, under everything the player has to read. The
   * corners take their own emblem instead: they have no name worth
   * protecting and the whole square to give it. */
  const emblem = CORNER_EMBLEM[space.id];
  if (emblem) {
    const img = art(cornerArt(emblem));
    if (img) engrave(c, img, w / 2, bodyH * 0.44, Math.min(w, bodyH) * 0.92, 0.85);
  } else {
    const motif = motifFor(space);
    const img = motif && art(groupArt(motif));
    if (img) engrave(c, img, w / 2, bodyH * 0.52, Math.min(w * 1.25, bodyH * 0.95), 0.4);
  }

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
  const words = text.name.toUpperCase().split(' ');
  // Start high and let fitText step down: short names should not be pinned
  // to the size that a 13-character name happens to need.
  const size = Math.min(...words.map((word) => fitText(c, word, maxW, isCorner ? 34 : 29)));
  // 600, not 400. Oswald's regular is a thin condensed face: lovely at the
  // size a deed card shows it and gone entirely by the time the far row has
  // foreshortened it to a few pixels tall. Weight is what survives distance.
  c.font = `600 ${size}px Oswald, "Arial Narrow", sans-serif`;

  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (c.measureText(next).width <= maxW) line = next;
    else { if (line) lines.push(line); line = word; }
  }
  if (line) lines.push(line);

  // Heavier than it was: the type now sits over engraved ornament rather
  // than flat felt, and a thin shadow is not enough to lift it off.
  /* Separation by outline, not by blur.
   *
   * A blurred drop shadow is the obvious way to lift type off a busy
   * ground and the wrong one here: it puts a soft dark halo around every
   * glyph, and once the face is minified to the ~9 screen pixels a tile
   * name actually gets, that halo is a large fraction of the letter. The
   * glyph edge and its shadow average together and the result reads as
   * out of focus - which is exactly what it looked like.
   *
   * A hard stroke keeps the same separation with an edge the downsample
   * can preserve. Drawn under the fill so it never thins the letter. */
  c.lineJoin = 'round';
  c.miterLimit = 2;
  c.lineWidth = Math.max(2.5, size * 0.2);
  c.strokeStyle = 'rgba(0,0,0,0.9)';
  lines.forEach((l, i) => {
    const y = textTop + i * size * 1.12;
    c.strokeText(l, w / 2, y);
    c.fillText(l, w / 2, y);
  });

  // Price
  if (space.price != null || space.taxAmount != null) {
    c.font = `500 ${size * 0.78}px "Roboto Mono", monospace`;
    const label = space.taxAmount != null
      ? (text.tax ?? `PAY ${space.taxAmount}`).toUpperCase()
      : `${space.price}`;
    c.lineWidth = Math.max(2, size * 0.16);
    c.strokeText(label, w / 2, bodyH * 0.86);
    c.fillStyle = GOLD;
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
