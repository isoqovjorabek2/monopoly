import { useState, type CSSProperties } from 'react';
import { mafRoleCard } from '../../art/art';
import { useT } from '../../i18n';
import { ROLE_TEAM } from '../../mafia/data';
import type { MafiaPrivate, MafiaRole, MafiaState } from '../../mafia/types';
import { Avatar } from '../bits';

export type TownLayout = 'grid' | 'round';

/** What this seat may know about another: its own role, the family's, the
 *  dead that were shown, and everyone's once the game is over. */
export function knownRole(m: MafiaState, id: string, myId: string, priv: MafiaPrivate | null): MafiaRole | null {
  return m.finalRoles?.[id]
    ?? m.revealed?.[id]
    ?? (id === myId ? priv?.role ?? null : null)
    ?? priv?.teammates.find((x) => x.id === id)?.role
    ?? null;
}

/**
 * The town: every chair at the table, as a grid or around a round table.
 * A chair is a button only while tapping it means something - a target
 * at night, a suspect in the vote, a mark for the sniper.
 */
export function Town({
  m, myId, priv, layout, targets, picked, onPick, canKickSeat, onKick, connected,
}: {
  m: MafiaState;
  myId: string;
  priv: MafiaPrivate | null;
  layout: TownLayout;
  targets: string[];
  picked: string | null;
  onPick?: (id: string) => void;
  canKickSeat: (id: string) => boolean;
  onKick: (id: string) => void;
  connected: (id: string) => boolean;
}) {
  const t = useT();
  const M = t.maf;
  const [kickArmed, setKickArmed] = useState<string | null>(null);
  const family = new Set((priv?.teammates ?? []).map((x) => x.id));
  const tally = new Map<string, number>();
  if (m.phase === 'vote') for (const target of Object.values(m.votes)) tally.set(target, (tally.get(target) ?? 0) + 1);
  // The family's picks tonight, as only the family sees them.
  const marks = new Map<string, string[]>();
  for (const [by, target] of Object.entries(priv?.familyPicks ?? {})) marks.set(target, [...(marks.get(target) ?? []), by]);

  const n = m.seats.length;
  const seat = (id: string, i: number) => {
    const p = m.players[id];
    const you = id === myId;
    const known = knownRole(m, id, myId, priv);
    const pickable = Boolean(onPick) && targets.includes(id);
    const votes = tally.get(id) ?? 0;
    const votedFor = m.phase === 'vote' ? m.votes[id] : undefined;
    const markedBy = marks.get(id) ?? [];
    // Round table: seats on an ellipse, the first at the bottom, toward you.
    const angle = (i / n) * Math.PI * 2 + Math.PI / 2;
    const style = layout === 'round'
      ? { '--x': `${50 + 44 * Math.cos(angle)}%`, '--y': `${50 + 40 * Math.sin(angle)}%` } as CSSProperties
      : undefined;
    return (
      <li key={id} className="mfTown__seat" style={style}>
        <button
          type="button"
          className="mfSeat"
          data-dead={!p.alive || undefined}
          data-you={you || undefined}
          data-family={(family.has(id) && !you) || undefined}
          data-pickable={pickable || undefined}
          data-picked={(pickable && picked === id) || undefined}
          data-marked={markedBy.length > 0 || undefined}
          disabled={!pickable}
          aria-pressed={pickable ? picked === id : undefined}
          onClick={() => pickable && onPick?.(id)}
        >
          <span className="mfSeat__face">
            {known && !p.alive
              ? <img className="mfSeat__card" src={mafRoleCard(known)} alt="" width={44} height={43} />
              : <Avatar color={p.color} token={p.token} size={38} dim={!p.alive} />}
            {votes > 0 && <span className="mfSeat__votes num" aria-label={M.table.votes(votes)}>{votes}</span>}
          </span>
          <span className="mfSeat__name truncate">{p.name}</span>
          <span className="mfSeat__tags">
            {you && <span className="mfTag">{M.table.you}</span>}
            {known && (you || !p.alive || family.has(id) || m.finalRoles) && (
              <span className="mfTag" data-team={ROLE_TEAM[known]}>{M.roles[known].name}</span>
            )}
            {priv?.boss === id && m.phase === 'night' && <span className="mfTag" data-team="mafia">{M.table.boss}</span>}
            {!p.alive && <span className="mfTag mfTag--dead">{M.table.dead}</span>}
            {m.silencedToday.includes(id) && p.alive && <span className="mfTag mfTag--bad">{M.table.silenced}</span>}
            {!p.isBot && !connected(id) && p.alive && <span className="mfTag">{M.table.away}</span>}
          </span>
          {votedFor && <span className="mfSeat__vote truncate">→ {m.players[votedFor]?.name}</span>}
          {markedBy.length > 0 && (
            <span className="mfSeat__vote mfSeat__vote--family truncate">
              ✕ {markedBy.map((b) => m.players[b]?.name).join(', ')}
            </span>
          )}
        </button>
        {canKickSeat(id) && m.phase !== 'game_over' && !you && !p.isBot && (
          <button
            type="button"
            className="mfSeat__kick btn btn--ghost btn--sm"
            title={t.table.mod.kickTitle(p.name)}
            aria-label={t.table.mod.kickTitle(p.name)}
            onClick={() => {
              // Two taps: removing a player is not something to do by accident.
              if (kickArmed === id) { setKickArmed(null); onKick(id); } else setKickArmed(id);
            }}
          >
            {kickArmed === id ? t.table.mod.kickSure : '✕'}
          </button>
        )}
      </li>
    );
  };

  if (layout === 'grid') {
    return <ul className="mfTown" aria-label={M.table.tabs.stage}>{m.seats.map(seat)}</ul>;
  }

  // Around the table, each vote is a thread from voter to suspect.
  const pos = (id: string) => {
    const a = (m.seats.indexOf(id) / n) * Math.PI * 2 + Math.PI / 2;
    return { x: 50 + 44 * Math.cos(a), y: 50 + 40 * Math.sin(a) };
  };
  return (
    <div className="mfRound">
      <svg className="mfRound__lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {m.phase === 'vote' && Object.entries(m.votes).map(([voter, target]) => {
          const a = pos(voter);
          const b = pos(target);
          return (
            <line key={voter} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              className="mfRound__line" data-mine={voter === myId || undefined} vectorEffect="non-scaling-stroke" />
          );
        })}
      </svg>
      <div className="mfRound__felt" aria-hidden />
      <ul className="mfRound__seats" aria-label={M.table.tabs.stage}>{m.seats.map(seat)}</ul>
    </div>
  );
}
