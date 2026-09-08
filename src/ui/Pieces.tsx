import type { TokenId } from '../game/types';

/* ------------------------------------------------------------------ *
 * The eight playing pieces, drawn rather than lettered.
 *
 * SVG rather than generated raster on purpose: these render at 14px on
 * the board and at 44px in the player rail from the same source, they
 * tint to each player's colour through currentColor, and they cost no
 * network requests on a static host.
 *
 * Each piece is a solid silhouette in currentColor plus a few overlays
 * at low opacity for shading, so it reads as a modelled object at large
 * sizes and still holds its shape at small ones.
 * ------------------------------------------------------------------ */

const SHADE = 'rgb(0 0 0 / 0.30)';
const LIGHT = 'rgb(255 255 255 / 0.38)';

function TopHat() {
  return (
    <>
      <ellipse cx="16" cy="22.2" rx="13.4" ry="3.2" />
      <path d="M10.6 5.4h10.8l.6 15.4H10z" />
      <path d="M10.2 15.6h11.6l.13 3.5H10.07z" fill={SHADE} />
      <path d="M11.6 6h1.6l.42 14.4h-1.6z" fill={LIGHT} />
      <ellipse cx="16" cy="22.2" rx="9" ry="1.5" fill={SHADE} />
    </>
  );
}

function Roadster() {
  return (
    <>
      <path d="M1.6 22.6l3.9-7.4 7.4-1.1 4.9-3.9 7.6.5 3.9 5 2.7 1.1v5.8z" />
      <path d="M13.2 14.3l3.9-3 5.4.35 2.7 3.1z" fill={SHADE} />
      <circle cx="9.4" cy="23.4" r="3.7" />
      <circle cx="23.4" cy="23.4" r="3.7" />
      <circle cx="9.4" cy="23.4" r="1.4" fill={SHADE} />
      <circle cx="23.4" cy="23.4" r="1.4" fill={SHADE} />
      <path d="M2.4 18.6l2.6-3.4 2 .3-2.7 3.6z" fill={LIGHT} />
    </>
  );
}

function Terrier() {
  return (
    <>
      {/* The classic square-cut scottie, built from separate parts so the
          legs stay legible instead of merging into a slab at small sizes. */}
      <rect x="4.6" y="12.6" width="17" height="8.4" rx="2.6" />
      <path d="M19 8.2h7.4a2.2 2.2 0 0 1 2.2 2.2v8.4a2.2 2.2 0 0 1-2.2 2.2H19z" />
      <path d="M20.1 8.3l1.4-4.1 1.5 4.1z" />
      <path d="M24.1 8.3l1.4-4.1 1.5 4.1z" />
      <rect x="6" y="20.4" width="3.2" height="5.2" rx="0.6" />
      <rect x="11.4" y="20.4" width="3.2" height="5.2" rx="0.6" />
      <rect x="17.2" y="20.4" width="3.2" height="5.2" rx="0.6" />
      <rect x="23" y="20.4" width="3.2" height="5.2" rx="0.6" />
      <path d="M4.8 12.8L1.9 8.1l2.4-1.5 2.9 4.7z" />
      <circle cx="25.6" cy="12.4" r="1.05" fill={SHADE} />
      <path d="M6.6 14.4h13v1.5h-13z" fill={LIGHT} />
    </>
  );
}

function Thimble() {
  return (
    <>
      <path d="M9.4 4.6h13.2v3H9.4z" />
      <path d="M10.4 7.6h11.2l-1.5 13.4a4.2 4.2 0 0 1-8.2 0z" />
      {[
        [13, 11], [16, 11], [19, 11],
        [14.4, 14], [17.6, 14],
        [13.4, 17], [16, 17], [18.6, 17],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="0.85" fill={SHADE} />
      ))}
      <path d="M11.2 8.2h1.6l-1 12.2-1.4-1.4z" fill={LIGHT} />
    </>
  );
}

function Boot() {
  return (
    <>
      <path d="M10.2 4.2h6.4v10.6h4.6a6.4 6.4 0 0 1 6.4 6.4v1.4H4.1v-1.6a4.8 4.8 0 0 1 3.8-4.7l2.3-.5z" />
      <path d="M3.4 22.4h24.4a1.7 1.7 0 0 1 0 3.4H3.4a1.7 1.7 0 0 1 0-3.4z" fill={SHADE} />
      <path d="M11 5h1.9v10.2H11z" fill={LIGHT} />
      <path d="M17.6 16.6h3.4a4 4 0 0 1 3.6 2.3h-7z" fill={SHADE} />
    </>
  );
}

