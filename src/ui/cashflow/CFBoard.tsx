import { useEffect, useRef, useState } from 'react';
import { cfDreamArt, cfSpaceArt, type CFSpaceArt } from '../../art/art';
import { FAST_BOARD, FAST_SIZE, RAT_BOARD, RAT_SIZE } from '../../cashflow/data';
import { fastName } from '../../cashflow/describe';
import { currentId } from '../../cashflow/rules';
import type { CFState, CFTrack, FastKind, FastSpace, RatKind } from '../../cashflow/types';
import type { TokenId } from '../../game/types';
import { useT, type Dict } from '../../i18n';
import { Avatar, fmt } from '../bits';
import { CFTableCardView } from './CFCard';

/* ------------------------------------------------------------------ *
 * The board, as the printed one is: two concentric tracks. The Rat Race
 * is the inner ring you go round and round; the Fast Track is the wide
 * outer one you only reach by earning your way out. Drawn in SVG on a
 * 1000-unit square so every size of screen gets the same geometry.
 * ------------------------------------------------------------------ */

const C = 500;
const RAT = { r0: 186, r1: 322, art: 292, label: 228, token: 238 };
const FAST = { r0: 334, r1: 494, art: 468, label: 396, token: 392 };

const RAT_ART: Record<RatKind, CFSpaceArt> = {
  opportunity: 'small', payday: 'payday', market: 'market', doodad: 'doodad',
  charity: 'charity', baby: 'baby', downsized: 'downsized',
};
const FAST_ART: Record<FastKind, CFSpaceArt> = {
  cashflowDay: 'cashflowDay', business: 'business', venture: 'venture', dream: 'dream',
  charity: 'charity', audit: 'audit', lawsuit: 'lawsuit', divorce: 'divorce',
};

const r2 = (n: number): number => Math.round(n * 100) / 100;

function pt(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [r2(C + r * Math.cos(a)), r2(C + r * Math.sin(a))];
}

function sector(r0: number, r1: number, a0: number, a1: number): string {
  const [x0, y0] = pt(r1, a0);
  const [x1, y1] = pt(r1, a1);
  const [x2, y2] = pt(r0, a1);
  const [x3, y3] = pt(r0, a0);
  return `M${x0} ${y0}A${r1} ${r1} 0 0 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 0 0 ${x3} ${y3}Z`;
}

/** Labels run along the spoke, and are turned over on the left half so no
 *  square is ever read upside down. */
const along = (x: number, y: number, deg: number): string =>
  `rotate(${r2(deg < 180 ? deg - 90 : deg + 90)} ${x} ${y})`;

const short = (n: number): string => {
  if (n >= 1_000_000) return `$${r2(n / 1_000_000)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${n}`;
};

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

type Peek = { track: CFTrack; id: number } | null;

