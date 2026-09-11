import { cfSpaceArt, type CFSpaceArt } from '../../art/art';
import { cfCard } from '../../cashflow/data';
import type { CFDeck, CFState } from '../../cashflow/types';
import { cap, useT } from '../../i18n';
import { fmt } from '../bits';

const DECK_ART: Record<CFDeck, CFSpaceArt> = {
  small: 'small', big: 'big', market: 'market', doodad: 'doodad',
};

const signed = (n: number): string => `${n < 0 ? '−' : '+'}${fmt(Math.abs(n))}`;

/**
 * The card on the table, printed the way the deck prints it: the numbers
 * a player has to weigh - cost, down payment, what it earns - set out as
 * a ledger, so reading a deal is reading a deal and not a paragraph.
 */
export function CFTableCardView({ s }: { s: CFState }) {
  const t = useT();
  const C = t.cf.card;
  if (!s.card) return null;
  const card = cfCard(s.card.id);
  if (!card) return null;
  const by = s.players[s.card.by];

  let body: JSX.Element;
  if (card.deck === 'doodad') {
    body = (
      <>
        <p className="cfCard__title">{t.cf.doodads[card.id]}</p>
        <p className="cfCard__big num">{C.doodadPay(fmt(card.amount))}</p>
        {card.child && <p className="cfCard__note">{C.childOnly}</p>}
      </>
    );
  } else if (card.deck === 'market') {
    switch (card.kind) {
      case 'offer':
        body = (
          <>
            <p className="cfCard__title">{C.offer(t.cf.tags[card.tag])}</p>
            <p className="cfCard__big num">{C.offerPrice(fmt(card.price), card.perUnit)}</p>
            <p className="cfCard__note">{C.offerNote}</p>
          </>
        );
        break;
      case 'boost':
        body = <p className="cfCard__title">{C.boost(t.cf.tags[card.tag], fmt(card.delta))}</p>;
        break;
      case 'repair':
        body = <p className="cfCard__title">{C.repair(fmt(card.cost))}</p>;
        break;
      case 'foreclose':
        body = <p className="cfCard__title">{C.foreclose(t.cf.tags[card.tag])}</p>;
        break;
    }
  } else if (card.kind === 'stock') {
    body = (
      <>
        <p className="cfCard__title cfCard__symbol">{card.symbol}</p>
        <p className="cfCard__sub">{t.cf.stocks[card.symbol] ?? C.stock}</p>
        <dl className="cfCard__rows">
          <div><dt>{C.today}</dt><dd className="num">{fmt(card.price)}</dd></div>
          <div>
            <dt>{C.dividend}</dt>
            <dd className="num">{card.dividend > 0 ? C.perShare(C.perMonth(fmt(card.dividend))) : C.noDividend}</dd>
          </div>
        </dl>
        <p className="cfCard__note">{C.range(fmt(card.range[0]), fmt(card.range[1]))}. {C.stockNote}</p>
      </>
    );
  } else if (card.kind === 'split') {
    body = (
      <>
        <p className="cfCard__title cfCard__symbol">{card.symbol}</p>
        <p className="cfCard__note">{card.factor === 2 ? C.split(card.symbol) : C.reverse(card.symbol)}</p>
      </>
    );
  } else {
    const roi = card.down > 0 ? Math.round(((card.cashflow * 12) / card.down) * 100) : 0;
    const units = card.units > 1 || card.tag === 'land' ? ` · ${t.cf.units(card.tag, card.units)}` : '';
    body = (
      <>
        <p className="cfCard__title">{cap(t.cf.tags[card.tag])}{units}</p>
        <dl className="cfCard__rows">
          <div><dt>{C.cost}</dt><dd className="num">{fmt(card.cost)}</dd></div>
          <div><dt>{C.down}</dt><dd className="num">{fmt(card.down)}</dd></div>
          {card.cost > card.down && <div><dt>{C.mortgage}</dt><dd className="num">{fmt(card.cost - card.down)}</dd></div>}
          <div data-neg={card.cashflow < 0 || undefined}>
            <dt>{C.cashflow}</dt><dd className="num">{C.perMonth(signed(card.cashflow))}</dd>
          </div>
          {card.cashflow !== 0 && <div><dt>{C.roi}</dt><dd className="num">{roi}%</dd></div>}
        </dl>
        {card.cashflow < 0 && <p className="cfCard__note cfCard__note--bad">{C.losing}</p>}
      </>
    );
  }

  return (
    <article className="cfCard" data-deck={card.deck} data-used={s.card.used || undefined}>
      <header className="cfCard__head">
        <img className="cfCard__emblem" src={cfSpaceArt(DECK_ART[card.deck])} alt="" width={40} height={40} />
        <span className="cfCard__deck">{t.cf.decks[card.deck]}</span>
      </header>
      <div className="cfCard__body">{body}</div>
      <footer className="cfCard__by" style={{ color: by?.color }}>{C.drawnBy(by?.name ?? '')}</footer>
    </article>
  );
}
