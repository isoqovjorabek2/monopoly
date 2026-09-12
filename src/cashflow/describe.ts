import type { Dict } from '../i18n/en';
import { money } from '../game/describe';
import { FAST_BOARD, cfCard } from './data';
import type { CFEvent, CFState } from './types';

/**
 * One line of the Cashflow table log. Kept as the event, like the Monopoly
 * log, so switching language rewrites history instead of freezing it.
 */
export interface CFLogLine {
  id: string;
  event: CFEvent;
  actor: string | null;
  tone: 'info' | 'good' | 'bad' | 'big';
}

export function cfLogLine(e: CFEvent, seq: number): CFLogLine | null {
  const line = (actor: string | null, tone: CFLogLine['tone'] = 'info'): CFLogLine =>
    ({ id: `${seq}`, event: e, actor, tone });

  switch (e.type) {
    // Movement is shown on the board itself.
    case 'MOVED': return null;
    case 'GAME_STARTED': return line(null, 'big');
    case 'DREAMS_OPEN': return line(null);
    case 'DREAM_CHOSEN': return line(e.playerId);
    case 'TURN_STARTED': return line(e.playerId);
    case 'TURN_SKIPPED': return line(e.playerId, 'bad');
    case 'ROLLED': return line(e.playerId);
    case 'PAYDAY': return line(e.playerId, e.amount >= 0 ? 'good' : 'bad');
    case 'CASHFLOW_DAY': return line(e.playerId, 'good');
    case 'CARD': return line(e.playerId);
    case 'BOUGHT_STOCK': return line(e.playerId, 'good');
    case 'SOLD_STOCK': return line(e.playerId, 'good');
    case 'SPLIT': return line(null);
    case 'BOUGHT_HOLDING': return line(e.playerId, 'good');
    case 'SOLD_HOLDING': return line(e.playerId, 'good');
    case 'BOOST': return line(null, 'good');
    case 'REPAIR': return line(e.playerId, 'bad');
    case 'FORECLOSED': return line(e.playerId, 'bad');
    case 'DOODAD': return line(e.playerId, e.amount > 0 ? 'bad' : 'info');
    case 'LOAN': return line(e.playerId, e.forced ? 'bad' : 'info');
    case 'REPAID': return line(e.playerId, 'good');
    case 'PAID_OFF': return line(e.playerId, 'good');
    case 'CHARITY': return line(e.playerId);
    case 'BABY': return line(e.playerId);
    case 'DOWNSIZED': return line(e.playerId, 'bad');
    case 'BANKRUPT': return line(e.playerId, 'big');
    case 'ESCAPED': return line(e.playerId, 'big');
    case 'BUSINESS': return line(e.playerId, 'good');
    case 'VENTURE': return line(e.playerId, e.won ? 'good' : 'bad');
    case 'DREAM_MARKED': return line(e.playerId);
    case 'LOSS': return line(e.playerId, 'bad');
    case 'DREAM_BOUGHT': return line(e.playerId, 'big');
    case 'TIMED_OUT': return line(e.playerId, 'bad');
    case 'GAME_OVER': return line(e.winnerId, 'big');
  }
}

/** The name of a Fast Track square: its business, venture or dream, or its kind. */
export function fastName(t: Dict, spaceId: number): string {
  const sp = FAST_BOARD[spaceId];
  if (!sp) return '';
  return (sp.key && t.cf.fast[sp.key]) || t.cf.spaces[sp.kind] || sp.kind;
}

const noStop = (x: string): string => x.replace(/\.$/, '');

/** A card, short enough for one log line. */
export function cardTitle(t: Dict, cardId: string): string {
  const c = cfCard(cardId);
  if (!c) return cardId;
  const C = t.cf.card;
  switch (c.deck) {
    case 'doodad':
      return t.cf.doodads[c.id] ?? c.id;
    case 'market':
      switch (c.kind) {
        case 'offer': return `${noStop(C.offer(t.cf.tags[c.tag]))} — ${C.offerPrice(money(c.price), c.perUnit)}`;
        case 'boost': return noStop(C.boost(t.cf.tags[c.tag], money(c.delta)));
        case 'repair': return noStop(C.repair(money(c.cost)));
        case 'foreclose': return noStop(C.foreclose(t.cf.tags[c.tag]));
      }
      return cardId;
    default:
      switch (c.kind) {
        case 'stock': return `${c.symbol} ${money(c.price)}`;
        case 'split': return noStop(c.factor === 2 ? t.cf.log.split(c.symbol) : t.cf.log.reverse(c.symbol));
        case 'holding': return `${t.cf.tags[c.tag]}, ${money(c.cost)}`;
      }
  }
  return cardId;
}

