import { normalizeToken } from '../game/settings';
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

function Camel() {
  return (
    <>
      {/* Two humps: the Bactrian camel that walked the Silk Road. */}
      <path d="M5.2 15.4c.4-3.4 2.9-5.6 5.4-5.6 1.9 0 3 1.4 4 3.1.9-2.9 2.5-4.9 4.8-4.9 2.6 0 3.9 2.3 4.5 5.2l.5-6.6c.1-1.3 1-2.2 2.2-2.2h1.2c1 0 1.6.9 1.3 1.8l-.8 2.2h-1.3l-.9 9.4c-.2 2.1-1.9 3.6-4 3.6H9.2c-2.4 0-4.2-2-4-4.4z" />
      <rect x="8" y="19" width="2.4" height="8.6" rx="0.8" />
      <rect x="12.2" y="19" width="2.4" height="8.6" rx="0.8" />
      <rect x="18" y="19" width="2.4" height="8.6" rx="0.8" />
      <rect x="22.2" y="19" width="2.4" height="8.6" rx="0.8" />
      <path d="M4.4 14.6 2 20.2l1.2.5 2.2-4.2z" />
      <path d="M11.4 11.2c1.5 0 2.4 1 3 2.5l-1 .8c-.5-1.2-1.1-1.9-2-1.9z" fill={LIGHT} />
      <path d="M6.2 17.4h18.6v1.6H6.2z" fill={SHADE} />
    </>
  );
}

function Teapot() {
  return (
    <>
      <path d="M8.4 12.6h15.2c.9 0 1.6.8 1.5 1.7l-.9 8.6a4.6 4.6 0 0 1-4.6 4.1h-6.8a4.6 4.6 0 0 1-4.6-4.1l-.9-8.6c-.1-.9.6-1.7 1.5-1.7z" />
      <path d="M11.6 8.6h8.8l1.4 3.4H10.2z" />
      <circle cx="16" cy="6.8" r="1.8" />
      <path d="M24.6 15.2c2.6-.8 4.8.5 5 2.8.2 2.4-1.7 4.4-4.9 5.2l-.4-1.9c2-.6 3.2-1.8 3.1-3.1-.1-1.2-1.2-1.7-2.5-1.3z" />
      <path d="M7.6 16.4 3.2 12.2c-.5-.5-1.3 0-1.1.7l1.6 5.4c.5 1.6 2 2.7 3.7 2.7h.8z" />
      <path d="M8.9 18.2h14.2l-.2 1.8H9.1z" fill={SHADE} />
      <path d="M10.2 14.2h1.6l.9 9.6-1.4-.6z" fill={LIGHT} />
    </>
  );
}

function Lamp() {
  return (
    <>
      <path d="M3 17.4c0-2.6 4.8-4.6 11.2-4.6 4.2 0 7.6.9 9.6 2.2l4.8-2.4c.8-.4 1.6.4 1.2 1.2l-3.4 5.4c-1.6 2.6-5.4 4.4-11.2 4.4C7.6 23.6 3 20.8 3 17.4z" />
      <path d="M26.6 10.8c0-1.6 1.2-3 1.7-4.4.5 1.4 1.7 2.8 1.7 4.4a1.7 1.7 0 0 1-3.4 0z" />
      <path d="M10.4 23.2h7.6l1.4 3.6H9z" />
      <path d="M11.4 11.4h5.6l.8 1.6H10.6z" />
      <path d="M3.4 15.4c-2.4.2-2.6 3.6-.2 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M5.2 16.6c1.8-1.6 5.2-2.4 9-2.4v1.4c-3.4 0-6.4.7-8 2z" fill={LIGHT} />
      <path d="M4.2 19.6c2 1.6 5.4 2.6 10 2.6v1.4c-4.8 0-8.6-1.2-10.8-3.2z" fill={SHADE} />
    </>
  );
}

function Pomegranate() {
  return (
    <>
      <circle cx="16" cy="18" r="10.4" />
      <path d="M12.2 8.8 11 4.2l2.6 1.8L16 3l2.4 3 2.6-1.8-1.2 4.6z" />
      <path d="M9.2 14.6a8 8 0 0 1 5-4.4l.5 1.5a6.4 6.4 0 0 0-4 3.5z" fill={LIGHT} />
      <path d="M26.4 18A10.4 10.4 0 0 1 16 28.4v-2A8.4 8.4 0 0 0 24.4 18z" fill={SHADE} />
    </>
  );
}

