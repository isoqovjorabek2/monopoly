import { BOARD } from './board';
import type { GameEvent, GameState } from './types';

export interface LogLine {
  id: string;
  text: string;
  /** Player whose colour should tint the line, if any. */
  actor: string | null;
  tone: 'info' | 'good' | 'bad' | 'big';
}

export const money = (n: number): string =>
  `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

/** Turn one engine event into one line of table talk. Returns null for
 *  events that are pure animation cues and would only add noise. */
export function describe(s: GameState, e: GameEvent, seq: number): LogLine | null {
  const name = (id: string): string => s.players[id]?.name ?? 'Someone';
  const line = (text: string, actor: string | null, tone: LogLine['tone'] = 'info'): LogLine =>
    ({ id: `${seq}`, text, actor, tone });

  switch (e.type) {
    case 'GAME_STARTED':
      return line('The game begins.', null, 'big');

    case 'TURN_STARTED':
      return line(`${name(e.playerId)}'s turn.`, e.playerId);

    case 'DICE_ROLLED':
      return line(
        `${name(e.playerId)} rolled ${e.dice[0]} and ${e.dice[1]}${e.isDouble ? ' - doubles!' : ''}`,
        e.playerId,
      );

    case 'PASSED_GO':
      return line(`${name(e.playerId)} passed GO and collected ${money(e.amount)}.`, e.playerId, 'good');

    case 'BOUGHT':
      return line(
        `${name(e.playerId)} bought ${BOARD[e.spaceId].name} for ${money(e.price)}.`,
        e.playerId, 'good',
      );

    case 'RENT_PAID':
      return line(
        `${name(e.from)} paid ${name(e.to)} ${money(e.amount)} for ${BOARD[e.spaceId].short}.`,
        e.from, 'bad',
      );

    case 'TAX_PAID':
      return line(`${name(e.playerId)} paid ${money(e.amount)} in ${e.label}.`, e.playerId, 'bad');

    case 'CARD_DRAWN':
      return line(
        `${name(e.playerId)} drew ${e.card.deck === 'chance' ? 'Chance' : 'Community Chest'}: ${e.card.text}`,
        e.playerId,
      );

    case 'JAILED':
      return line(`${name(e.playerId)} went to jail - ${e.reason}.`, e.playerId, 'bad');

    case 'LEFT_JAIL':
      return line(`${name(e.playerId)} left jail (${e.how}).`, e.playerId, 'good');

    case 'BUILT':
      return line(
        e.houses === 5
          ? `${name(e.playerId)} put a hotel on ${BOARD[e.spaceId].short}.`
          : `${name(e.playerId)} built house ${e.houses} on ${BOARD[e.spaceId].short}.`,
        e.playerId, 'good',
      );

    case 'SOLD_BUILDING':
      return line(`${name(e.playerId)} sold a building on ${BOARD[e.spaceId].short}.`, e.playerId);

    case 'MORTGAGED':
      return line(
        `${name(e.playerId)} mortgaged ${BOARD[e.spaceId].short} for ${money(e.amount)}.`,
        e.playerId,
      );

    case 'UNMORTGAGED':
      return line(
        `${name(e.playerId)} lifted the mortgage on ${BOARD[e.spaceId].short} for ${money(e.amount)}.`,
        e.playerId,
      );

    case 'AUCTION_STARTED':
      return line(`${BOARD[e.spaceId].name} goes to auction.`, null, 'big');

    case 'AUCTION_BID':
      return line(`${name(e.playerId)} bid ${money(e.amount)}.`, e.playerId);

    case 'AUCTION_PASSED':
      return line(`${name(e.playerId)} passed.`, e.playerId);

    case 'AUCTION_WON':
      return line(
        `${name(e.playerId)} won ${BOARD[e.spaceId].name} at auction for ${money(e.amount)}.`,
        e.playerId, 'good',
      );

    case 'AUCTION_NOBODY':
      return line(`Nobody bid on ${BOARD[e.spaceId].name}. It stays with the bank.`, null);

    case 'DEBT_INCURRED':
      return line(
        `${name(e.playerId)} owes ${money(e.amount)} and must raise the cash.`,
        e.playerId, 'bad',
      );

    case 'BANKRUPT':
      return line(
        e.creditorId
          ? `${name(e.playerId)} is bankrupt. Everything goes to ${name(e.creditorId)}.`
          : `${name(e.playerId)} is bankrupt. The estate returns to the bank.`,
        e.playerId, 'big',
      );

    case 'TRADE_PROPOSED':
      return line(`${name(e.offer.from)} offered ${name(e.offer.to)} a trade.`, e.offer.from);

    case 'TRADE_ACCEPTED':
      return line(`${name(e.offer.to)} accepted the trade with ${name(e.offer.from)}.`, e.offer.to, 'good');

    case 'TRADE_DECLINED':
      return line(`${name(e.offer.to)} declined the trade.`, e.offer.to);

    case 'TRADE_EXPIRED':
      return line(`${name(e.offer.from)}'s offer to ${name(e.offer.to)} lapsed.`, e.offer.from);

    case 'FREE_PARKING':
      return line(`${name(e.playerId)} scooped ${money(e.amount)} off Free Parking.`, e.playerId, 'good');

    case 'GAME_OVER':
      return line(
        e.winnerId ? `${name(e.winnerId)} wins.` : 'The game ended in a draw.',
        e.winnerId, 'big',
      );

    // Movement and raw money moves are shown on the board itself; putting
    // them in the log as well just buries the interesting lines.
    case 'MOVED':
    case 'MONEY':
      return null;
  }
}