export function CFBoard({ s, myId, rolling }: { s: CFState; myId: string; rolling: boolean }) {
  const t = useT();
  const [peek, setPeek] = useState<Peek>(null);
  const cur = s.players[currentId(s)];
  const ratStep = 360 / RAT_SIZE;
  const fastStep = 360 / FAST_SIZE;
  const gap = 0.55;

  const dreamers = (id: number) => s.seats.filter((pid) => s.players[pid].dream === id && !s.players[pid].out);

  return (
    <div className="cfBoardWrap">
      <div className="cfBoard">
        <svg viewBox="0 0 1000 1000" className="cfBoard__svg" role="img" aria-label={t.cf.board.aria}>
          <defs>
            <radialGradient id="cfCenter" cx="50%" cy="42%" r="60%">
              <stop offset="0%" stopColor="#173d2b" />
              <stop offset="100%" stopColor="#06120c" />
            </radialGradient>
            <radialGradient id="cfTable" cx="50%" cy="45%" r="55%">
              <stop offset="0%" stopColor="#0c2419" />
              <stop offset="100%" stopColor="#040a07" />
            </radialGradient>
          </defs>

          <circle cx={C} cy={C} r={498} fill="url(#cfTable)" />
          <circle cx={C} cy={C} r={497} className="cfBoard__rule" />
          <circle cx={C} cy={C} r={328} className="cfBoard__rule" />
          <circle cx={C} cy={C} r={182} className="cfBoard__rule" />
          <circle cx={C} cy={C} r={178} fill="url(#cfCenter)" />
          <image
            href={cfSpaceArt('cashflowDay')}
            x={C - 150} y={C - 150} width={300} height={300}
            className="cfBoard__medal"
          />

          {/* ------------------------- the Fast Track ------------------------ */}
          {FAST_BOARD.map((sp) => {
            const a0 = sp.id * fastStep + gap;
            const a1 = (sp.id + 1) * fastStep - gap;
            const mid = (sp.id + 0.5) * fastStep;
            const [ax, ay] = pt(FAST.art, mid);
            const [lx, ly] = pt(FAST.label, mid);
            const owner = s.fastOwners[sp.id] ? s.players[s.fastOwners[sp.id]] : null;
            const here = s.landed?.track === 'fast' && s.landed.space === sp.id;
            const mineDream = s.players[myId]?.dream === sp.id;
            const art = sp.kind === 'dream' && sp.key ? cfDreamArt(sp.key) : cfSpaceArt(FAST_ART[sp.kind]);
            const name = fastName(t, sp.id);
            const sub = fastSub(sp);
            const size = sp.kind === 'dream' ? 44 : 36;
            return (
              <g
                key={`f${sp.id}`}
                className="cfTile"
                data-kind={sp.kind}
                data-here={here || undefined}
                data-mine={mineDream || undefined}
                onMouseEnter={() => setPeek({ track: 'fast', id: sp.id })}
                onMouseLeave={() => setPeek(null)}
              >
                <title>{name}</title>
                <path d={sector(FAST.r0, FAST.r1, a0, a1)} className="cfTile__plate"
                  style={owner ? { stroke: owner.color, strokeWidth: 4 } : undefined} />
                <image href={art} x={ax - size / 2} y={ay - size / 2} width={size} height={size} className="cfTile__art" />
                <text x={lx} y={ly} transform={along(lx, ly, mid)} className="cfTile__label cfTile__label--fast" textAnchor="middle">
                  <tspan x={lx} dy={sub ? '-0.2em' : '0.35em'}>{clip(name, 19)}</tspan>
                  {sub && <tspan x={lx} dy="1.15em" className="cfTile__sub">{sub}</tspan>}
                </text>
                {owner && (() => {
                  const [ox, oy] = pt(FAST.r0 + 14, mid);
                  return <circle cx={ox} cy={oy} r={7} fill={owner.color} className="cfTile__owner" />;
                })()}
                {sp.kind === 'dream' && dreamers(sp.id).map((pid, i, all) => {
                  const [dx, dy] = pt(FAST.r0 + 12, mid + (i - (all.length - 1) / 2) * 2.1);
                  return <circle key={pid} cx={dx} cy={dy} r={5.5} fill={s.players[pid].color} className="cfTile__owner" />;
                })}
              </g>
            );
          })}

          {/* ------------------------- the Rat Race ------------------------- */}
          {RAT_BOARD.map((sp) => {
            const a0 = sp.id * ratStep + gap;
            const a1 = (sp.id + 1) * ratStep - gap;
            const mid = (sp.id + 0.5) * ratStep;
            const [ax, ay] = pt(RAT.art, mid);
            const [lx, ly] = pt(RAT.label, mid);
            const here = s.landed?.track === 'rat' && s.landed.space === sp.id;
            const name = t.cf.spaces[sp.kind];
            return (
              <g
                key={`r${sp.id}`}
                className="cfTile"
                data-kind={sp.kind}
                data-here={here || undefined}
                onMouseEnter={() => setPeek({ track: 'rat', id: sp.id })}
                onMouseLeave={() => setPeek(null)}
              >
                <title>{name}</title>
                <path d={sector(RAT.r0, RAT.r1, a0, a1)} className="cfTile__plate" />
                <image href={cfSpaceArt(RAT_ART[sp.kind])} x={ax - 24} y={ay - 24} width={48} height={48} className="cfTile__art" />
                <text x={lx} y={ly} transform={along(lx, ly, mid)} className="cfTile__label" textAnchor="middle" dy="0.35em">
                  {clip(name, 13)}
                </text>
              </g>
            );
          })}
        </svg>

        {/* ----------------------------- pieces ----------------------------- */}
        <div className="cfBoard__tokens" aria-hidden>
          {s.seats.map((id, i) => {
            const p = s.players[id];
            if (p.out) return null;
            return (
              <CFToken
                key={id}
                track={p.track}
                position={p.position}
                index={i}
                color={p.color}
                token={p.token}
                active={id === currentId(s) && s.phase !== 'game_over'}
              />
            );
          })}
        </div>

        {/* --------------------------- the centre -------------------------- */}
        <div className="cfCenter">
          {s.dice && (
            <div className="cfDice" data-rolling={rolling || undefined} aria-label={t.cf.board.rolled(s.dice.join(' + '))}>
              {s.dice.map((d, i) => <span key={i} className="cfDie">{'⚀⚁⚂⚃⚄⚅'[d - 1]}</span>)}
            </div>
          )}
          {s.card ? (
            <div className="cfCenter__card"><CFTableCardView s={s} /></div>
          ) : (
            <p className="cfCenter__hud">
              {s.phase === 'dreams' || s.phase === 'game_over'
                ? t.cf.board.hud[s.phase]
                : <><strong style={{ color: cur?.color }}>{cur?.name}</strong> {t.cf.board.hud[s.phase]}</>}
            </p>
          )}
        </div>
      </div>

      <TilePeek s={s} t={t} peek={peek ?? (s.landed ? { track: s.landed.track, id: s.landed.space } : null)} />
    </div>
  );
}

