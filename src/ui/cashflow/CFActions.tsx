import { useEffect, useMemo, useState } from 'react';
import { TakeSeatPanel } from '../Account';
import { FAST_BOARD, FEE_STEP, HOLD_SECONDS, LOAN_UNIT, RAT_BOARD } from '../../cashflow/data';
import {
  charityCost, clockKey, clockSeconds, currentId, dealImpact, dreamPrice, holdKey, holdingCard, legalActions,
  maxFee, maxLoan, settlement, tableCard,
} from '../../cashflow/rules';
import type { CFAction, CFPlayer, CFState } from '../../cashflow/types';
import { money } from '../../game/describe';
import { useT } from '../../i18n';
import { fmt, useCountdown } from '../bits';
import { CFTableCardView } from './CFCard';

type Dispatch = (a: CFAction) => void;

/**
 * What you can do right now, and nothing else. Every button here comes
 * from legalActions(), so the panel can never offer a move the engine
 * would refuse - and a control that is missing says why underneath.
 */
export function CFActions({
  s, myId, dispatch, away,
}: { s: CFState; myId: string; dispatch: Dispatch; away?: (id: string) => boolean }) {
  const t = useT();
  const A = t.cf.actions;
  const me = s.players[myId];
  const legal = useMemo(() => legalActions(s, myId), [s, myId]);
  const curId = currentId(s);
  const cur = s.players[curId];
  const isMine = curId === myId;
  const left = useCountdown(clockSeconds(s), clockKey(s));
  const clock = left != null && <span className="actions__timer num"> {t.common.seconds(left)}</span>;

  // On a phone the board is too small to carry the card, so it sits here.
  const cardBlock = s.card ? <div className="cfActions__card"><CFTableCardView s={s} /></div> : null;

  if (!me) return <TakeSeatPanel />;

  if (me.out) {
    return (
      <section className="actions">
        <p className="actions__title">{A.spectating}</p>
        <p className="muted small">{A.spectatingNote}</p>
      </section>
    );
  }

  if (s.phase === 'game_over') return null;

  if (s.phase === 'dreams') {
    return (
      <section className="actions">
        <p className="actions__title">{A.chooseDream}{me.dream == null && clock}</p>
        <p className="muted small">{me.dream == null ? A.chooseDreamNote : A.waitingDreams}</p>
      </section>
    );
  }

  if (!isMine) {
    return (
      <section className="actions">
        <p className="actions__title" style={{ color: cur?.color }}>{A.theirTurn(cur?.name ?? '')}</p>
        <p className="muted small">{me.skipTurns > 0 ? A.sitting(me.skipTurns) : A.waitNote}</p>
        {cardBlock}
        <TakeControls s={s} me={me} legal={legal} dispatch={dispatch} />
        <SaleControls s={s} me={me} legal={legal} dispatch={dispatch} />
      </section>
    );
  }

  return (
    <section className="actions actions--mine">
      <p className="actions__title">{A.yourTurn}{clock}</p>

      {s.phase === 'roll' && <RollControls me={me} legal={legal} dispatch={dispatch} />}

      {s.phase === 'choose_deal' && (
        <>
          <p className="actions__lead">{A.opportunity}</p>
          <p className="muted small">{A.pickDeck}</p>
          <div className="actions__row">
            <button type="button" className="btn" onClick={() => dispatch({ type: 'DRAW_DEAL', playerId: myId, deck: 'small' })}>
              {A.drawSmall}
            </button>
            <button type="button" className="btn btn--primary" onClick={() => dispatch({ type: 'DRAW_DEAL', playerId: myId, deck: 'big' })}>
              {A.drawBig}
            </button>
          </div>
        </>
      )}

      {s.phase === 'turn_end' && (
        <>
          {cardBlock}
          <BuyControls s={s} me={me} legal={legal} dispatch={dispatch} />
          <SaleControls s={s} me={me} legal={legal} dispatch={dispatch} />
          <LandingControls s={s} me={me} legal={legal} dispatch={dispatch} />
          <EndTurn s={s} myId={myId} dispatch={dispatch} away={away} />
        </>
      )}
    </section>
  );
}

