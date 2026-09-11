import type { Dict } from '../i18n/en';
import { spaceName, spaceShort, trReason } from '../i18n';
import type { GameEvent, GameState } from './types';

/**
 * One line of table talk, kept as the event it came from rather than as
 * text. The words are chosen when the line is drawn, so switching language
 * mid-game rewrites the whole log instead of leaving history in the old one.
 */
export interface LogLine {
  id: string;
  event: GameEvent;
  /** Player whose colour should tint the line, if any. */
  actor: string | null;
  tone: 'info' | 'good' | 'bad' | 'big';
}

export const money = (n: number): string =>
  `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

/** Which events earn a line, who it belongs to, and how loud it is. Null
 *  for events that are pure animation cues and would only add noise. */
export function logLine(e: GameEvent, seq: number): LogLine | null {
  const line = (actor: string | null, tone: LogLine['tone'] = 'info'): LogLine =>
    ({ id: `${seq}`, event: e, actor, tone });

  switch (e.type) {
    case 'GAME_STARTED': return line(null, 'big');
    case 'TURN_STARTED': return line(e.playerId);
    case 'DICE_ROLLED': return line(e.playerId);
    case 'PASSED_GO': return line(e.playerId, 'good');
    case 'BOUGHT': return line(e.playerId, 'good');
    case 'RENT_PAID': return line(e.from, 'bad');
    case 'TAX_PAID': return line(e.playerId, 'bad');
    case 'CARD_DRAWN': return line(e.playerId);
    case 'JAILED': return line(e.playerId, 'bad');
    case 'LEFT_JAIL': return line(e.playerId, 'good');
    case 'BUILT': return line(e.playerId, 'good');
    case 'SOLD_BUILDING': return line(e.playerId);
    case 'MORTGAGED': return line(e.playerId);
    case 'UNMORTGAGED': return line(e.playerId);
    case 'AUCTION_STARTED': return line(null, 'big');
    case 'AUCTION_BID': return line(e.playerId);
    case 'AUCTION_PASSED': return line(e.playerId);
    case 'AUCTION_WON': return line(e.playerId, 'good');
    case 'AUCTION_NOBODY': return line(null);
    case 'DEBT_INCURRED': return line(e.playerId, 'bad');
    case 'BANKRUPT': return line(e.playerId, 'big');
    case 'TRADE_PROPOSED': return line(e.offer.from);
    case 'TRADE_ACCEPTED': return line(e.offer.to, 'good');
    case 'TRADE_DECLINED': return line(e.offer.to);
    case 'TRADE_EXPIRED': return line(e.offer.from);
    case 'FREE_PARKING': return line(e.playerId, 'good');
    case 'GAME_OVER': return line(e.winnerId, 'big');
    // Movement and raw money moves are shown on the board itself; putting
    // them in the log as well just buries the interesting lines.
    case 'MOVED':
    case 'MONEY':
      return null;
  }
}

/** The words for one event, in the reader's language. */
export function describe(s: GameState, e: GameEvent, t: Dict): string {
  const name = (id: string): string => s.players[id]?.name ?? t.defaults.someone;
  const L = t.log;
  // A card's own sentence already ends in a full stop, and so does the line.
  const clause = (raw: string): string => trReason(t, raw).replace(/\.$/, '');

  switch (e.type) {
    case 'GAME_STARTED': return L.gameStarted;
    case 'TURN_STARTED': return L.turn(name(e.playerId));
    case 'DICE_ROLLED': return L.rolled(name(e.playerId), e.dice[0], e.dice[1], e.isDouble);
    case 'PASSED_GO': return L.passedGo(name(e.playerId), money(e.amount));
    case 'BOUGHT': return L.bought(name(e.playerId), spaceName(t, e.spaceId), money(e.price));
    case 'RENT_PAID': return L.rentPaid(name(e.from), name(e.to), money(e.amount), spaceShort(t, e.spaceId));
    case 'TAX_PAID': return L.taxPaid(name(e.playerId), money(e.amount), trReason(t, e.label));
    case 'CARD_DRAWN':
      return L.cardDrawn(name(e.playerId), t.decks[e.card.deck], t.cards[e.card.id] ?? e.card.text);
    case 'JAILED': return L.jailed(name(e.playerId), clause(e.reason));
    case 'LEFT_JAIL': return L.leftJail(name(e.playerId), clause(e.how));
    case 'BUILT':
      return e.houses === 5
        ? L.hotel(name(e.playerId), spaceShort(t, e.spaceId))
        : L.house(name(e.playerId), e.houses, spaceShort(t, e.spaceId));
    case 'SOLD_BUILDING': return L.sold(name(e.playerId), spaceShort(t, e.spaceId));
    case 'MORTGAGED': return L.mortgaged(name(e.playerId), spaceShort(t, e.spaceId), money(e.amount));
    case 'UNMORTGAGED': return L.unmortgaged(name(e.playerId), spaceShort(t, e.spaceId), money(e.amount));
    case 'AUCTION_STARTED': return L.auctionStarted(spaceName(t, e.spaceId));
    case 'AUCTION_BID': return L.bid(name(e.playerId), money(e.amount));
    case 'AUCTION_PASSED': return L.passed(name(e.playerId));
    case 'AUCTION_WON': return L.auctionWon(name(e.playerId), spaceName(t, e.spaceId), money(e.amount));
    case 'AUCTION_NOBODY': return L.auctionNobody(spaceName(t, e.spaceId));
    case 'DEBT_INCURRED': return L.debt(name(e.playerId), money(e.amount));
    case 'BANKRUPT':
      return e.creditorId
        ? L.bankruptTo(name(e.playerId), name(e.creditorId))
        : L.bankruptBank(name(e.playerId));
    case 'TRADE_PROPOSED': return L.tradeProposed(name(e.offer.from), name(e.offer.to));
    case 'TRADE_ACCEPTED': return L.tradeAccepted(name(e.offer.to), name(e.offer.from));
    case 'TRADE_DECLINED': return L.tradeDeclined(name(e.offer.to));
    case 'TRADE_EXPIRED': return L.tradeExpired(name(e.offer.from), name(e.offer.to));
    case 'FREE_PARKING': return L.freeParking(name(e.playerId), money(e.amount));
    case 'GAME_OVER': return e.winnerId ? L.wins(name(e.winnerId)) : L.draw;
    case 'MOVED':
    case 'MONEY':
      return '';
  }
}
