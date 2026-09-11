import { useMemo, useState } from 'react';
import { FAST_BOARD, LOAN_UNIT, RAT_BOARD } from '../../cashflow/data';
import {
  charityCost, currentId, dreamPrice, legalActions, maxLoan, settlement, tableCard,
} from '../../cashflow/rules';
import type { CFAction, CFPlayer, CFState } from '../../cashflow/types';
import { money } from '../../game/describe';
import { useT } from '../../i18n';
import { fmt } from '../bits';
import { CFTableCardView } from './CFCard';

type Dispatch = (a: CFAction) => void;

/**
 * What you can do right now, and nothing else. Every button here comes
 * from legalActions(), so the panel can never offer a move the engine
 * would refuse - and a control that is missing says why underneath.
 */
export function CFActions({ s, myId, dispatch }: { s: CFState; myId: string; dispatch: Dispatch }) {
  const t = useT();
  const A = t.cf.actions;
  const me = s.players[myId];
  const legal = useMemo(() => legalActions(s, myId), [s, myId]);
  const curId = currentId(s);
  const cur = s.players[curId];
  const isMine = curId === myId;

  // On a phone the board is too small to carry the card, so it sits here.
  const cardBlock = s.card ? <div className="cfActions__card"><CFTableCardView s={s} /></div> : null;

  if (!me || me.out) {
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
        <p className="actions__title">{A.chooseDream}</p>
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
        <SaleControls s={s} me={me} legal={legal} dispatch={dispatch} />
      </section>
    );
  }

  return (
    <section className="actions actions--mine">
      <p className="actions__title">{A.yourTurn}</p>

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
          <button
            type="button"
            className="btn btn--primary btn--block"
            data-hotkey="advance"
            onClick={() => dispatch({ type: 'END_TURN', playerId: myId })}
          >
            {A.endTurn}
            <kbd className="kbd">{t.common.keySpace}</kbd>
          </button>
        </>
      )}
    </section>
  );
}

interface Part { s: CFState; me: CFPlayer; legal: CFAction[]; dispatch: Dispatch }

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
  const card = tableCard(s);
  if (!card || card.deck === 'market' || card.deck === 'doodad' || card.kind !== 'holding' || !s.card) return null;
  if (s.card.used) return <p className="muted small">{A.bought}</p>;

  if (legal.some((a) => a.type === 'BUY_DEAL')) {
    return (
      <button type="button" className="btn btn--block" onClick={() => dispatch({ type: 'BUY_DEAL', playerId: me.id })}>
        {A.buyDeal(fmt(card.down))}
      </button>
    );
  }
  // Short: the bank can make up the difference if the pay cheque allows.
  const loan = Math.ceil((card.down - me.cash) / LOAN_UNIT) * LOAN_UNIT;
  if (loan > 0 && loan <= maxLoan(s, me)) {
    return (
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
    );
  }
  return <p className="muted small">{A.cannotAfford}</p>;
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