/** The words for one event, in the reader's language. */
export function cfDescribe(s: CFState, e: CFEvent, t: Dict): string {
  const name = (id: string | null): string => (id && s.players[id]?.name) || t.defaults.someone;
  const L = t.cf.log;

  switch (e.type) {
    case 'MOVED': return '';
    case 'GAME_STARTED': return L.gameStarted;
    case 'DREAMS_OPEN': return L.dreamsOpen;
    case 'DREAM_CHOSEN': return L.dreamChosen(name(e.playerId), fastName(t, e.spaceId));
    case 'TURN_STARTED': return L.turn(name(e.playerId));
    case 'TURN_SKIPPED': return L.skipped(name(e.playerId), e.left);
    case 'ROLLED': return L.rolled(name(e.playerId), e.dice.join(' + '));
    case 'PAYDAY':
      return e.amount >= 0
        ? L.payday(name(e.playerId), money(e.amount))
        : L.paydayNegative(name(e.playerId), money(-e.amount));
    case 'CASHFLOW_DAY': return L.cashflowDay(name(e.playerId), money(e.amount));
    case 'CARD': {
      const c = cfCard(e.cardId);
      const deck = c ? t.cf.decks[c.deck] : '';
      return L.card(name(e.playerId), deck, cardTitle(t, e.cardId));
    }
    case 'BOUGHT_STOCK': return L.boughtStock(name(e.playerId), e.shares, e.symbol, money(e.price));
    case 'SOLD_STOCK': return L.soldStock(name(e.playerId), e.shares, e.symbol, money(e.price));
    case 'SPLIT': return e.factor === 2 ? L.split(e.symbol) : L.reverse(e.symbol);
    case 'BOUGHT_HOLDING':
      return L.boughtHolding(name(e.playerId), t.cf.tags[e.tag], money(e.down), money(e.cashflow));
    case 'SOLD_HOLDING': return L.soldHolding(name(e.playerId), t.cf.tags[e.tag], money(e.settlement));
    case 'BOOST': return L.boost(t.cf.tags[e.tag], money(e.delta));
    case 'REPAIR': return L.repair(name(e.playerId), money(e.cost));
    case 'FORECLOSED': return L.foreclosed(name(e.playerId), e.count, t.cf.tags[e.tag]);
    case 'DOODAD': {
      const what = t.cf.doodads[e.cardId] ?? e.cardId;
      return e.amount > 0 ? L.doodad(name(e.playerId), what, money(e.amount)) : L.doodadFree(name(e.playerId), what);
    }
    case 'LOAN': return e.forced ? L.loanForced(name(e.playerId), money(e.amount)) : L.loan(name(e.playerId), money(e.amount));
    case 'REPAID': return L.repaid(name(e.playerId), money(e.amount));
    case 'PAID_OFF': return L.paidOff(name(e.playerId), t.cf.debts[e.debt], money(e.amount));
    case 'CHARITY': return L.charity(name(e.playerId), money(e.amount));
    case 'BABY': return L.baby(name(e.playerId), e.children);
    case 'DOWNSIZED': return L.downsized(name(e.playerId), money(e.amount));
    case 'BANKRUPT': return e.out ? L.bankruptOut(name(e.playerId)) : L.bankrupt(name(e.playerId));
    case 'ESCAPED': return L.escaped(name(e.playerId), money(e.income));
    case 'BUSINESS':
      return L.business(name(e.playerId), fastName(t, e.spaceId), money(e.cost), money(e.cashflow));
    case 'VENTURE':
      return e.won
        ? L.ventureWon(name(e.playerId), fastName(t, e.spaceId), e.roll)
        : L.ventureLost(name(e.playerId), fastName(t, e.spaceId), e.roll);
    case 'DREAM_MARKED': return L.dreamMarked(name(e.playerId), name(e.owner), fastName(t, e.spaceId));
    case 'LOSS': return L[e.kind](name(e.playerId), money(e.amount));
    case 'DREAM_BOUGHT': return L.dreamBought(name(e.playerId), fastName(t, e.spaceId), money(e.cost));
    case 'TIMED_OUT': return t.log.timedOut(name(e.playerId));
    case 'GAME_OVER':
      return e.reason === 'none' || !e.winnerId ? L.over.none : L.over[e.reason](name(e.winnerId));
  }
}