interface Part { s: CFState; me: CFPlayer; legal: CFAction[]; dispatch: Dispatch }

/** True until `seconds` have passed since `key` last changed; a null key
 *  is never held. */
function useHold(key: string | null, seconds: number): boolean {
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    if (!key) return undefined;
    const timer = window.setTimeout(() => setDone(key), seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [key, seconds]);
  return key !== null && done !== key;
}

/**
 * End Turn, held for a few seconds while someone else at the table could
 * still sell into the card or take the deal. The hold shows as a line of
 * brass burning round the button's edge; when it has burnt through, the
 * button - and Space - work again.
 */
function EndTurn({
  s, myId, dispatch, away,
}: { s: CFState; myId: string; dispatch: Dispatch; away?: (id: string) => boolean }) {
  const t = useT();
  const A = t.cf.actions;
  const key = holdKey(s, away);
  const held = useHold(key, HOLD_SECONDS);
  const left = useCountdown(held ? HOLD_SECONDS : 0, key ?? '');
  return (
    <>
      <button
        type="button"
        className="btn btn--primary btn--block cfEndTurn"
        data-hotkey="advance"
        data-held={held || undefined}
        disabled={held}
        aria-describedby={held ? 'cf-hold-note' : undefined}
        onClick={() => dispatch({ type: 'END_TURN', playerId: myId })}
      >
        {held && (
          <svg className="cfEndTurn__fuse" aria-hidden="true" key={key ?? ''}>
            <rect className="cfEndTurn__line" pathLength={100} style={{ animationDuration: `${HOLD_SECONDS}s` }} />
          </svg>
        )}
        {A.endTurn}
        {held && left != null ? <span className="num cfEndTurn__left">{left}</span> : <kbd className="kbd">{t.common.keySpace}</kbd>}
      </button>
      {held && <p id="cf-hold-note" className="muted small">{A.holdNote}</p>}
    </>
  );
}

function RollControls({ me, legal, dispatch }: Omit<Part, 's'>) {
  const t = useT();
  const A = t.cf.actions;
  const rolls = legal
    .filter((a): a is Extract<CFAction, { type: 'ROLL' }> => a.type === 'ROLL')
    .sort((a, b) => (a.dice ?? 1) - (b.dice ?? 1));
  const best = rolls[rolls.length - 1];
  return (
    <>
      <p className="muted small">
        {me.track === 'rat' ? A.rollNote : A.rollFastNote}
        {me.track === 'rat' && me.charityTurns > 0 && <> {A.charityDice(me.charityTurns)}</>}
      </p>
      <div className="actions__row">
        {rolls.map((r) => (
          <button
            key={r.dice}
            type="button"
            className={r === best ? 'btn btn--primary' : 'btn'}
            data-hotkey={r === best ? 'advance' : undefined}
            onClick={() => dispatch(r)}
          >
            {A.roll(r.dice ?? 1)}
            {r === best && <kbd className="kbd">{t.common.keySpace}</kbd>}
          </button>
        ))}
      </div>
    </>
  );
}

/** Buying what you drew. Keyed by the card, so the share count resets when
 *  a new one comes up. */
function BuyControls({ s, me, legal, dispatch }: Part) {
  const card = tableCard(s);
  if (!card || !s.card || s.card.by !== me.id || card.deck === 'market' || card.deck === 'doodad') return null;
  if (card.kind === 'stock') return <StockBuy key={s.card.id} s={s} me={me} legal={legal} dispatch={dispatch} />;
  if (card.kind === 'holding') return <DealBuy s={s} me={me} legal={legal} dispatch={dispatch} />;
  return null;
}

