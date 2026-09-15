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
  const myId = useStore((s) => s.me.playerId);
  const takeSeat = useStore((s) => s.takeSeat);
  if (!room) return null;
  const policy = room.settings.takeovers ?? 'ask';
  const mine = room.seatRequests?.find((r) => r.uid === myId);
  const askedFor = mine ? room.seats.find((s) => s.playerId === mine.target)?.name ?? '' : '';

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
      <p className="muted small">
        {policy === 'off' ? A.closed
          : mine ? A.waitingHost(askedFor)
            : bots.length > 0 && !over ? A.watchingNote : A.noSeats}
      </p>
      {!over && bots.length > 0 && policy !== 'off' && (
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
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={Boolean(mine)}
                  onClick={() => takeSeat(seat.playerId)}
                >
                  {mine?.target === seat.playerId ? A.asked : A.takeSeat(seat.name)}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!over && bots.length > 0 && policy === 'ask' && !mine && (
        <p className="muted small">{A.askNote}</p>
      )}
    </section>
  );
}

/**
 * Watchers waiting on the host's say-so, as cards in the host's side
 * column - the same place trade offers wait, for the same reason: it is a
 * question, not an interruption, and the game goes on around it.
 */
export function SeatRequestsDock() {
  const t = useT();
  const A = t.account;
  const room = useStore((s) => s.room);
  const role = useStore((s) => s.role);
  const answer = useStore((s) => s.answerSeatRequest);
  const requests = room?.seatRequests ?? [];
  if (role !== 'host' || !room || requests.length === 0) return null;

  return (
    <aside className="offerDock" aria-live="polite">
      {requests.map((r) => {
        const seat = room.seats.find((s) => s.playerId === r.target);
        return (
          <article key={r.uid} className="offerCard seatRequest">
            <div className="offerCard__head seatRequest__head">
              {seat && <Avatar color={seat.color} token={seat.token} size={26} />}
              <span className="offerCard__who">{A.request(r.name, seat?.name ?? '')}</span>
            </div>
            <footer className="offerCard__foot">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => answer(r.uid, false)}>
                {A.deny}
              </button>
              <button type="button" className="btn btn--primary btn--sm" onClick={() => answer(r.uid, true)}>
                {A.allow}
              </button>
            </footer>
          </article>
        );
      })}
    </aside>
  );
}