function Battleship() {
  return (
    <>
      <path d="M1.6 19.4h28.8l-3.6 6.4H5.2z" />
      <path d="M1.6 19.4h28.8l-.6 1.1H2.2z" fill={LIGHT} />
      <path d="M11 10.4h6.2v9H11z" />
      <path d="M13.1 5.6h2.4v4.8h-2.4z" />
      <path d="M18.8 12.4h3.1v7h-3.1z" />
      <path d="M19 12.4h3.1v1.9H19z" fill={SHADE} />
      <path d="M5.4 16.2h5.2v1.7H5.4z" />
      <path d="M14 1.8h1v4h-1z" />
      <path d="M11.4 11h1.5v8.4h-1.5z" fill={LIGHT} />
    </>
  );
}

function Iron() {
  return (
    <>
      <path d="M3 22.6c0-8 6-11 10.4-12 5.6-1.3 11.4-.4 14.6 3.6v8a1.7 1.7 0 0 1-1.7 1.7H4.7A1.7 1.7 0 0 1 3 22.6z" />
      <path d="M3.4 21.6h24.6v1.4H3.4z" fill={SHADE} />
      <path d="M9.8 11.6c1.6-3.9 5.4-6.2 9.6-5.7 3 .4 4.9 2.2 5.3 4.7l-2.7.5c-.3-1.5-1.4-2.4-3-2.6-2.9-.35-5.4 1.2-6.6 3.9z" />
      <path d="M5.6 18.4c1.2-3.2 3.9-5.2 7.2-6.2l.5 1.8c-2.7.9-4.9 2.5-5.9 5z" fill={LIGHT} />
    </>
  );
}

function Wheelbarrow() {
  return (
    <>
      <path d="M6.4 8.2h19.2l-4.6 9.4H10.2z" />
      <path d="M6.4 8.2h19.2l-.7 1.5H7.1z" fill={LIGHT} />
      <path d="M24.4 7.4l3.9 12.6-2.4.8-3.9-12.6z" />
      <path d="M20.8 17.6l1.6 5.4h-2.5l-1.6-5.4z" />
      <circle cx="10.2" cy="22.4" r="4" />
      <circle cx="10.2" cy="22.4" r="1.5" fill={SHADE} />
      <path d="M5.2 17.6l3.4 2.4-1.3 1.6-3.6-2.4z" />
    </>
  );
}

const PIECES: Record<TokenId, () => JSX.Element> = {
  topper: TopHat,
  roadster: Roadster,
  terrier: Terrier,
  thimble: Thimble,
  boot: Boot,
  battleship: Battleship,
  iron: Iron,
  wheelbarrow: Wheelbarrow,
};

