import { currentId, passiveIncome, progress, totalExpenses } from '../../cashflow/rules';
import type { CFState } from '../../cashflow/types';
import { useT } from '../../i18n';
import type { CashFloat } from '../../store/store';
import type { SeatInfo } from '../../net/protocol';
import { Avatar, Money, fmt } from '../bits';
import { useEffect, useState } from 'react';

/**
 * Who is where. The one number that matters in Cashflow is how close each
 * player is to getting out, so every seat carries it as a bar: passive
 * income against expenses in the Rat Race, new income against the goal on
 * the Fast Track.
 */
export function CFRail({
  s, myId, floats, onOpen, seats, coowners, canKickSeat, onKick,
}: {
  s: CFState;
  myId: string;
  floats: CashFloat[];
  onOpen: (id: string) => void;
  /** Room seats, for moderation state the game state does not carry. */
  seats?: SeatInfo[];
  coowners?: string[];
  canKickSeat?: (id: string) => boolean;
  onKick?: (id: string) => void;
}) {
  const t = useT();
  const R = t.cf.rail;
  const cur = currentId(s);
  // Two taps, as on the Monopoly rail: the first arms, the second lands.
  const [kickArmed, setKickArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!kickArmed) return undefined;
    const timer = window.setTimeout(() => setKickArmed(null), 4000);
    return () => window.clearTimeout(timer);
  }, [kickArmed]);

  return (
    <ol className="cfRail">
      {s.seats.map((id) => {
        const p = s.players[id];
        const active = cur === id && s.phase !== 'game_over' && s.phase !== 'dreams';
        const pct = Math.round(Math.min(1, Math.max(0, p.track === 'rat' ? progress(s, p) : progress(s, p) - 1)) * 100);
        return (
          <li key={id} className="cfSeat" data-active={active || undefined} data-out={p.out || undefined} data-fast={p.track === 'fast' || undefined}>
            <button type="button" className="cfSeat__btn" onClick={() => onOpen(id)}>
              <Avatar color={p.color} token={p.token} size={34} active={active} dim={!p.connected || p.out} />
              <span className="cfSeat__who">
                <span className="cfSeat__name truncate">
                  {p.name}{id === myId ? ` · ${t.common.you}` : ''}
                  {coowners?.includes(id) ? ` · ${t.table.mod.coowner}` : ''}
                </span>
                <span className="cfSeat__job truncate">{t.cf.professions[p.profession]}</span>
              </span>
              <Money value={p.cash} className="cfSeat__cash" />
              <span className="cfSeat__bar" data-fast={p.track === 'fast' || undefined}>
                <span style={{ width: `${pct}%` }} />
              </span>
              <span className="cfSeat__meta">
                <span className="chip" data-tone={p.track === 'fast' ? 'good' : undefined}>
                  {p.out ? R.out : p.track === 'rat' ? R.ratRace : R.fastTrack}
                </span>
                <span className="num">
                  {p.track === 'rat'
                    ? R.passive(fmt(passiveIncome(p)), fmt(totalExpenses(p)))
                    : R.day(fmt(p.fastIncome), fmt(p.fastGoal))}
                </span>
              </span>
              {(p.skipTurns > 0 || p.charityTurns > 0 || p.children > 0) && (
                <span className="cfSeat__chips">
                  {p.skipTurns > 0 && <span className="chip" data-tone="bad">{R.sitting(p.skipTurns)}</span>}
                  {p.charityTurns > 0 && <span className="chip">{R.charity(p.charityTurns)}</span>}
                  {p.children > 0 && <span className="chip">{R.kids(p.children)}</span>}
                </span>
              )}
              {floats.filter((f) => f.playerId === id).map((f) => (
                <span key={f.id} className="cfFloat num" data-neg={f.delta < 0 || undefined}>
                  {f.delta > 0 ? '+' : '−'}{fmt(Math.abs(f.delta))}
                </span>
              ))}
            </button>
            {seats && canKickSeat?.(id) && (
              <button
                type="button"
                className="playerKick"
                data-armed={kickArmed === id || undefined}
                title={t.table.mod.kickTitle(p.name)}
                onClick={() => {
                  if (kickArmed === id) { setKickArmed(null); onKick?.(id); }
                  else setKickArmed(id);
                }}
              >
                {kickArmed === id ? t.table.mod.kickSure : '✕'}
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