function StockBuy({ s, me, dispatch }: Part) {
  const t = useT();
  const A = t.cf.actions;
  const card = tableCard(s);
  const price = card && card.deck !== 'market' && card.deck !== 'doodad' && card.kind === 'stock' ? card.price : 0;
  const max = price > 0 ? Math.floor(me.cash / price) : 0;
  const [n, setN] = useState(() => Math.max(1, Math.floor(max / 2)));
  if (max < 1) return <p className="muted small">{t.common.notEnoughCash}</p>;
  const shares = Math.min(Math.max(1, n), max);
  return (
    <div className="cfStepper">
      <div className="cfStepper__row">
        <button type="button" className="btn btn--sm btn--icon" onClick={() => setN(Math.max(1, shares - (shares > 100 ? 100 : 10)))} aria-label="−">−</button>
        <input
          className="field num cfStepper__field"
          type="number"
          min={1}
          max={max}
          value={shares}
          aria-label={A.sharesAria}
          onChange={(e) => setN(Math.floor(Number(e.target.value) || 1))}
        />
        <button type="button" className="btn btn--sm btn--icon" onClick={() => setN(Math.min(max, shares + (shares >= 100 ? 100 : 10)))} aria-label="+">+</button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => setN(max)}>max {max}</button>
      </div>
      <button
        type="button"
        className="btn btn--block"
        onClick={() => dispatch({ type: 'BUY_STOCK', playerId: me.id, shares })}
      >
        {A.buyShares(shares, fmt(shares * price))}
      </button>
    </div>
  );
}

function DealBuy({ s, me, legal, dispatch }: Part) {
  const t = useT();
  const A = t.cf.actions;
  const card = holdingCard(s);
  if (!card || !s.card) return null;
  if (s.card.used) return <p className="muted small">{A.bought}</p>;

  let buy: JSX.Element;
  let loan = 0;
  if (legal.some((a) => a.type === 'BUY_DEAL')) {
    buy = (
      <button type="button" className="btn btn--block" onClick={() => dispatch({ type: 'BUY_DEAL', playerId: me.id })}>
        {A.buyDeal(fmt(card.down))}
      </button>
    );
  } else {
    // Short: the bank can make up the difference if the pay cheque allows.
    loan = Math.ceil((card.down - me.cash) / LOAN_UNIT) * LOAN_UNIT;
    buy = loan > 0 && loan <= maxLoan(s, me) ? (
      <button
        type="button"
        className="btn btn--block"
        onClick={() => {
          dispatch({ type: 'TAKE_LOAN', playerId: me.id, amount: loan });
          dispatch({ type: 'BUY_DEAL', playerId: me.id });
        }}
      >
        {A.borrowToBuy(fmt(loan))}
      </button>
    ) : <p className="muted small">{A.cannotAfford}</p>;
    if (loan > maxLoan(s, me)) loan = 0;
  }
  return (
    <>
      <Impact me={me} cashflow={card.cashflow} loan={loan} />
      {buy}
      <OfferControls s={s} me={me} legal={legal} dispatch={dispatch} />
    </>
  );
}

/** What the deal would do to this player's own numbers - the part a deal
 *  card cannot print, because it depends on who is reading it. */