export function Piece({
  token, className, title,
}: { token: TokenId; className?: string; title?: string }) {
  const Shape = PIECES[token] ?? TopHat;
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="currentColor"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <Shape />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Buildings. Little elevations rather than coloured squares - at board
 * scale the roof pitch is what makes a house read as a house.
 * ------------------------------------------------------------------ */

export function House({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" focusable="false" aria-hidden>
      <path d="M8 1.4 15 7v.9h-1.7V15H2.7V7.9H1V7z" fill="currentColor" />
      <path d="M8 1.4 15 7v.9h-1.7L8 3.9 2.7 7.9H1V7z" fill="rgb(255 255 255 / 0.35)" />
      <rect x="6.4" y="10" width="3.2" height="5" fill="rgb(0 0 0 / 0.35)" />
    </svg>
  );
}

export function Hotel({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 28 16" focusable="false" aria-hidden>
      <path d="M2 15V6.4L8 2l6 4.4V15z" fill="currentColor" />
      <path d="M14 15V8.2l6-3.4 6 3.4V15z" fill="currentColor" />
      <path d="M8 2 14 6.4v1.2L8 3.6 2 7.6V6.4z" fill="rgb(255 255 255 / 0.35)" />
      <rect x="4.4" y="8.4" width="2" height="2.4" fill="rgb(0 0 0 / 0.35)" />
      <rect x="9.6" y="8.4" width="2" height="2.4" fill="rgb(0 0 0 / 0.35)" />
      <rect x="17" y="10" width="2" height="2.4" fill="rgb(0 0 0 / 0.35)" />
      <rect x="21.6" y="10" width="2" height="2.4" fill="rgb(0 0 0 / 0.35)" />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Board space icons, cut in the same deco language as the pieces.
 * ------------------------------------------------------------------ */

export type SpaceIcon =
  | 'chance' | 'chest' | 'tax' | 'luxury' | 'railroad'
  | 'electric' | 'water' | 'jail' | 'parking' | 'gotojail' | 'go';

const ICONS: Record<SpaceIcon, () => JSX.Element> = {
  chance: () => (
    <>
      <path d="M16 3a9 9 0 0 1 9 9c0 4.2-3 5.6-4.6 7-1.1 1-1.6 1.8-1.7 3.2h-5.2c.1-3 1.2-4.6 3-6.1 1.6-1.4 3-2.2 3-4.1a3.5 3.5 0 0 0-7 0H7A9 9 0 0 1 16 3z" />
      <circle cx="16" cy="26.4" r="3" />
    </>
  ),
  chest: () => (
    <>
      <path d="M4 13h24v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M6 5h20a2 2 0 0 1 2 2v6H4V7a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.75" />
      <path d="M13.6 5h4.8v23h-4.8z" fill={SHADE} />
      <rect x="12.6" y="14.4" width="6.8" height="5.4" rx="1.4" />
    </>
  ),
  tax: () => (
    <>
      <path d="M16 2.6 19 9l7 1-5 5 1.2 7L16 18.8 9.8 22l1.2-7-5-5 7-1z" opacity="0.9" />
      <path d="M16 8.4v11.2M13 11.4h5a1.9 1.9 0 0 1 0 3.8h-4a1.9 1.9 0 0 0 0 3.8h5"
        fill="none" stroke={SHADE} strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  luxury: () => (
    <>
      <path d="M8 5h16l6 7-14 15L2 12z" />
      <path d="M8 5h16l6 7H2z" fill={LIGHT} />
      <path d="M16 27 2 12h28z" fill={SHADE} opacity="0.45" />
    </>
  ),
  railroad: () => (
    <>
      <path d="M3 21h26v2.6H3z" />
      <path d="M6 24.4h20l1.6 3.4H4.4z" opacity="0.65" />
      <path d="M9.4 5h13.2v7H9.4z" />
      <path d="M6 12h20v8H6z" />
      <circle cx="11" cy="16" r="1.9" fill={SHADE} />
      <circle cx="21" cy="16" r="1.9" fill={SHADE} />
      <path d="M11.4 6.4h9.2v4.2h-9.2z" fill={LIGHT} />
    </>
  ),
  electric: () => <path d="M18.6 2 7 18h6.4L12 30 25 13h-6.8z" />,
  water: () => (
    <>
      <path d="M16 2.6c5.4 6.4 9 11 9 15.2a9 9 0 0 1-18 0c0-4.2 3.6-8.8 9-15.2z" />
      <path d="M11.4 18.6a4.6 4.6 0 0 0 4.6 4.6" fill="none" stroke={LIGHT} strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  jail: () => (
    <>
      <path d="M3.6 4h2.6v24H3.6zM10.4 4H13v24h-2.6zM19 4h2.6v24H19zM25.8 4h2.6v24h-2.6z" />
      <path d="M2 4h28v2.6H2zM2 25.4h28V28H2z" opacity="0.8" />
    </>
  ),
  parking: () => (
    <>
      <path d="M4 4h11a8.6 8.6 0 0 1 0 17.2H10V28H4z" />
      <path d="M10 9.4h4.6a3.2 3.2 0 0 1 0 6.4H10z" fill={SHADE} />
    </>
  ),
  gotojail: () => (
    <>
      <path d="M6 3h2.8v26H6z" />
      <path d="M9.6 3.6h17.4l-3.6 5.4 3.6 5.4H9.6z" />
      <path d="M9.6 3.6h17.4l-1 1.5H9.6z" fill={LIGHT} />
    </>
  ),
  go: () => (
    <>
      <path d="M3 12.6h15V7l11 9-11 9v-5.6H3z" />
      <path d="M3 12.6h15V7l3 2.4v5.2H3z" fill={LIGHT} />
    </>
  ),
};

export function BoardIcon({ icon, className }: { icon: SpaceIcon; className?: string }) {
  const Shape = ICONS[icon];
  if (!Shape) return null;
  return (
    <svg className={className} viewBox="0 0 32 32" fill="currentColor" aria-hidden focusable="false">
      <Shape />
    </svg>
  );
}
