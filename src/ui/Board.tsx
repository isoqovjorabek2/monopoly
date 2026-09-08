import { memo } from 'react';
import { BOARD, GROUP_COLOR, edgeOf, isCorner } from '../game/board';
import type { GameState, Space } from '../game/types';
import { BoardIcon, House, Hotel, Piece, type SpaceIcon } from './Pieces';
import { Dice } from './Dice';

/* ---------------- geometry -------------------------------------------
 * The grid is [corner, 9 units, corner] on both axes. Token positions are
 * derived from the same numbers the CSS uses, so they always line up.
 * -------------------------------------------------------------------- */
const CORNER = 1.62;
const TOTAL = CORNER * 2 + 9;

/** Grid column/row (1-indexed) for a space id. */
export function cellOf(id: number): { col: number; row: number } {
  if (id === 0) return { col: 11, row: 11 };
  if (id < 10) return { col: 11 - id, row: 11 };
  if (id === 10) return { col: 1, row: 11 };
  if (id < 20) return { col: 1, row: 21 - id };
  if (id === 20) return { col: 1, row: 1 };
  if (id < 30) return { col: id - 19, row: 1 };
  if (id === 30) return { col: 11, row: 1 };
  return { col: 11, row: id - 29 };
}

/** Centre of a grid track, in fr units from the top/left edge. */
const trackCentre = (k: number): number => {
  if (k === 1) return CORNER / 2;
  if (k === 11) return CORNER + 9 + CORNER / 2;
  return CORNER + (k - 2) + 0.5;
};

/** Percentage position of a token on space `id`, fanned by `index`. */
export function tokenPos(id: number, index: number): { left: string; top: string } {
  const { col, row } = cellOf(id);
  // Deterministic fan so pieces never reshuffle between renders.
  const dx = ((index % 3) - 1) * 0.36;
  const dy = (Math.floor(index / 3) - 0.5) * 0.36;
  return {
    left: `${((trackCentre(col) + dx) / TOTAL) * 100}%`,
    top: `${((trackCentre(row) + dy) / TOTAL) * 100}%`,
  };
}

/* ------------------------------- tile -------------------------------- */

const KIND_ICON: Record<string, SpaceIcon> = {
  go: 'go',
  chance: 'chance',
  chest: 'chest',
  jail: 'jail',
  freeparking: 'parking',
  gotojail: 'gotojail',
  railroad: 'railroad',
};

/** Per-space overrides: the two utilities and the two taxes each need to
 *  be told apart at a glance. */
const SPACE_ICON: Record<number, SpaceIcon> = {
  4: 'tax',
  12: 'electric',
  28: 'water',
  38: 'luxury',
};

interface TileProps {
  space: Space;
  ownerColor: string | null;
  houses: number;
  mortgaged: boolean;
  highlight: boolean;
  onInspect: (id: number) => void;
}

const Tile = memo(function Tile({
  space, ownerColor, houses, mortgaged, highlight, onInspect,
}: TileProps) {
  const edge = edgeOf(space.id);
  const corner = isCorner(space.id);
  const { col, row } = cellOf(space.id);
  const band = space.group ? GROUP_COLOR[space.group] : undefined;

  const icon = space.kind === 'railroad' || space.kind === 'utility' || !space.group
    ? SPACE_ICON[space.id] ?? KIND_ICON[space.kind]
    : undefined;

  // A tile is only about eight characters wide. Names wrap at spaces on
  // their own, but a single long word ("MEDITERRANEAN") has no break
  // opportunity, so the type size is fitted to the longest word instead
  // of being allowed to break mid-word.
  const longestWord = Math.max(...space.short.split(/\s+/).map((w) => w.length), 1);

  return (
    <button
      type="button"
      className={[
        'tile',
        `tile--${edge}`,
        corner ? 'tile--corner' : '',
        mortgaged ? 'tile--mortgaged' : '',
        highlight ? 'tile--highlight' : '',
      ].filter(Boolean).join(' ')}
      style={{
        gridColumn: col,
        gridRow: row,
        ['--maxword' as string]: longestWord,
        ...(band ? { ['--band' as string]: band } : {}),
        ...(ownerColor ? { ['--own' as string]: ownerColor } : {}),
      } as React.CSSProperties}
      onClick={() => onInspect(space.id)}
      aria-label={
        `${space.name}${space.price ? `, $${space.price}` : ''}`
        + `${ownerColor ? ', owned' : ''}${mortgaged ? ', mortgaged' : ''}`
      }
    >
      {band && <span className="tile__band" />}
      {ownerColor && <span className="tile__owner" />}
      {ownerColor && <span className="tile__ownerEdge" />}

      <span className="tile__body">
        {icon && <BoardIcon icon={icon} className="tile__icon" />}
        <span className="tile__name">{space.short}</span>
        {space.price != null && <span className="tile__price">{space.price}</span>}
        {space.taxAmount != null && <span className="tile__price">Pay {space.taxAmount}</span>}
      </span>

      {houses > 0 && (
        <span className="tile__builds" aria-hidden>
          {houses === 5
            ? <Hotel className="hotel" />
            : Array.from({ length: houses }, (_, i) => <House key={i} className="house" />)}
        </span>
      )}
    </button>
  );
});

