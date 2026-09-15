import { useStore } from '../store/store';
import { ownedBy } from '../game/rules';
import { useT } from '../i18n';
import { Avatar, fmt } from './bits';

/* ==================================================================== *
 * The panel a signed-in watcher uses to take over a bot in a game in
 * progress. Signing in itself lives on the front door (Entry.tsx).
 * ==================================================================== */

/**
 * What a signed-in watcher sees instead of the action bar: the game's bots,
 * with what each one holds, and a button to play on as it. Monopoly and
 * Cashflow both come through here, reading whichever game the room plays.
 */
export function TakeSeatPanel() {
  const t = useT();
  const A = t.account;
  const room = useStore((s) => s.room);
  const takeSeat = useStore((s) => s.takeSeat);
  if (!room) return null;

  const bots = room.seats.filter((seat) => {
    if (!seat.isBot) return false;
    if (room.game) {
      const p = room.game.players[seat.playerId];
      return Boolean(p) && !p.bankrupt;
    }
    return Boolean(room.cf?.players[seat.playerId]);
  });
  const over = (room.game?.phase ?? room.cf?.phase) === 'game_over';

  return (
    <section className="actions takeSeat" aria-live="polite">
      <p className="actions__title">{A.watching}</p>
      <p className="muted small">{bots.length > 0 && !over ? A.watchingNote : A.noSeats}</p>
      {!over && bots.length > 0 && (
        <ul className="takeSeat__list">
          {bots.map((seat) => {
            const cash = room.game?.players[seat.playerId]?.cash ?? room.cf?.players[seat.playerId]?.cash ?? 0;
            const deeds = room.game ? ownedBy(room.game, seat.playerId).length : null;
            return (
              <li key={seat.playerId} className="takeSeat__row" style={{ ['--pc' as string]: seat.color } as React.CSSProperties}>
                <Avatar color={seat.color} token={seat.token} size={30} />
                <span className="takeSeat__info">
                  <span className="takeSeat__name truncate">{seat.name}</span>
                  <span className="takeSeat__meta num">
                    {deeds === null ? fmt(cash) : A.seatSummary(fmt(cash), deeds)}
                  </span>
                </span>
                <button type="button" className="btn btn--primary btn--sm" onClick={() => takeSeat(seat.playerId)}>
                  {A.takeSeat(seat.name)}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