function Impact({ me, cashflow, loan = 0 }: { me: CFPlayer; cashflow: number; loan?: number }) {
  const t = useT();
  const I = t.cf.actions.impact;
  if (me.track !== 'rat') return null;
  const d = dealImpact(me, cashflow, loan);
  const out = (passive: number, expenses: number) => `${Math.min(100, Math.round((passive / Math.max(expenses, 1)) * 100))}%`;
  const tone = (a: number, b: number) => (b > a ? 'cfImpact__up' : b < a ? 'cfImpact__down' : undefined);
  const row = (label: string, before: string, after: string, cls?: string) => (
    <div className="cfImpact__row">
      <dt>{label}</dt>
      <dd className="num">{before} → <span className={cls}>{after}</span></dd>
    </div>
  );
  return (
    <dl className="cfImpact">
      <p className="cfImpact__head">{I.title}</p>
      {row(I.payCheck, money(d.payBefore), money(d.payAfter), tone(d.payBefore, d.payAfter))}
      {row(I.passive, fmt(d.passiveBefore), fmt(d.passiveAfter), tone(d.passiveBefore, d.passiveAfter))}
      {row(
        I.escape,
        out(d.passiveBefore, d.expensesBefore),
        out(d.passiveAfter, d.expensesAfter),
        tone(d.passiveBefore / Math.max(d.expensesBefore, 1), d.passiveAfter / Math.max(d.expensesAfter, 1)),
      )}
      {d.frees && <p className="cfImpact__frees">{I.frees}</p>}
    </dl>
  );
}

/** The drawer puts a deal they will not buy up for grabs. */
function OfferControls({ s, me, legal, dispatch }: Part) {
  const t = useT();
  const A = t.cf.actions;
  const card = holdingCard(s);
  if (!card || !s.card || s.card.used) return null;
  if (s.card.fee !== undefined) {
    return <p className="muted small">{s.card.fee > 0 ? A.offered(fmt(s.card.fee)) : A.offeredFree}</p>;
  }
  if (!legal.some((a) => a.type === 'OFFER_DEAL')) return null;
  const cap = maxFee(card);
  const at = (share: number) => Math.min(cap, Math.round((card.down * share) / FEE_STEP) * FEE_STEP);
  const fees = [...new Set([0, at(0.1), at(0.25)])];
  return (
    <div className="cfOffer">
      <p className="cfOffer__title">{A.offerTitle}</p>
      <div className="actions__row">
        {fees.map((fee) => (
          <button
            key={fee}
            type="button"
            className="btn btn--sm"
            onClick={() => dispatch({ type: 'OFFER_DEAL', playerId: me.id, fee })}
          >
            {fee === 0 ? A.offerFree : A.offerFor(fmt(fee))}
          </button>
        ))}
      </div>
      <p className="muted small">{A.offerNote}</p>
    </div>
  );
}

/** Somebody else's deal, passed across the table. */
function TakeControls({ s, me, legal, dispatch }: Part) {
  const t = useT();
  const A = t.cf.actions;
  const card = holdingCard(s);
  if (!card || !s.card || s.card.used || s.card.fee === undefined || s.card.by === me.id) return null;
  if (me.out || (me.track === 'fast' && card.cashflow <= 0)) return null;
  const fee = s.card.fee;
  const from = s.players[s.card.by]?.name ?? '';
  const can = legal.some((a) => a.type === 'TAKE_DEAL');
  return (
    <div className="cfOffer">
      <p className="cfOffer__title">{A.takeOffer(from)}</p>
      {me.track === 'rat'
        ? <Impact me={me} cashflow={card.cashflow} />
        : <p className="muted small">{A.businessNote(fmt(card.cashflow))}</p>}
      {can ? (
        <button type="button" className="btn btn--primary btn--block" onClick={() => dispatch({ type: 'TAKE_DEAL', playerId: me.id })}>
          {fee > 0 ? A.take(fmt(fee), fmt(card.down)) : A.takeFree(fmt(card.down))}
        </button>
      ) : <p className="muted small">{A.takeShort(fmt(card.down + fee))}</p>}
    </div>
  );
}

/** Selling into a card on the table - open to anyone who holds the asset,
 *  whoever's turn it is. */