function Dutar() {
  return (
    <>
      {/* The long-necked two-string lute, laid on the diagonal. */}
      <path d="M4.4 21.2c0-4.4 3.6-8 8-8 2 0 3.4.7 4.4 1.7 1 1 1.7 2.4 1.7 4.4 0 4.4-3.6 8-8 8-3.4 0-6.1-2.7-6.1-6.1z" />
      <path d="M16.2 13.4 26.8 2.8l2.4 2.4L18.6 15.8z" />
      <path d="M26 2l3.6-.6-.6 3.6-1.2-1.8z" />
      <circle cx="10.8" cy="21.4" r="1.6" fill={SHADE} />
      <path d="M8.2 16.4a6.4 6.4 0 0 1 3.6-1.6l.2 1.5a5 5 0 0 0-2.8 1.3z" fill={LIGHT} />
    </>
  );
}

function Horse() {
  return (
    <>
      <path d="M8.6 28.4c-.4-4.6.6-8.4 3-11.4L9.8 15c-1.9.3-3.6-.4-4.4-1.9-.5-.9-.2-2 .6-2.6l6.4-5.2 1-3.1 1.8 2.2c5.8.2 10.4 4.2 11.4 10.6.8 5.2-.4 9.8-2.6 13.4z" />
      <circle cx="13.6" cy="9.2" r="1.1" fill={SHADE} />
      <path d="M17.4 6.8c3.6 1 6 3.8 6.6 7.8l-1.6.3c-.5-3.3-2.4-5.6-5.4-6.5z" fill={LIGHT} />
      <path d="M8.4 26.6h16.2v1.8H8.4z" fill={SHADE} />
    </>
  );
}

function Doppi() {
  return (
    <>
      {/* The four-cornered skullcap, with the pepper motif on its crown. */}
      <path d="M4 20.4 6.8 9.8c.4-1.6 1.8-2.6 3.4-2.6h11.6c1.6 0 3 1 3.4 2.6L28 20.4z" />
      <path d="M3 20.4h26v4.2a1.4 1.4 0 0 1-1.4 1.4H4.4A1.4 1.4 0 0 1 3 24.6z" />
      <path d="M3 22h26v1.4H3z" fill={SHADE} />
      <path d="M15.4 7.2h1.2v13.2h-1.2z" fill={SHADE} />
      <path d="M11.2 11.6c.8 1.6.4 3.6-1 4.6-.6-1.8-.2-3.6 1-4.6zM20.8 11.6c-.8 1.6-.4 3.6 1 4.6.6-1.8.2-3.6-1-4.6z" fill={LIGHT} />
    </>
  );
}

function Minaret() {
  return (
    <>
      <path d="M11.4 28.6 12.6 10h6.8l1.2 18.6z" />
      <path d="M10.2 8.4h11.6l-1 2.4h-9.6z" />
      <path d="M12.4 8.4c0-3 1.6-5.2 3.6-6.6 2 1.4 3.6 3.6 3.6 6.6z" />
      <path d="M9.4 27.6h13.2v2.4H9.4z" />
      <path d="M12.2 14.6h7.6v1.4h-7.6zM11.9 20.6h8.2V22h-8.2z" fill={SHADE} />
      <path d="M13.4 11.4h1.5l-.7 16.4h-1.5z" fill={LIGHT} />
    </>
  );
}

const PIECES: Record<TokenId, () => JSX.Element> = {
  camel: Camel,
  teapot: Teapot,
  lamp: Lamp,
  pomegranate: Pomegranate,
  dutar: Dutar,
  horse: Horse,
  doppi: Doppi,
  minaret: Minaret,
};

export function Piece({
  token, className, title,
}: { token: TokenId; className?: string; title?: string }) {
  const Shape = PIECES[normalizeToken(token)];
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
      {/* The caravanserai's gate, where a traveller rests for free. */}
      <path d="M4 29V13.4C4 6.8 9.4 2 16 2s12 4.8 12 11.4V29h-5.4V14c0-3.8-3-6.8-6.6-6.8S9.4 10.2 9.4 14v15z" />
      <path d="M2 27h28v3H2z" opacity="0.8" />
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