function fastSub(sp: FastSpace): string {
  switch (sp.kind) {
    case 'business': return `${short(sp.cost ?? 0)} · +${short(sp.cashflow ?? 0)}`;
    case 'venture': return `${short(sp.cost ?? 0)} · ⚄${(sp.win ?? []).join('/')}`;
    case 'dream': return short(sp.cost ?? 0);
    default: return '';
  }
}

/** Names the square under the pointer (or the one just landed on) in
 *  real text at real size, with what it costs and who holds it. */
function TilePeek({ s, t, peek }: { s: CFState; t: Dict; peek: Peek }) {
  if (!peek) return <p className="cfPeek cfPeek--empty" aria-hidden>&nbsp;</p>;
  if (peek.track === 'rat') {
    const sp = RAT_BOARD[peek.id];
    return (
      <p className="cfPeek" data-kind={sp.kind}>
        <strong>{t.cf.spaces[sp.kind]}</strong>
        <span>{t.cf.hints[sp.kind]}</span>
      </p>
    );
  }
  const sp = FAST_BOARD[peek.id];
  const owner = s.fastOwners[sp.id] ? s.players[s.fastOwners[sp.id]] : null;
  const hint = sp.kind === 'charity' ? t.cf.hints.fastCharity : t.cf.hints[sp.kind];
  const dreamers = s.seats.filter((id) => s.players[id].dream === sp.id).map((id) => s.players[id].name);
  return (
    <p className="cfPeek" data-kind={sp.kind}>
      <strong>{fastName(t, sp.id)}</strong>
      <span>{hint}</span>
      {sp.cost != null && <span className="num">{fmt(sp.cost)}</span>}
      {sp.cashflow != null && <span className="num">+{fmt(sp.cashflow)}/mo</span>}
      {owner && (
        <span style={{ color: owner.color }}>
          {sp.kind === 'venture' ? t.cf.board.cracked(owner.name) : t.cf.board.owner(owner.name)}
        </span>
      )}
      {dreamers.length > 0 && <span>{t.cf.board.dreamOf(dreamers.join(', '))}</span>}
    </p>
  );
}

/** A piece that walks square by square rather than teleporting, and jumps
 *  only when it changes track. */
function CFToken({
  track, position, index, color, token, active,
}: { track: CFTrack; position: number; index: number; color: string; token: TokenId; active: boolean }) {
  const [shown, setShown] = useState({ track, position });
  const ref = useRef(shown);
  ref.current = shown;

  useEffect(() => {
    const from = ref.current;
    if (from.track !== track) { setShown({ track, position }); return; }
    const size = track === 'rat' ? RAT_SIZE : FAST_SIZE;
    const steps = (position - from.position + size) % size;
    if (steps === 0) return;
    if (steps > 18) { setShown({ track, position }); return; }
    let i = 0;
    const timer = window.setInterval(() => {
      i += 1;
      setShown({ track, position: (from.position + i) % size });
      if (i >= steps) window.clearInterval(timer);
    }, 150);
    return () => window.clearInterval(timer);
  }, [track, position]);

  const ring = shown.track === 'rat' ? RAT : FAST;
  const size = shown.track === 'rat' ? RAT_SIZE : FAST_SIZE;
  const [x, y] = pt(ring.token, (shown.position + 0.5) * (360 / size));
  const a = (index * 60 * Math.PI) / 180;
  const ox = Math.cos(a) * 16;
  const oy = Math.sin(a) * 16;

  return (
    <span
      className="cfToken"
      data-active={active || undefined}
      style={{ left: `${(x + ox) / 10}%`, top: `${(y + oy) / 10}%` }}
    >
      <Avatar color={color} token={token} size={24} active={active} />
    </span>
  );
}