function SaleControls({ s, me, legal, dispatch }: Part) {
  const t = useT();
  const A = t.cf.actions;
  const card = tableCard(s);
  const buttons: JSX.Element[] = [];
  for (const a of legal) {
    if (a.type === 'SELL_STOCK' && card && card.deck !== 'market' && card.deck !== 'doodad' && card.kind === 'stock') {
      buttons.push(
        <button key="stock" type="button" className="btn btn--block" onClick={() => dispatch(a)}>
          {A.sellShares(a.shares, fmt(a.shares * card.price))}
        </button>,
      );
    }
    if (a.type === 'SELL_HOLDING' && card && card.deck === 'market' && card.kind === 'offer') {
      const h = me.holdings.find((x) => x.id === a.holdingId);
      if (!h) continue;
      buttons.push(
        <button key={a.holdingId} type="button" className="btn btn--block" onClick={() => dispatch(a)}>
          {A.sell(t.cf.tags[h.tag], money(settlement(card, h)))}
        </button>,
      );
    }
  }
  return buttons.length ? <div className="cfActions__stack">{buttons}</div> : null;
}

/** Decisions a square leaves open until the turn ends. */
function LandingControls({ s, me, legal, dispatch }: Part) {
  const t = useT();
  const A = t.cf.actions;
  const at = s.landed;
  if (!at) return null;
  const can = (type: CFAction['type']) => legal.some((a) => a.type === type);

  if (at.track === 'rat') {
    if (RAT_BOARD[at.space].kind !== 'charity' || s.decided) return null;
    return can('DONATE') ? (
      <div className="cfActions__stack">
        <button type="button" className="btn btn--block" onClick={() => dispatch({ type: 'DONATE', playerId: me.id })}>
          {A.donate(fmt(charityCost(me)))}
        </button>
        <p className="muted small">{A.donateRat}</p>
      </div>
    ) : <p className="muted small">{t.common.notEnoughCash}</p>;
  }

  const sp = FAST_BOARD[at.space];
  const holder = s.fastOwners[sp.id] ? s.players[s.fastOwners[sp.id]] : null;
  if (s.decided) return null;

  switch (sp.kind) {
    case 'business':
      if (holder) return <p className="muted small">{A.businessTaken(holder.name)}</p>;
      return (
        <div className="cfActions__stack">
          <button type="button" className="btn btn--block" disabled={!can('BUY_BUSINESS')}
            onClick={() => dispatch({ type: 'BUY_BUSINESS', playerId: me.id })}>
            {A.buyBusiness(fmt(sp.cost ?? 0))}
          </button>
          <p className="muted small">{can('BUY_BUSINESS') ? A.businessNote(fmt(sp.cashflow ?? 0)) : t.common.notEnoughCash}</p>
        </div>
      );
    case 'venture': {
      if (holder) return <p className="muted small">{A.ventureClosed}</p>;
      const pays = sp.payout ? fmt(sp.payout) : `+${fmt(sp.cfPayout ?? 0)}/mo`;
      return (
        <div className="cfActions__stack">
          <button type="button" className="btn btn--block" disabled={!can('TRY_VENTURE')}
            onClick={() => dispatch({ type: 'TRY_VENTURE', playerId: me.id })}>
            {A.tryVenture(fmt(sp.cost ?? 0))}
          </button>
          <p className="muted small">{A.ventureNote((sp.win ?? []).join('/'), pays)}</p>
        </div>
      );
    }
    case 'dream':
      if (me.dream !== sp.id) return <p className="muted small">{A.notYourDream}</p>;
      return can('BUY_DREAM') ? (
        <button type="button" className="btn btn--primary btn--block" onClick={() => dispatch({ type: 'BUY_DREAM', playerId: me.id })}>
          {A.buyDream(fmt(dreamPrice(me)))}
        </button>
      ) : <p className="muted small">{A.dreamShort(fmt(dreamPrice(me)))}</p>;
    case 'charity':
      if (me.fastCharity || !can('DONATE')) return null;
      return (
        <div className="cfActions__stack">
          <button type="button" className="btn btn--block" onClick={() => dispatch({ type: 'DONATE', playerId: me.id })}>
            {A.donate(fmt(charityCost(me)))}
          </button>
          <p className="muted small">{A.donateFast}</p>
        </div>
      );
    default:
      return null;
  }
}