/* ------------------------------- board ------------------------------- */

export function Board({
  state, animPos, rolling, onInspect, highlight,
}: {
  state: GameState;
  animPos: Record<string, number>;
  rolling: boolean;
  onInspect: (id: number) => void;
  highlight: number | null;
}) {
  const current = state.seats[state.seatIndex];

  // Group the pieces by square so they can fan out instead of overlapping.
  const bySpace: Record<number, string[]> = {};
  for (const id of state.seats) {
    if (state.players[id].bankrupt) continue;
    const pos = animPos[id] ?? state.players[id].position;
    (bySpace[pos] ??= []).push(id);
  }

  return (
    <div className="board" role="group" aria-label="Game board">
      {BOARD.map((space) => {
        const st = state.properties[space.id];
        const owner = st?.owner ? state.players[st.owner] : null;
        return (
          <Tile
            key={space.id}
            space={space}
            ownerColor={owner ? owner.color : null}
            houses={st?.houses ?? 0}
            mortgaged={st?.mortgaged ?? false}
            highlight={highlight === space.id}
            onInspect={onInspect}
          />
        );
      })}

      <div className="board__centre">
        <Medallion />
        <Dice dice={state.dice} rolling={rolling} />
        <CentreHud state={state} />
      </div>

      <div className="tokenLayer" aria-hidden>
        {Object.entries(bySpace).flatMap(([pos, ids]) =>
          ids.map((id, i) => {
            const p = state.players[id];
            const { left, top } = tokenPos(Number(pos), i);
            return (
              <span
                key={id}
                className={[
                  'token',
                  id === current ? 'token--active' : '',
                  p.inJail ? 'token--jailed' : '',
                ].filter(Boolean).join(' ')}
                style={{ left, top, ['--tc' as string]: p.color } as React.CSSProperties}
                title={p.name}
              >
                <Piece token={p.token} className="token__piece" />
              </span>
            );
          }))}
      </div>
    </div>
  );
}

/** The printed emblem in the middle of the board: a deco sunburst under a
 *  ringed medallion, sitting behind the live chrome rather than competing
 *  with it. Drawn rather than generated so it stays crisp at any board size. */
function Medallion() {
  const rays = Array.from({ length: 48 }, (_, i) => i * 7.5);
  return (
    <svg className="medallion" viewBox="0 0 400 400" aria-hidden focusable="false">
      <defs>
        <linearGradient id="mgold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--brass-200)" />
          <stop offset="55%" stopColor="var(--brass-500)" />
          <stop offset="100%" stopColor="var(--brass-700)" />
        </linearGradient>
        <radialGradient id="mglow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--brass-400)" stopOpacity="0.30" />
          <stop offset="70%" stopColor="var(--brass-600)" stopOpacity="0.06" />
          <stop offset="100%" stopColor="transparent" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="200" cy="200" r="196" fill="url(#mglow)" />

      <g className="medallion__rays">
        {rays.map((deg) => (
          <path
            key={deg}
            d="M200 200 L196.4 22 L203.6 22 Z"
            transform={`rotate(${deg} 200 200)`}
          />
        ))}
      </g>

      <g className="medallion__rings">
        <circle cx="200" cy="200" r="150" />
        <circle cx="200" cy="200" r="143" strokeWidth="1.5" />
        <circle cx="200" cy="200" r="96" />
      </g>

      {/* Deco corner fans, the shape the era is built on. */}
      <g className="medallion__fans">
        {[45, 135, 225, 315].map((deg) => (
          <g key={deg} transform={`rotate(${deg} 200 200)`}>
            <path d="M200 42 a158 158 0 0 1 40 5 L200 62 Z" />
          </g>
        ))}
      </g>

      {/* Type sits above and below the live chrome, never behind it. */}
      <g className="medallion__type">
        <text x="200" y="126" textAnchor="middle">MONOPOLY</text>
        <path d="M138 146 H262" />
        <text x="200" y="296" textAnchor="middle" className="medallion__sub">ROYALE</text>
      </g>
    </svg>
  );
}

function CentreHud({ state }: { state: GameState }) {
  const current = state.players[state.seats[state.seatIndex]];
  if (!current) return null;

  const hint = (() => {
    switch (state.phase) {
      case 'preroll': return 'to roll';
      case 'awaiting_buy': return 'is deciding whether to buy';
      case 'auction': return 'Auction in progress';
      case 'must_raise': return 'must raise cash';
      case 'jailed_choice': return 'is in jail';
      case 'turn_end': return 'to finish the turn';
      case 'game_over': return 'Game over';
      default: return '';
    }
  })();

  return (
    <div className="centreHud">
      <div className="centreHud__who" style={{ color: current.color }}>
        {state.phase === 'auction' || state.phase === 'game_over' ? '' : current.name}
      </div>
      <div className="centreHud__hint">{hint}</div>
    </div>
  );
}
